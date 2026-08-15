# trykilo

## notebooklm-py 未公开 API 深度技术研究报告

> 基于源码级分析（v0.8.1, main branch, 2026-08-15）

---

## 1. 未公开 API 概述

### 1.1 本质

notebooklm-py 不是一个使用 Google 公开 API 的 SDK，而是一个**通过逆向工程 Google 内部 batchexecute RPC 协议实现的自动化客户端**。

| 属性 | 详情 |
|------|------|
| **协议名称** | batchexecute |
| **端点** | `/_/LabsTailwindUi/data/batchexecute` |
| **协议类型** | Google 内部 RPC（与 Google Docs/Sheets 相同） |
| **公开性** | 完全未公开，无官方文档 |
| **稳定性** | 无任何保障，Google 可随时变更 |
| **监控** |  nightly RPC health check 自动化监控 |

### 1.2 为什么是"未公开"

- Google 从未发布 NotebookLM 的 API 文档
- 该协议最初为 Google 内部 Web 前端服务
- 与 Google Workspace 的 batchexecute 协议同源
- RPC 方法 ID 是 6 字符混淆字符串（如 `wXbhsf`），无语义
- 参数是位置敏感的嵌套数组，非 JSON 对象

---

## 2. 协议深度解析

### 2.1 端点拓扑

```
┌─────────────────────────────────────────────────────────────────────┐
│                      NotebookLM API Endpoints                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. batchexecute (主 RPC 端点)                                      │
│     POST https://notebooklm.google.com/_/LabsTailwindUi/data/batchexecute
│     └── 所有 CRUD 操作、生成、研究等                                 │
│                                                                     │
│  2. Streamed Chat (流式聊天)                                        │
│     POST https://notebooklm.google.com/_/LabsTailwindUi/data/       │
│         google.internal.labs.tailwind.orchestration.v1.             │
│         LabsTailwindOrchestrationService/GenerateFreeFormStreamed   │
│     └── 实时流式聊天响应                                             │
│                                                                     │
│  3. Upload (文件上传)                                               │
│     POST https://notebooklm.google.com/upload/_/                    │
│     └── 大文件上传（PDF、视频等）                                    │
│                                                                     │
│  4. Homepage (认证 + CSRF)                                          │
│     GET https://notebooklm.google.com/                              │
│     └── 提取 SNlM0e (CSRF) + FdrFJe (Session ID)                   │
│                                                                     │
│  5. Rebrand Host (可选)                                             │
│     https://notebook.google.com/                                    │
│     └── 2026年7月更名后的备用域名                                   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 batchexecute 协议细节

**请求格式：**

```
URL:
  https://notebooklm.google.com/_/LabsTailwindUi/data/batchexecute
  ?authuser=0
  &_reqid=<monotonically_increasing_id>
  &rt=c

Headers:
  Content-Type: application/x-www-form-urlencoded;charset=UTF-8
  Cookie: SID=...; HSID=...; SSID=...; SAPISID=...; SIDTS=...

Body:
  f.req=<triple_nested_json>&at=<csrf_token>&

Triple-nested JSON:
  [
    [
      [
        "wXbhsf",                    # RPC ID (6-char obfuscated)
        "[[\"url\",null,[1],null]]", # JSON-encoded params (compact, no spaces)
        null,                        # Always null
        "generic"                    # Always "generic"
      ]
    ]
  ]
