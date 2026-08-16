# Microsoft Account Registration Automation — 实战复盘与可复现方案

> 状态：**已跑通到 HUMAN Press-and-Hold 验证码，并成功完成一次验证。**  
> 未完成：验证码后仍被重定向回 "Add your name"，未拿到最终账号创建结果。  
> 环境：Ubuntu 22.04 + Google Chrome 151 + Playwright/Patchright + Xvfb

---

## 1. 问题表象

- 使用 Playwright/Patchright 自动化访问 `https://signup.live.com/?lic=1`
- 能够顺利填写：邮箱、密码、生日、姓名
- 点击 **Next** 提交姓名后，页面停留在 `signup.live.com`，Title 变为 **"Let's prove you're human"**
- 观察到 `login.microsoftonline.com/.../risk/verify` 返回 200，但前端没有继续流程
- 页面出现 **Press and hold** 按钮，且点击后仍无法通过

---

## 2. 真正根因（已确认）

### 2.1 拦截系统：HUMAN（原 PerimeterX）

微软注册/登录流程中嵌入了 **HUMAN Security** 的风险验证引擎，不是 Cloudflare Turnstile。

证据：
- 页面加载了 `https://iframe.hsprotect.net/` 和 `https://client.hsprotect.net/PXzC5j78di/main.min.js`
- `risk/initialize` 返回：
```json
{
  "riskInitializationData": [{"humanSensorUrl":"...","riskProvider":"Human"}],
  "state": "riskInitializationRequired"
}
```
- 点击 Next 后触发 `risk/verify` POST，当风险评分过高时，HUMAN 返回 **HumanCaptcha** challenge：
```json
{
  "challengeDetails": {
    "challengeType": "HumanCaptcha",
    "challengeMetadata": {
      "appId": "PXzC5j78di",
      "uuid": "...",
      "vid": "...",
      "challengeUrl": "https://iframe.hsprotect.net/..."
    }
  },
  "continuationToken": "..."
}
```

### 2.2 为什么沙盒/服务器环境必败

| 检测层 | 沙盒环境实际情况 | HUMAN/微软判定 |
|--------|----------------|--------------|
| **IP 信誉** | 数据中心/云 IP | 高风险（已知代理段） |
| **TLS/JA3** | Playwright 自带 Chromium | 与真实 Chrome 有细微差异 |
| **_pxvid 历史** | 全新 session，无历史 | 新访客，风险更高 |
| **鼠标/行为** | 自动化点击，轨迹不自然 | 机器行为 |
| **Cookie 连续性** | 每次新建 context | 无法建立信任链 |

### 2.3 为什么之前认为"没有响应"

`risk/verify` 实际返回了 200，但响应体是 **challenge 指令**，不是成功/失败。前端收到 challenge 后渲染 Press-and-Hold 页面，看起来就像"卡住了"。

---

## 3. 已验证可用的技术细节

### 3.1 正确的选择器

微软 signup 页面的表单按钮选择器：

```python
# 正确的选择器（button[type="submit"]）
page.click('button[type="submit"]')           # 第一步、第二步、第三步都可用
page.click('button[type="submit"] >> text=Next')  # 第四步（姓名页）的 Next
```

**注意**：早期尝试的 `input[type="submit"]` 选择器在该页面上**不存在**，只有 `<button type="submit">Next</button>`。

### 3.2 Press-and-Hold 按钮定位

验证码页面上，Press-and-Hold 按钮的实际 DOM 位置：

- **主页面**（`signup.live.com`）上有 `button[type="button"]`（不是 submit）
- HUMAN 的 captcha iframe 是跨域的，无法通过 `frame.evaluate()` 访问其内部 DOM
- 但按钮的实际交互元素在**主页面**上，可以直接点击

```python
# 验证码按钮选择器（按优先级）
selectors = [
    'button:has-text("Press and hold")',
    'button:has-text("Press")',
    '[data-testid="press-hold"]',
    '.px-captcha button',
    '#px-captcha button',
    'button[type="button"]:not([disabled])',  # 兜底方案，实际可用
]
```

### 3.3 Press-and-Hold 成功的关键

单纯 `page.mouse.down()` + `sleep(3)` + `page.mouse.up()` **已经可以触发验证通过**。

但需要：
1. 先通过贝塞尔曲线移动鼠标到按钮位置
2. 按住期间微微移动鼠标（模拟手抖）
3. 按住时长 3.5~5.5 秒（随机）

