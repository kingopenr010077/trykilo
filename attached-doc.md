# Obsidian 笔记库（金仓库 · jinvault）

本仓库通过脱敏脚本发布到私有 Gitee 仓库 `obs_on_op`。仓库中的敏感信息（访问密钥、个人域名、令牌）已被替换为 `{{占位符}}` 形式，**不含任何真实 key 或域名**。

---

## 一、目录结构

### 本机（发布方）

```
/storage/emulated/0/obsidian/
├── jinvault/                     # Obsidian 笔记库（会推送到 Gitee）
│   ├── obs_publish.sh            # 脱敏推送脚本（无敏感信息，随仓库分发）
│   ├── obs_restore.sh            # 一键还原脚本（推送时自动生成）
│   ├── .placeholder_map.txt      # 占位符模板（真实值留空 YOUR_VALUE）
│   ├── README.md                 # 本说明
│   └── ...笔记文件、附件
└── .secret/                      # 敏感配置（vault 外层，绝不推送）
    ├── .gitee_cred               # Gitee 凭证（用户名 + 访问令牌）
    ├── placeholder_map.txt       # 真实值映射表（脱敏依据）
    └── logs/                     # 每次推送的日志
```

### 远程（Gitee 仓库）

- 仓库：`https://gitee.com/moremorelessless/obs_on_op.git`
- 可见性：**私有**
- 内容：脱敏后的笔记 + 附件 + `obs_publish.sh` + `obs_restore.sh` + `.placeholder_map.txt` + README
- **不含**：`.secret/`、`.obsidian/`、`.trash/`、真实 key/域名

---

## 二、发布方流程（每次更新笔记后）

```bash
bash /storage/emulated/0/obsidian/jinvault/obs_publish.sh
```

### 6 个步骤详解

1. **备份**
   - vault 打包到 `/data/data/com.termux/files/usr/tmp/obs_vault_backup_<时间戳>.tar.gz`
   - 防止推送失败或误操作时数据丢失

2. **制作脱敏副本**
   - 复制整个 vault 到临时目录
   - 删除副本中的 `.git` 历史（防止旧提交中的敏感信息随新推送泄露）
   - 副本不包含 `.secret/`（它本就在 vault 外层）

3. **脱敏处理**
   - 从 `/storage/emulated/0/obsidian/.secret/placeholder_map.txt` 读取映射表
   - 把每个真实值替换为 `{{占位符}}`（见下方占位符表）
   - 兜底规则：32+ 位十六进制串 → `{{HEX_TOKEN}}`
   - **扫描验证**：确认副本中无残留真实值后才继续

4. **写入还原工具**
   - 生成 `obs_restore.sh`（可自动定位本机 `.secret` 读取真实值）
   - 生成 `.placeholder_map.txt`（真实值留空 `YOUR_VALUE`，供无 `.secret` 的设备手动填写）
   - 保留本 README

5. **配置 .gitignore**
   - 排除 `.obsidian/`（含插件 token）、`.trash/`、系统文件

6. **git 提交 + 推送**
   - 版本号 = 时间戳：`YYYYMMDDHHMMSS`（如 `20260802003251`）
   - 强制覆盖远程历史（每次都是全新脱敏副本，保证远程只保留本次内容）
   - 凭证从 `.secret/.gitee_cred` 读取，通过 ASKPASS 传输（不进命令行/git 配置）

---

## 三、下载方流程（新设备）

### 方式 A：本机已有 `.secret` 配置（推荐）

```
# 1. 克隆仓库
git clone https://gitee.com/moremorelessless/obs_on_op.git
cd obs_on_op

# 2. 一键还原（自动读取 obsidian 根目录下的 .secret/placeholder_map.txt）
bash obs_restore.sh
```

### 方式 B：无 `.secret` 配置（手动填写）

```
# 1. 克隆仓库
git clone https://gitee.com/moremorelessless/obs_on_op.git
cd obs_on_op

# 2. 编辑映射表，把每个 YOUR_VALUE 填成自己的真实值
vim .placeholder_map.txt

# 3. 一键还原
bash obs_restore.sh
```

还原脚本会遍历所有文本文件，把 `{{占位符}}` 替换为真实值；`YOUR_VALUE` 未填写的占位符自动跳过并提示。还原完成后**删除映射表**防止真实值再次泄露。

---

## 四、占位符说明

| 占位符 | 用途 | 出现位置 | 需替换为 |
|--------|------|----------|----------|
| `{{OBSIDIAN_ACCESS_KEY}}` | Obsidian Publish 图片访问密钥 | 含图片链接的笔记（如 `好好好好.md` 中的 `obsidian.md/access/{{...}}/Attachments/xxx.jpg`） | 你的 Obsidian Publish 站点 access key |
| `{{OBSIDIAN_PUBLISH_DOMAIN}}` | Obsidian 发布图片域名 | 笔记图片链接 `publish-01.obsidian.md` | 你的 Obsidian Publish 域名 |
| `{{PUBLISH_SUBDOMAIN}}` | 笔记发布站点子域名 | 笔记中引用的 `showcase.ccwu.cc` | 你的发布子域名 |
| `{{MAIN_DOMAIN}}` | 主域名 | 笔记中的 `ccwu.cc` 域引用 | 你的主域名 |
| `{{PROXY_TOKEN}}` | Termux 发布代理访问令牌 | 涉及发布的笔记配置 | 你的代理令牌 |
| `{{HEX_TOKEN}}` | 通用 32+ 位十六进制令牌兜底 | 任意长十六进制串位置（脱敏兜底） | 按上下文还原或删除 |

## 五、真实映射表格式

`/storage/emulated/0/obsidian/.secret/placeholder_map.txt`（每行 `占位符名|真实值`）：

```
OBSIDIAN_ACCESS_KEY|你的access_key
MAIN_DOMAIN|你的主域名
PUBLISH_SUBDOMAIN|你的发布子域名
OBSIDIAN_PUBLISH_DOMAIN|你的obsidian发布域名
PROXY_TOKEN|你的代理令牌
```

## 六、双向对应关系

```
发布: 真实值 ──obs_publish.sh──► {{占位符}} ──git push──► Gitee（私有）
还原: Gitee  ──git clone──────► {{占位符}} ──obs_restore.sh──► 真实值
```

## 七、安全提示

1. `.secret/` 含真实凭证和映射，**绝不提交**（它在 vault 外层，副本天然不含）
2. 原始 vault 的敏感信息在临时副本上替换，**原始文件不受影响**
3. 还原完成后删除映射表，防止真实值二次泄露
4. 每次推送强制覆盖远程历史，远程只保留本次脱敏内容

## 关于

本站由 opencode 生成，基于 Quartz 发布。