```

**响应格式（chunked）：**

```
)]}'                                    ← Anti-XSSI prefix (must strip)
1234                                    ← Byte count (UTF-8 bytes of next line)
["wrb.fr","wXbhsf",{...},null,null]     ← JSON payload
5678                                    ← Byte count
["wrb.fr","wXbhsf",null,[5,"Not Found",{...}]],null,null]  ← Error with gRPC status
```

**关键帧类型：**

| Tag | 含义 | 说明 |
|-----|------|------|
| `wrb.fr` | function response | 成功或失败的结果 |
| `er` | error response | 协议级错误 |

**响应索引结构（`wrb.fr` frame）：**

```
[
  tag,           # 0: "wrb.fr"
  rpc_id,        # 1: 对应的 RPC ID
  result_data,   # 2: 实际结果（可能为 null）
  ...,           # 3-4: 保留
  error_info,    # 5: google.rpc.Status 数组（null result 时携带）
  ...
]
```

**`google.rpc.Status` 数组格式（index 5）：**

```
[code]                    # 单元素：仅状态码
[code, message]           # 两元素：+ 人类可读消息
[code, message, details]  # 三元素：+ 详细信息（UserDisplayableError 等）
```

### 2.3 RPC 方法 ID 全览

项目目前识别的 **47 个 RPC 方法**（来自 `rpc/types.py`）：

#### 笔记本操作

| 方法 | Obfuscated ID | 后端对应 | 说明 |
|------|--------------|----------|------|
| `LIST_NOTEBOOKS` | `wXbhsf` | `ListRecentlyViewedProjects` | 按最近查看排序 |
| `CREATE_NOTEBOOK` | `CCqFvf` | `CreateProject` | - |
| `GET_NOTEBOOK` | `rLM1Ne` | `GetProject` | - |
| `RENAME_NOTEBOOK` | `s0tc2d` | `MutateProject` | 通用笔记本变更器 |
| `DELETE_NOTEBOOK` | `WWINqb` | `DeleteProjects` | 单 ID |
| `REMOVE_RECENTLY_VIEWED` | `fejl7e` | `RemoveRecentlyViewedProject` | - |

#### 来源操作

| 方法 | Obfuscated ID | 后端对应 | 说明 |
|------|--------------|----------|------|
| `ADD_SOURCE` | `izAoDd` | `AddSources` | 单源 |
| `ADD_SOURCE_FILE` | `o4cbdc` | 未确认 | 上传文件注册为来源 |
| `DELETE_SOURCE` | `tGMBJ` | `DeleteSources` | 支持批量 |
| `GET_SOURCE` | `hizoJc` | `LoadSource` | - |
| `REFRESH_SOURCE` | `FLmJqe` | `RefreshSource` | - |
| `CHECK_SOURCE_FRESHNESS` | `yR9Yof` | `CheckSourceFreshness` | - |
| `UPDATE_SOURCE` | `b7Wfje` | `MutateSource` | - |

#### 来源标签

| 方法 | Obfuscated ID | 后端对应 | 说明 |
|------|--------------|----------|------|
| `CREATE_LABEL` | `agX4Bc` | `CreateLabel` | AI 自动分组 + 手动创建 |
| `LIST_LABELS` | `I3xc3c` | `GetLabels` | - |
| `UPDATE_LABEL` | `le8sX` | `MutateLabel` | 重命名/设置 emoji/添加来源 |
| `DELETE_LABEL` | `GyzE7e` | `DeleteLabels` | 批量删除 |

#### 产物操作

| 方法 | Obfuscated ID | 后端对应 | 说明 |
|------|--------------|----------|------|
| `CREATE_ARTIFACT` | `R7cb6c` | `CreateArtifact` | 生成任何产物 |
| `LIST_ARTIFACTS` | `gArtLc` | `ListArtifacts` | - |
| `DELETE_ARTIFACT` | `V5N4be` | `DeleteArtifact` | 单 ID |
| `RENAME_ARTIFACT` | `rc3d8d` | `UpdateArtifact` | 仅设置标题 |
| `EXPORT_ARTIFACT` | `Krh3pd` | `ExportToDrive` | 导出到 Google Drive |
| `SHARE_ARTIFACT` | `RGP97b` | `LabsTailwindSharingService.ShareAudio` | - |
| `GET_INTERACTIVE_HTML` | `v9rmvd` | `GetArtifact` | 获取测验/抽认卡 HTML + mind map JSON |
| `REVISE_SLIDE` | `KmcKPe` | `DeriveArtifact` | 修改幻灯片 |
| `RETRY_ARTIFACT` | `Rytqqe` | `GenerateArtifact` | 重试失败的产物 |
| `GET_SUGGESTED_REPORTS` | `ciyUvf` | `GenerateReportSuggestions` | AI 建议的报告格式 |

#### 研究操作

| 方法 | Obfuscated ID | 后端对应 | 说明 |
|------|--------------|----------|------|
| `START_FAST_RESEARCH` | `Ljjv0c` | `DiscoverSourcesManifold` | 快速研究 |
| `START_DEEP_RESEARCH` | `QA9ei` | `DiscoverSourcesAsync` | 深度研究 |
| `POLL_RESEARCH` | `e3bVqc` | `ListDiscoverSourcesJob` | 轮询状态 |
| `IMPORT_RESEARCH` | `LBwxtb` | `FinishDiscoverSourcesRun` | 导入来源 |
| `CANCEL_RESEARCH` | `Zbrupe` | `CancelDiscoverSourcesJob` | 取消研究 |

#### 笔记与思维导图

| 方法 | Obfuscated ID | 后端对应 | 说明 |
|------|--------------|----------|------|
| `GENERATE_MIND_MAP` | `yyryJe` | `ActOnSources` | 通用来源操作，用于生成 mind map |
| `CREATE_NOTE` | `CYK0Xb` | `CreateNote` | - |
| `GET_NOTES_AND_MIND_MAPS` | `cFji9` | `GetNotes` | mind map 作为 JSON note 返回 |
| `UPDATE_NOTE` | `cYAfTb` | `MutateNote` | - |
| `DELETE_NOTE` | `AH0mwd` | `DeleteNotes` | 支持批量 |

#### 聊天

| 方法 | Obfuscated ID | 后端对应 | 说明 |
|------|--------------|----------|------|
| `GET_LAST_CONVERSATION_ID` | `hPTbtc` | `ListChatSessions` | 获取最近会话 ID |
| `GET_CONVERSATION_TURNS` | `khqZz` | `ListChatTurns` | 完整 Q&A 轮次 |
| `DELETE_CONVERSATION` | `J7Gthc` | `DeleteChatTurns` | 删除历史 |
| `SUGGEST_PROMPTS` | `otmP3b` | `GeneratePromptSuggestions` | AI 建议的问题 |

#### 分享

| 方法 | Obfuscated ID | 后端对应 | 说明 |
|------|--------------|----------|------|
| `SHARE_NOTEBOOK` | `QDyure` | `LabsTailwindSharingService.ShareProject` | 设置可见性 |
| `GET_SHARE_STATUS` | `JFMDGd` | `LabsTailwindSharingService.GetProjectDetails` | 获取分享设置 |

#### 其他

| 方法 | Obfuscated ID | 后端对应 | 说明 |
|------|--------------|----------|------|
| `SUMMARIZE` | `VfAZjd` | `GenerateNotebookGuide` | 指南 + 摘要 + 建议问题 |
| `GET_SOURCE_GUIDE` | `tr032e` | `GenerateDocumentGuides` | 来源指南 |
| `GET_USER_SETTINGS` | `ZwVcOc` | `GetOrCreateAccount` | 账户级，首次调用可能创建 |
| `SET_USER_SETTINGS` | `hT54vc` | `MutateAccount` | 仅设置输出语言 |

### 2.4 参数结构模式

**位置敏感数组** — 这是逆向工程中最困难的部分：

```python
# CREATE_NOTEBOOK 参数结构
params = [
    "My Notebook Title",           # 0: 标题
    None,                          # 1: 未使用
    None,                          # 2: 未使用
    [1, None, None, [1]]           # 3: 固定标志数组
]