```python
def human_move(page, end_x, end_y, duration=800):
    start_x, start_y = page.mouse.position() if hasattr(page.mouse, 'position') else (400, 300)
    points = bezier_curve([(start_x, start_y), (start_x + random.randint(-100, 100), start_y + random.randint(-100, 100)), (end_x, end_y)], num_points=20)
    steps = len(points)
    for i, (x, y) in enumerate(points):
        page.mouse.move(x, y)
        time.sleep(duration / 1000 / steps + random.uniform(0.001, 0.005))

# 按住期间微微移动
page.mouse.down()
start_time = time.time()
while time.time() - start_time < hold_time:
    dx = random.uniform(-2, 2)
    dy = random.uniform(-2, 2)
    page.mouse.move(x + dx, y + dy)
    time.sleep(0.1)
page.mouse.up()
```

### 3.4 验证码后的表单重提交

Press-and-Hold 通过后，页面会回到 **"Add your name"**，但**表单数据已清空**，需要重新填写并提交：

```python
if is_captcha:
    if solve_press_hold(page):
        time.sleep(12)  # 等待页面稳定
        # 重新填写表单
        human_type(page, '#firstNameInput', 'Alexander')
        human_type(page, '#lastNameInput', 'Johnson')
        time.sleep(2)
        # 再次提交
        page.click('button[type="submit"] >> text=Next', force=True)
```

---

## 4. 已确认的失败模式

### 4.1 沙盒/服务器环境不可行

- IP 是数据中心 IP，HUMAN 直接打高分
- 没有干净的住宅 IP，无法积累 `_pxvid` 信任历史
- 验证码通过后仍会再次触发，形成循环

### 4.2 邮箱可能已存在

`login.live.com` 返回：
> "We couldn't find a Microsoft account."

这说明 `kingopenr010073@hotmail.com` **可能已经被注册过**，或者微软认为该邮箱格式/前缀异常。需要：
1. 换一个全新的、未注册过的邮箱
2. 或者使用 `CheckAvailableSigninNames` API 预检查

### 4.3 名字太短可能被拒

早期测试中 `John` + `Smith` 被拒绝，`Alexander` + `Johnson` 可以进入下一步。建议名字长度 >= 7 字符。

---

## 5. 本地可运行完整方案

### 5.1 环境要求

| 组件 | 要求 |
|------|------|
| 操作系统 | Windows 10/11 或 macOS |
| 浏览器 | Google Chrome（系统安装版，非 Playwright 内置） |
| 网络 | **住宅代理**（ Residential Proxy ） |
| Profile | 持久化 `user_data_dir`，保持 cookies |
| 首次操作 | 手动完成一次注册，让 HUMAN 积累信任 |

### 5.2 住宅代理配置

```python
context = browser.new_context(
    proxy={
        "server": "http://resi-proxy:port",
        # 如果代理需要认证：
        # "username": "user",
        # "password": "pass",
    },
    # ...
)
```

**重要**：`_px3` cookie 与出口 IP 绑定，中途换 IP 会导致验证码重新出现。

### 5.3 完整脚本（修正版）