# ADD_SOURCE (URL) 参数结构
params = [
    [[None, None, [url], None, None, None, None, None, None, None, 1]],  # 0: 来源包装
    notebook_id,                                                     # 1: 笔记本 ID
    [2, None, None, [1, None, None, None, None, None, None, None, None, None, [1]]]  # 2: 标志
]

# 来源 ID 嵌套深度（不同方法不同！）
nest_source_ids(["id1", "id2"], depth=1)  # [["id1"], ["id2"]]
nest_source_ids(["id1", "id2"], depth=2)  # [[["id1"]], [["id2"]]]
nest_source_ids(["id1", "id2"], depth=3)  # [[[["id1"]]], [[["id2"]]]]
nest_source_ids(["id1", "id2"], depth=4)  # [[[[["id1"]]]], [[[["id2"]]]]]
```

---

## 3. 逆向工程方法论

### 3.1 捕获手段

**1. Chrome DevTools（手动）：**
```
1. 打开 notebooklm.google.com
2. F12 → Network → 勾选 "Preserve log" + "Disable cache"
3. 过滤 "batchexecute"
4. 执行一个操作
5. 查看请求详情：
   - URL: rpcids=<METHOD_ID>
   - Payload: f.req=<encoded_json>
   - Response: )]}' prefix + chunked JSON
```

**2. Playwright 自动化（系统化）：**
```python
from playwright.async_api import async_playwright

async def capture_rpc():
    playwright = await async_playwright().start()
    browser = await playwright.chromium.launch_persistent_context(
        user_data_dir="./browser_state",
        headless=False,
    )
    page = browser.pages[0] if browser.pages else await browser.new_page()
    captured = []

    def on_request(request):
        if "batchexecute" in request.url:
            post_data = request.post_data
            if post_data and "f.req" in post_data:
                # 解析并记录 RPC 调用
                captured.append(decode_f_req(post_data))

    page.on("request", on_request)
    return page, captured
```

**3. 移动应用反编译：**
- 从 Google Play 商店下载官方 Android 应用
- 反编译 APK 提取枚举定义（`docs/mobile/enums.txt`）
- 恢复后端枚举值（如 `DriveSourceStatus`、`DiscoveryMode`、`ArtifactStatus`）

### 3.2 解码流程

```python
def decode_f_req(encoded: str) -> dict:
    """解码 f.req 参数"""
    from urllib.parse import unquote, parse_qs
    import json

    decoded = unquote(encoded)
    outer = json.loads(decoded)
    inner = outer[0][0]
    return {
        "rpc_id": inner[0],           # 6-char method ID
        "params": json.loads(inner[1]), # 实际参数
    }
```

### 3.3 验证手段

**Golden Payload 测试：**
```python
# tests/unit/test_rpc_golden_payloads.py
def test_encode_add_source():
    params = [...]
    result = encode_rpc_request(RPCMethod.ADD_SOURCE, params)
    # 验证编码后的 payload 与捕获的真实流量一致
    assert result == EXPECTED_GOLDEN_PAYLOAD
```

**Wire Contract 守卫：**
```python
# tests/_guardrails/_wire_contract.py
# 确保枚举值与从移动应用反编译恢复的值一致
```

---

## 4. API 稳定机制

### 4.1 Nightly RPC Health Check

**自动监控所有 47 个 RPC 方法：**

```yaml
# .github/workflows/rpc-health.yml
# 每天 07:00 UTC 自动运行
```

**监控内容：**
- 发送的 RPC ID 是否与响应中返回的 ID 匹配
- 即使 API 返回错误，也能检测 ID 变化（错误响应仍包含 method ID）

**检测到变化时：**
1. 自动创建 GitHub Issue（标签：`bug, rpc-breakage, automated`）
2. 报告期望 ID vs 实际 ID
3. 触发 patch release 流程

### 4.2 RPC ID Override 系统

**紧急自愈机制：**

```bash
# 当 Google 变更 RPC ID 后，无需等待补丁发布
export NOTEBOOKLM_RPC_OVERRIDES='{"LIST_NOTEBOOKS": "NewMethodId"}'
```

**安全限制：**
- 仅对 `notebooklm.google.com` 允许
- 通过 `_ALLOWED_BASE_HOSTS` 白名单验证
- 记录到 INFO 日志

### 4.3 Build Label 监控

**前端构建标签（`bl`）监控：**

```python
# src/notebooklm/_env.py
DEFAULT_BL = "o6bhsf_20260801.00_p0"  # 实际值
```

- 前端 build label 影响流式聊天端点行为
- 每天检查 served label vs pinned label
- 90 天容忍窗口（Google 约每周发布新 build）
- 超期后触发维护 Issue

### 4.4 严格解码模式（v0.7.0+）

```python
# 所有 schema drift 都 raise UnknownRPCMethodError
# 不再有 "warn and return None" 模式
# 确保 API 变更被立即发现，而非静默失败
```

---

## 5. 认证系统（与未公开 API 的交互）

### 5.1 认证流程

```
用户登录
    │
    ▼
Playwright 自动化浏览器
    │
    ▼
Google OAuth 流程（accounts.google.com）
    │
    ▼