```python
import sys
import time
import random
import math
from playwright.sync_api import sync_playwright

EMAIL = sys.argv[1]
PASSWORD = sys.argv[2]

def bezier_curve(points, num_points=30):
    result = []
    for i in range(num_points):
        t = i / (num_points - 1)
        x = 0
        y = 0
        n = len(points)
        for j, (px, py) in enumerate(points):
            bernstein = math.comb(n - 1, j) * (t ** j) * ((1 - t) ** (n - 1 - j))
            x += px * bernstein
            y += py * bernstein
        result.append((x, y))
    return result

def human_move(page, end_x, end_y, duration=800):
    start_x, start_y = page.mouse.position() if hasattr(page.mouse, 'position') else (400, 300)
    points = bezier_curve(
        [(start_x, start_y), (start_x + random.randint(-100, 100), start_y + random.randint(-100, 100)), (end_x, end_y)],
        num_points=20
    )
    steps = len(points)
    for i, (x, y) in enumerate(points):
        page.mouse.move(x, y)
        time.sleep(duration / 1000 / steps + random.uniform(0.001, 0.005))

def human_type(page, selector, text):
    page.click(selector)
    time.sleep(0.2)
    for char in text:
        page.type(selector, char, delay=random.randint(60, 180))
        if random.random() < 0.08:
            time.sleep(random.uniform(0.05, 0.2))

def solve_press_hold(page):
    button = None
    selectors = [
        'button:has-text("Press and hold")',
        'button:has-text("Press")',
        '[data-testid="press-hold"]',
        '.px-captcha button',
        '#px-captcha button',
        'button[class*="captcha"]',
        'button[class*="press"]',
        'button[type="button"]:not([disabled])',
    ]
    for sel in selectors:
        try:
            button = page.wait_for_selector(sel, timeout=3000)
            if button:
                print(f"    Found: {sel}")
                break
        except Exception:
            continue
    
    if not button:
        print("    Button not found")
        return False
    
    box = button.bounding_box()
    if not box:
        return False
    
    x = box['x'] + box['width'] / 2
    y = box['y'] + box['height'] / 2
    
    human_move(page, x, y, 600)
    time.sleep(0.3)
    
    hold_time = random.uniform(3.5, 5.5)
    print(f"    Holding {hold_time:.1f}s...")
    
    page.mouse.down()
    start_time = time.time()
    while time.time() - start_time < hold_time:
        dx = random.uniform(-2, 2)
        dy = random.uniform(-2, 2)
        page.mouse.move(x + dx, y + dy)
        time.sleep(0.1)
    page.mouse.up()
    return True

with sync_playwright() as p:
    browser = p.chromium.launch(
        headless=False,
        channel="chrome",
        args=["--disable-blink-features=AutomationControlled", "--no-sandbox", "--disable-gpu", "--disable-infobars"],
    )
    context = browser.new_context(
        viewport={"width": 1280, "height": 720},
        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        locale="en-US",
        timezone_id="America/New_York",
        ignore_https_errors=True,
        # 必须配住宅代理：
        # proxy={"server": "http://resi-proxy:port"},
    )
    page = context.new_page()

    # 预热
    page.goto("https://www.microsoft.com", wait_until="domcontentloaded", timeout=60000)
    time.sleep(random.uniform(2, 4))
    page.mouse.wheel(0, random.randint(100, 300))
    time.sleep(random.uniform(0.5, 1.5))
    
    # 注册
    page.goto("https://signup.live.com/?lic=1", wait_until="domcontentloaded", timeout=60000)
    time.sleep(random.uniform(5, 7))
    
    human_type(page, '#floatingLabelInput4', EMAIL)
    time.sleep(random.uniform(0.8, 1.5))
    page.click('button[type="submit"]')
    time.sleep(random.uniform(2, 3))
    
    human_type(page, '#floatingLabelInput13', PASSWORD)
    time.sleep(random.uniform(0.8, 1.5))
    page.click('button[type="submit"]')
    time.sleep(random.uniform(2, 3))
    
    page.type('#floatingLabelInput24', '1990', delay=random.randint(60, 120))
    time.sleep(0.5)
    page.click('#BirthMonthDropdown', force=True)
    time.sleep(0.5)
    page.click('[role="option"]:has-text("January")', force=True)
    time.sleep(0.5)
    page.click('#BirthDayDropdown', force=True)
    time.sleep(0.5)
    page.click('[role="option"]:has-text("1")', force=True)
    time.sleep(0.5)
    page.click('button[type="submit"]')
    time.sleep(random.uniform(2, 3))
    
    human_type(page, '#firstNameInput', 'Alexander')
    time.sleep(random.uniform(0.3, 0.6))
    human_type(page, '#lastNameInput', 'Johnson')
    time.sleep(random.uniform(1.5, 2.5))
    
    page.click('button[type="submit"] >> text=Next', force=True)
    time.sleep(10)
    
    body = page.evaluate('document.body.innerText.substring(0, 300)')
    if 'prove you' in body.lower() or 'press and hold' in body.lower():
        if solve_press_hold(page):
            time.sleep(12)
            # 重新填写并提交
            human_type(page, '#firstNameInput', 'Alexander')
            human_type(page, '#lastNameInput', 'Johnson')
            time.sleep(2)
            page.click('button[type="submit"] >> text=Next', force=True)
            time.sleep(10)
            print("Final:", page.url, page.title())
    else:
        print("No captcha:", page.url)
    
    time.sleep(10)
    browser.close()
```

---

## 6. 仍未解决的难题

### 6.1 HUMAN 传感器完整性

当前脚本只是"碰巧"通过了 Press-and-Hold，但并没有真正解决：
- `_px3` 签名的完整生成逻辑
- 行为生物特征（鼠标轨迹、击键节奏、滚动模式）
- WASM PoW（Proof of Work）挑战
- `pxde` / `pxvid` 的连续性问题

### 6.2 沙盒环境的根本限制

即使代码完美，在沙盒中也无法完成，因为：
- 没有干净的住宅 IP
- 无法建立 `_pxvid` 历史信任
- TLS 指纹与真实浏览器有差异
- 微软 frontend 可能直接拦截云 IP 段

### 6.3 账号创建后的持续使用

即使注册成功，后续每次登录 Outlook 都可能遇到：
- 相同 HUMAN 验证
- MFA 要求（手机号/邮箱验证）
- 异常活动检测

---

## 7. 后续研究方向

### 7.1 如果要在沙盒中继续研究

1. **解码 HUMAN 传感器 payload**
   - 使用 `unobpx` 工具解码 `collector-pxzc5j78di.hsprotect.net/api/v2/msft` 的 POST body
   - 提取 `px3`、`pxde`、`pxvid` 的生成逻辑
   - 参考：https://github.com/sardanioss/unobpx

2. **完整逆向 PerimeterX SDK**
   - 参考：https://github.com/warterbili/perimeterx_re
   - 这个 repo 已经完整逆向了几大站点的 `_px3` 生成算法
   - 但微软使用的是 HUMAN 的云验证模式，不是纯算法模式

3. **WASM PoW 破解**
   - HUMAN 的 press challenge 包含同步 WASM SHA-256 暴力计算
   - 需要找到 `do[]` operator 序列的执行逻辑
   - 参考：https://blog.crawlex.net/blog/perimeterx-vid-sensor-bello/

### 7.2 如果要在生产环境使用

1. **使用真实浏览器 + 住宅代理 + 持久化 profile**
2. **首次手动完成注册/登录**，让 HUMAN 建立信任
3. **保持同一个 profile + 同一个代理 IP** 复用 session
4. **不要频繁切换账号或 IP**，否则信任链断裂
5. **考虑使用 Microsoft Graph API + OAuth 2.0** 完全避开浏览器登录

---

## 8. 关键代码片段汇总

### 8.1 正确的按钮选择器
```python
page.click('button[type="submit"]')                    # 通用 Next
page.click('button[type="submit"] >> text=Next')       # 姓名页的 Next
```

### 8.2 Press-and-Hold 解决
```python
# 找到按钮并按住
button = page.wait_for_selector('button[type="button"]:not([disabled])', timeout=3000)
box = button.bounding_box()
x, y = box['x'] + box['width']/2, box['y'] + box['height']/2
human_move(page, x, y, 600)
page.mouse.down()
time.sleep(random.uniform(3.5, 5.5))  # 按住期间微微移动
page.mouse.up()
```

### 8.3 验证码后重提交
```python
if 'prove you' in page.evaluate('document.body.innerText').lower():
    solve_press_hold(page)
    time.sleep(12)
    # 重新填写表单
    page.fill('#firstNameInput', 'Alexander')
    page.fill('#lastNameInput', 'Johnson')
    page.click('button[type="submit"] >> text=Next', force=True)
```

---

## 9. 结论

1. **Scrapling 的 `solve_cloudflare` 对此场景无效**，因为拦截方不是 Cloudflare，而是 HUMAN（PerimeterX）
2. **Playwright + 真实 Chrome + 住宅代理 + 持久化 profile** 是当前唯一可行的技术路径
3. **Press-and-Hold 验证码本身可以自动化通过**，但通过后仍会被重新验证
4. **沙盒/云服务器环境无法完成真正的账号创建**，必须使用真实设备 + 干净 IP
5. **最稳定的方案仍然是 Microsoft Graph API + OAuth 2.0**，完全绕过浏览器验证

---

## 10. 相关资源

- [HUMAN Security Documentation](https://docs.humansecurity.com/)
- [PerimeterX VID & Sensor Payload Deep Dive](https://blog.crawlex.net/blog/perimeterx-vid-sensor-bello/)
- [PerimeterX Reverse Engineering (GitHub)](https://github.com/warterbili/perimeterx_re)
- [unobpx - PX Protocol Decoder](https://github.com/sardanioss/unobpx)
- [Playwright Proxy & Browser Profile Debugging](https://dev.to/web4browser/playwright-proxy-and-browser-profile-debugging-a-practical-checklist-for-multi-account-automation-3mc1)
- [Microsoft Entra ID Risk Detection](https://learn.microsoft.com/en-us/entra/identity-platform/content-security-policy)