NotebookLM 首页 → 提取：
    - SNlM0e (CSRF token)
    - FdrFJe (Session ID)
    - SID, HSID, SSID, SAPISID, SIDTS cookies
    │
    ▼
storage_state.json（加密存储）
    │
    ▼
后续请求携带 cookies + CSRF token
```

### 5.2 Cookie 策略

**必需域名：**
- `.google.com`
- `.googleapis.com`
- `.gstatic.com`
- `.youtube.com`

**Cookie 过滤：**
- 仅保留认证相关字段
- 移除追踪/广告 cookie
- PSIDTS 自动轮换

### 5.3 多层恢复机制

| 层级 | 方法 | 触发条件 |
|------|------|----------|
| L1 | Cookie Refresh | cookies 过期 |
| L2 | RotateCookies | PSIDTS 轮换 |
| L2.5 | Refresh Cmd | `NOTEBOOKLM_REFRESH_CMD_MIDSESSION=1` |
| L3 | Headless Re-auth | 所有 cookie 失效，需要重新登录 |
| L4 | Master Token | 使用 gpsoauth 交换 durable token |

**Single-flight 保证：**
- N 个并发失败 RPC 只触发 1 次 refresh
- 使用 `asyncio.Lock` + 单任务模式

---

## 6. 传输层安全

### 6.1 双传输实现

**默认：httpx**
- 标准 `httpx.AsyncClient`
- 支持 streaming upload
- 自动 redirect

**可选：curl_cffi（浏览器指纹模拟）**
```python
# NOTEBOOKLM_TRANSPORT=curl_cffi
class CurlCffiAsyncClient:
    def __init__(self):
        self._curl = AsyncSession(
            cookies=self.cookies.jar,
            impersonate="chrome",  # 模拟 Chrome TLS 指纹
        )
```

**为什么需要 curl_cffi：**
- Google 使用 TLS/JA3 指纹检测自动化工具
- httpx 的 TLS 握手特征与真实浏览器不同
- curl_cffi 可以模拟 Chrome 的完整 TLS 握手特征

### 6.2 SSRF 防护

```python
async def get_guarded(self, url, *, is_trusted_host):
    """手动处理 redirect，每跳验证 host"""
    while True:
        # 1. 验证 URL host 在信任列表中
        if not is_trusted_host(urlparse(url).hostname):
            raise httpx.RequestError("untrusted host")
        
        # 2. 发起请求（禁用自动 redirect）
        response = await self._curl.get(url, allow_redirects=False)
        
        # 3. 如果是 redirect，验证下一个 host
        if response.status_code in (301, 302, 303, 307, 308):
            location = response.headers["location"]
            url = urljoin(url, location)
            continue
        
        return response
```

**关键安全点：**
- `quote=False` 防止 URL 编码绕过 host 验证
- 验证 `%2e` → `.` 等编码陷阱
- 仅允许 HTTPS

### 6.3 DNS Rebinding 防护

```python
# MCP / REST Server 专用
def host_header_is_loopback(host_header: str) -> bool:
    """拒绝非 loopback Host header"""
    if not is_loopback(host_header):
        raise SystemExit("Refusing to bind to non-loopback host")
```

---

## 7. 反爬与对抗机制

### 7.1 Google 的反制措施

| 反制 | 检测方式 | 应对 |
|------|----------|------|
| TLS/JA3 指纹 | 分析 TLS Client Hello | curl_cffi 模拟 Chrome |
| Cookie 轮换 | SIDTS 过期检测 | 自动 keepalive + refresh |
| 速率限制 | HTTP 429 + UserDisplayableError | 指数退避 + single-flight |
| 账号异常 | 302 到登录页 | 多层恢复 ladder |
| 区域/反滥用 | 区域限制页面 | 检测并报告 |

### 7.2 Build Label 漂移检测

```python
# Google 前端 build label 影响行为
# 漂移检测确保 label 不过期

DEFAULT_BL = "o6bhsf_20260801.00_p0"  #  pinned 值
# 每天检查 served label vs pinned
# 90 天容忍窗口
```

**发现历史：** build label 曾漂移 5 个月（154 label-days）未被发现。

---

## 8. 使用未公开 API 的风险

### 8.1 已知故障模式

| 故障模式 | 频率 | 影响 | 应对 |
|----------|------|------|------|
| RPC ID 变更 | ~数月一次 | 所有功能失效 | 自动检测 + patch release |
| Build label 过期 | ~每周 | 流式聊天可能异常 | nightly 监控 |
| Cookie 过期 | 频繁 | 需重新登录 | 自动 refresh |
| 速率限制 | 频繁 | 429 错误 | 自动退避 |
| Schema 变更 | 罕见 | 参数解析失败 | 严格解码 + 异常 |

### 8.2 故障响应流程

```
1. Nightly health check 检测到 RPC ID 不匹配
    │
    ▼
2. 自动创建 GitHub Issue（rpc-breakage 标签）
    │
    ▼
3. Maintainer 24h 内响应
    │
    ▼
4. 使用 Chrome DevTools 重新捕获 RPC ID
    │
    ▼
5. 更新 rpc/types.py
    │
    ▼
6. 运行测试 + VCR cassettes 更新
    │
    ▼
7. Patch release（数小时内）
```

### 8.3 用户自愈

```bash
# 在补丁发布前，用户可以临时修复
export NOTEBOOKLM_RPC_OVERRIDES='{"LIST_NOTEBOOKS": "NewId"}'
```

---

## 9. 与官方 API 的对比

| 维度 | notebooklm-py | Google 官方 API |
|------|---------------|-----------------|
| **文档** | 源码 + docs/ | 完整 API 参考 |
| **稳定性** | 无保证，patch release | SLA 保障 |
| **功能覆盖** | 完整（含 Web UI 未暴露） | 受限 |
| **认证** | Cookie/master-token | OAuth 2.0 |
| **速率限制** | 未知（共享 NotebookLM 配额） | 明确配额 |
| **支持** | 社区（GitHub Issues） | Google 支持 |
| **更新** | 跟随 Google 变更 | 版本化发布 |

---

## 10. 典型逆向工程案例

### 10.1 ADD_SOURCE 参数结构演变

```python
# 2025 年捕获（Gemini-2.0 之前）
params = [
    [[url]],           # 简单嵌套
    notebook_id,
    [2],
]

# 2026 年捕获（Gemini-3.5 之后）
params = [
    [[None, None, [url], None, None, None, None, None, None, None, 1]],
    #         ^^^^
    #         新增字段：可能是来源类型标记
    notebook_id,
    [2, None, None, [1, None, None, None, None, None, None, None, None, None, [1]]],
]
```

### 10.2 ArtifactStatus 值修正（#2127）

```python
# 修正前（错误）
class ArtifactStatus(int, Enum):
    PENDING = 2        # 实际是 PROCESSING
    PROCESSING = 1     # 实际是 PENDING

# 修正后（正确）
class ArtifactStatus(int, Enum):
    PENDING = 1        # ARTIFACT_STATUS_INITIALIZED
    PROCESSING = 2     # ARTIFACT_STATUS_PROCESSING
```

**发现过程：**
1. 用户报告 `is_pending` 和 `is_processing` 行为相反
2. 检查移动应用反编译的枚举定义
3. 对比实际 API 响应
4. 确认值被交换，发布 patch

---

## 11. 总结

notebooklm-py 的未公开 API 是一个**通过持续逆向工程维护的活协议**：

1. **协议源**：Google 内部 batchexecute RPC，与 Workspace 同源
2. **方法 ID**：47 个 6 字符混淆 ID，通过 Chrome DevTools + Playwright 捕获
3. **参数**：位置敏感嵌套数组，需逐字节对比
4. **监控**：nightly health check 自动检测 ID 变更
5. **自愈**：RPC override 系统 + build label 监控
6. **恢复**：4 层认证恢复 ladder + single-flight refresh
7. **对抗**：curl_cffi TLS 指纹模拟 + SSRF/DNS rebinding 防护
8. **稳定性策略**：patch release on ID change + strict decode + regenerable baselines

这是一个**工程对抗 Google 反自动化措施的持续战**，核心经验是：
- 自动化检测比人工发现更快
- 分层恢复比单点认证更可靠
- 严格解码比静默降级更安全
- 可覆盖的硬编码 ID 比零灵活性更好
