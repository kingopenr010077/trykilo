# trykilo

## notebooklm-py 深度技术研究报告

> 基于源码级分析（v0.8.1, main branch, 2026-08-15）

---

## 1. 项目概述

**notebooklm-py** 是 Google NotebookLM（2026 年 7 月更名为 Gemini Notebook）的**非官方** Python 自动化库，由独立开发者 Teng Lin 维护。它通过逆向工程 Google 内部未公开的 RPC API，提供对 NotebookLM 完整功能的程序化访问，包括 Web UI 未暴露的能力。

| 属性 | 详情 |
|------|------|
| **仓库** | `teng-lin/notebooklm-py` |
| **版本** | 0.8.1 |
| **Stars** | 18.7k |
| **Forks** | 2.5k |
| **许可证** | MIT |
| ** commits** | 2,184 |
| **Python** | >= 3.10 |
| **核心依赖** | httpx, click, rich, filelock |
| **状态** | 活跃开发中 |

---

## 2. 核心定位与价值主张

### 2.1 不是什么

- **不是官方 Google 产品** — 使用未公开 API，随时可能失效
- **不是 OCR/文档解析工具** — 它是 NotebookLM 的自动化客户端
- **不是独立 AI 模型** — 它驱动 Google 的 Gemini Notebook 服务

### 2.2 核心价值

| 价值 | 说明 |
|------|------|
| **零-token 推理卸载** | 让 NotebookLM/Gemini 做 heavy analysis，Agent 只做最终润色 |
| **程序化批量操作** | Web UI 只能单文件上传，此库支持批量 URL/文件/Drive 导入 |
| **Web UI 未暴露的能力** | 批量下载、quiz/flashcard 多格式导出、mind map JSON 提取、slide revision |
| **Agent 原生集成** | 作为 Claude Code / Codex / OpenClaw 的 MCP Server 或 Agent Skill |
| **持久化记忆** | 通过 notebook 实现跨会话的 grounded recall |

---

## 3. 深度架构分析

### 3.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Public API Surface                           │
│  NotebookLMClient (client.py)                                       │
│  ├── notebooks: NotebooksAPI                                        │
│  ├── sources: SourcesAPI                                            │
│  ├── artifacts: ArtifactsAPI                                        │
│  ├── chat: ChatAPI                                                  │
│  ├── research: ResearchAPI                                          │
│  ├── notes: NotesAPI                                                │
│  ├── mind_maps: MindMapsAPI                                         │
│  ├── settings: SettingsAPI                                          │
│  ├── sharing: SharingAPI                                            │
│  ├── labels: LabelsAPI                                              │
│  └── collections: CollectionsAPI                                    │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Client Assembly (_client_assembly.py)           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────────┐  │
│  │ AuthTokens  │  │ ClientSeams │  │ RuntimeCollaborators         │  │
│  │ (auth.py)   │  │ (injection) │  │ (7 collaborators)           │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────────┘  │
│                              │                                      │
│                              ▼                                      ▼
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ compose_client_internals (_runtime/init.py)                  │    │
│  │ 1. validate_constructor_args()                               │    │
│  │ 2. build_collaborators() → RuntimeCollaborators              │    │
│  │ 3. wire_middleware_chain() → WiredMiddleware                 │    │
│  │ 4. build_runtime_transport() → RuntimeTransport              │    │
│  │ 5. RpcExecutor(...)                                          │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        RPC Protocol Layer                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────────┐  │
│  │   Encoder   │  │   Decoder   │  │ RpcExecutor                  │  │
│  │ (encoder.py)│  │ (decoder.py)│  │ (_rpc_executor.py)           │  │
│  │             │  │             │  │                              │  │
│  │ Triple-nest │  │ wrb.fr/er   │  │ - Idempotency check         │  │
│  │ [[[id,     │  │ - Chunked   │  │ - Refresh budget             │  │
│  │   params]]]│  │   parse     │  │ - Retry deadline             │  │
│  │ - URL build │  │ - Status    │  │ - Transport dispatch         │  │
│  │ - CSRF token│  │   decode    │  │ - Auth refresh + retry       │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Middleware Chain (ADR-0009)                      │
│  [Drain] → [Metrics] → [Semaphore] → [Retry] → [AuthRefresh]        │
│       → [ErrorInjection] → [Tracing]                                │
│                                                                      │
│  Each middleware wraps RpcRequest/Response via NextCall Protocol     │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Transport Layer                              │
│  ┌─────────────────────┐    ┌─────────────────────────────────────┐  │
│  │ RuntimeTransport    │    │ CurlCffiAsyncClient (optional)      │  │
│  │ (httpx default)     │    │ (_curl_cffi_transport.py)           │  │
│  │                     │    │ - Browser TLS/JA3 impersonation     │  │
│  │ - perform_authed_post│   │ - Chrome fingerprint                 │  │
│  │ - stream_post       │    │ - SSRF redirect guard               │  │
│  └─────────────────────┘    └─────────────────────────────────────┘  │
│                              │                                      │
│                              ▼                                      │
│                    Kernel (HTTP Client Owner)                        │
│                    - httpx.AsyncClient lifecycle                     │
│                    - Cookie jar management                           │
│                    - Connection pool                                 │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Google NotebookLM Backend                         │
│                    batchexecute RPC Endpoint                        │
│                    (Undocumented Internal API)                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 三层适配器架构

项目严格遵循 **Transport-Neutral App Layer** 原则（ADR-0021）：

```
┌─────────────────────────────────────────────────────────────┐
│                     Adapter Layer                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────────────┐  │
│  │   CLI    │  │   MCP    │  │  REST Server (FastAPI)   │  │
│  │ (click)  │  │(FastMCP) │  │  (/v1/* routes)          │  │
│  └──────────┘  └──────────┘  └──────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              _app/ (Transport-Neutral Business Logic)        │
│  - notebooks.py, sources.py, chat.py, artifacts.py, etc.    │
│  - NO click/rich/fastmcp imports (enforced by guardrails)   │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              rpc/ (Protocol Layer)                           │
│  - types.py, encoder.py, decoder.py, _safe_index.py         │
└─────────────────────────────────────────────────────────────┘
```

### 3.3 核心设计模式

| 模式 | 实现 | 位置 |
|------|------|------|
| **Capability Protocol** | 功能 API 通过 Protocol 接收依赖，而非 broad host | `_runtime/contracts.py` |
| **Composable Session** | 7 个独立 collaborator 通过 composition root 组装 | `_client_assembly.py` |
| **Middleware Chain** | 7 层 around-style 中间件，Protocol-based | `_middleware/` |
| **Idempotency Registry** | 5 级分类：READ_ONLY, IDEMPOTENT, SET_STATE, PROBE_THEN_CREATE, UNCLASSIFIED | `_idempotency.py` |
| **Transport-Neutral App** | `_app/` 不导入任何 adapter 依赖 | `_app/` |
| **Public Facade / Private Impl** | `_` 前缀 = 不支持直接导入 | 全项目 |
| **Regenerable Baselines** | VCR cassette 作为测试基线 | `tests/cassettes/` |
| **Single Flight Refresh** | 并发失败 RPC 只触发一次 refresh | `_auth/` |

---

## 4. RPC 协议深度解析

### 4.1 通信机制

NotebookLM 使用 Google 内部的 **batchexecute** RPC 协议（与 Google Docs/Sheets 相同）：

```
Request:
  URL: https://notebooklm.google.com/_/NotebookLMWebServer/BatchExecute
       ?authuser=0&_reqid=<reqid>&rt=c
  Body: f.req=<triple-nested JSON>&at=<CSRF_TOKEN>&

Triple-nested JSON:
  [[[rpc_id, json_params, null, "generic"]]]

Response (chunked):
  <byte_count>\n
  <json_payload>\n
  <byte_count>\n
  <json_payload>\n
  ...

JSON payload tags:
  - "wrb.fr" = function response (success/error)
  - "er" = error response
```

### 4.2 RPC 编解码器

**Encoder** (`rpc/encoder.py`):
- `encode_rpc_request()` — 构建 triple-nested array
- `build_request_body()` — form-encode + CSRF token
- `nest_source_ids()` — 按深度包装 source ID

**Decoder** (`rpc/decoder.py`):
- `strip_anti_xssi()` — 移除 `)]}'` 前缀
- `parse_chunked_response()` — 解析 chunked 格式，容忍 byte-count 不匹配
- `collect_rpc_ids()` — 收集所有 RPC ID
- `extract_rpc_result()` — 提取最后一个非空 wrb.fr frame
- `decode_response()` — 完整解码管线

**关键发现**：
- 响应中 `wrb.fr` frame 的 index 5 携带 `google.rpc.Status` 数组
- 某些 RPC（如 `REMOVE_RECENTLY_VIEWED`）返回 null result + status，被 client 吞掉
- 响应可能包含多个同一 RPC ID 的 frame（placeholder → real）

### 4.3 已知 RPC Method IDs（部分）

项目通过逆向工程识别了大量 RPC 方法，存储在 `rpc/types.py`：

- `CREATE_NOTEBOOK`, `GET_NOTEBOOK`, `LIST_NOTEBOOKS`
- `ADD_SOURCE`, `LIST_SOURCES`, `DELETE_SOURCE`
- `CHAT_ASK`, `GET_CHAT_HISTORY`
- `GENERATE_AUDIO`, `GENERATE_VIDEO`, `GENERATE_REPORT`
- `START_RESEARCH`, `POLL_RESEARCH`, `IMPORT_RESEARCH`
- `CREATE_NOTE`, `LIST_NOTES`
- `GET_SHARE_STATUS`, `SET_SHARE_PUBLIC`

---

## 5. 认证系统深度解析

### 5.1 认证层级

```
┌─────────────────────────────────────────────────────────────┐
│  Level 1: Cookie-based Auth                                 │
│  - storage_state.json (Playwright 登录导出)                  │
│  - 包含 SID, HSID, SSID, SAPISID, SIDTS 等                  │
│  - 通过 extract_wiz_field() 提取 SNlM0e (CSRF) + FdrFJe (SID)│
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Level 2: Master Token Auth (ADR-0023)                       │
│  - master_token.json (gpsoauth 交换)                         │
│  - 无头服务器自愈，无需浏览器                                 │
│  - mint_service.py 负责 token 交换                           │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Level 3: Headless Re-auth (opt-in)                          │
│  - 使用 Playwright 无头浏览器重新登录                         │
│  - NOTEBOOKLM_HEADLESS_REAUTH=1                              │
│  - headless_reauth.py                                        │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Level 4: Refresh Cmd Re-auth                                │
│  - NOTEBOOKLM_REFRESH_CMD_MIDSESSION=1                       │
│  - refresh.py                                                │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 Cookie 生命周期管理

**Cookie 存储** (`_cookie_persistence.py`, 506 行):
- `CookiePersistence` — 内存中的 cookie 快照管理
- 基于 filelock 的进程间锁
- CAS (Compare-And-Swap) 语义

**Cookie 策略** (`_auth/cookie_policy.py`):
- 域名白名单：`.google.com`, `.googleapis.com`, `.gstatic.com`, `.youtube.com`
- Cookie 过滤：仅保留必要字段

**PSIDTS 恢复** (`_auth/psidts_recovery.py`):
- Google 定期轮换 PSIDTS cookie
- 自动检测 + 恢复机制
- `_auth/keepalive.py` 负责定期刷新

### 5.3 认证刷新机制

**AuthRefreshCoordinator** (`_runtime/auth.py`):
- Single-flight 模式：N 个并发失败 RPC 只触发 1 次 refresh
- Refresh 预算：每个 logical RPC call 只消耗 1 次 refresh
- 快照序列化：防止并发 refresh 冲突

**Refresh 流程** (`_auth/session.py`):
1. GET NotebookLM 首页
2. 检查是否 302 到 Google 登录页（cookies 已死）
3. 提取 SNlM0e (CSRF) + FdrFJe (Session ID)
4. 如果失败 → 尝试 L2.5 refresh cmd → L3 headless → L4 master token

---

## 6. 中间件链深度解析（ADR-0009）

### 6.1 七层中间件

| 顺序 | 中间件 | 职责 |
|------|--------|------|
| 1 | **DrainMiddleware** | 关闭期间 admission control，防止新请求进入 |
| 2 | **MetricsMiddleware** | RPC 调用计数、延迟、错误分类 |
| 3 | **SemaphoreMiddleware** | `max_concurrent_rpcs` 并发控制 |
| 4 | **RetryMiddleware** | 429/5xx 自动重试，指数退避 |
| 5 | **AuthRefreshMiddleware** | 401 检测 → refresh → retry |
| 6 | **ErrorInjectionMiddleware** | 测试用错误注入 |
| 7 | **TracingMiddleware** | 请求追踪 |

### 6.2 关键设计

```python
# Middleware Protocol
class Middleware(Protocol):
    async def __call__(self, request: RpcRequest, next_call: NextCall) -> RpcResponse: ...

# Chain composition (build_chain)
def build_chain(middlewares: Sequence[Middleware], terminal: NextCall) -> NextCall:
    # 反向组合，第一个 middleware 成为 outermost wrapper
    chain = terminal
    for mw in reversed(middlewares):
        chain = make_wrapper(mw, chain)
    return chain
```

**重要约束**：
- 中间件链不感知 RPC 语义，只处理 HTTP envelope
- RPC 编解码在链外（`RpcExecutor.rpc_call`）
- Auth refresh 通过 `RefreshBudget` 确保每个 logical call 只 refresh 一次
- `RuntimeDeadline` 确保 retry 后 sleep 不超过原始超时

---

## 7. 幂等性与重试机制

### 7.1 五级幂等分类（ADR-0005）

| 分类 | 说明 | RPC 示例 |
|------|------|----------|
| **READ_ONLY** | 纯读取，可安全重试 | LIST_NOTEBOOKS, GET_SOURCE |
| **IDEMPOTENT** | 多次执行结果相同 | SET_NOTE_TITLE (相同值) |
| **SET_STATE** | 设置状态，幂等 | MARK_READY |
| **PROBE_THEN_CREATE** | 先 probe 再 create，需特殊处理 | CREATE_NOTEBOOK, ADD_SOURCE |
| **UNCLASSIFIED** | 未知，默认禁用内部重试 | - |

### 7.2 Probe-Then-Create 模式

```python
# idempotent_create() 工作原理：
# 1. 以 disable_internal_retries=True 执行 create RPC
# 2. 如果成功 → 返回结果
# 3. 如果失败（可能已提交）→ 执行 probe（如 list notebook by title）
# 4. 如果 probe 找到匹配 → 返回已有资源
# 5. 如果 probe 找不到 → 标记为 UNCONFIRMED（写入状态未知）
```

**关键创新** — `mark_unconfirmed()`:
- 当 probe 无法确定写入是否提交时，标记异常
- 防止盲目重试导致重复创建
- 要求调用者手动 reconcile

---

## 8. 传输层深度解析

### 8.1 双传输实现

**默认传输** (`httpx`):
- 标准 `httpx.AsyncClient`
- 支持 streaming upload
- 自动 redirect 处理

**curl_cffi 传输** (`_curl_cffi_transport.py`, 538 行):
- 浏览器 TLS/JA3 指纹模拟
- 解决 Google 反爬检测
- 通过 `NOTEBOOKLM_TRANSPORT=curl_cffi` 启用
- 模拟 Chrome 的 TLS 握手特征

```python
class CurlCffiAsyncClient:
    def __init__(self, *, impersonate: str = "chrome"):
        self._curl = AsyncSession(
            cookies=self.cookies.jar,
            impersonate=impersonate,  # Chrome TLS fingerprint
        )
```

**SSRF 防护** (`get_guarded`):
- 手动处理 redirect，每跳验证 host
- 防止 `%2e` 等 URL 编码绕过
- `quote=False` 确保验证的 URL 就是连接的 URL

---

## 9. 客户端组装与依赖注入

### 9.1 7 个 Runtime Collaborators

| Collaborator | 职责 | 关键方法 |
|-------------|------|---------|
| **ClientMetrics** | RPC 指标收集 | increment, record_lock_wait |
| **TransportDrainTracker** | 关闭时 drain 管理 | get_drain_condition, register_drain_hook |
| **ReqidCounter** | 请求 ID 生成 | value (monotonic) |
| **AuthRefreshCoordinator** | 认证刷新协调 | await_refresh, snapshot, update_auth_tokens |
| **Kernel** | HTTP 客户端生命周期 | open, post, aclose |
| **ClientLifecycle** | 客户端生命周期 | open, close, assert_bound_loop |
| **CookiePersistence** | Cookie 持久化 | _from_store |

### 9.2 组装流程

```
NotebookLMClient.__init__(auth, ...)
    │
    ▼
_assemble_client(client, auth=..., ...)
    │
    ├── normalize storage_path
    ├── resolve_client_seams() → ClientSeams
    ├── compose_client_internals()
    │       ├── validate_constructor_args() → ValidatedSessionConfig
    │       ├── build_collaborators() → RuntimeCollaborators
    │       ├── wire_middleware_chain() → WiredMiddleware
    │       ├── build_runtime_transport() → RuntimeTransport
    │       └── RpcExecutor(...)
    ├── SourceUploadPipeline(...)
    └── Wire all feature APIs (sources, notebooks, artifacts, ...)
```

---

## 10. 研究功能（Research API）深度解析

### 10.1 研究流程

```
client.research.start(notebook_id, query, mode="fast"|"deep")
    │
    ▼
START_RESEARCH / START_DEEP_RESEARCH RPC
    │
    ▼
返回 ResearchStart { task_id, status }
    │
    ▼
poll_and_classify() — 轮询直到完成
    │
    ▼
返回 ResearchStatus { status, sources, report, ... }
    │
    ▼
client.research.import_sources(notebook_id, task_id, sources)
    │
    ▼
IMPORT_RESEARCH RPC — 批量导入发现的来源
    │
    ▼
返回 ResearchImportResult { imported, skipped, failed }
```

### 10.2 研究导入验证

**import_sources_with_verification()**:
1. 分区请求的来源（可导入 vs 不可导入）
2. 对每个来源执行 IMPORT_RESEARCH
3. 验证结果：检查返回的来源 URL 是否与请求匹配
4. 合并导入的来源

**idempotency 预过滤**（#1961）:
- 导入前检查来源是否已存在
- 避免重复导入相同 URL

---

## 11. MCP Server 实现

### 11.1 架构

```
FastMCP Server (fastmcp==3.4.2)
    │
    ├── lifespan: 单例 NotebookLMClient
    │
    ├── AuthProvider:
    │   ├── Bearer Token (NOTEBOOKLM_MCP_TOKEN)
    │   ├── Self-hosted OAuth (NOTEBOOKLM_MCP_OAUTH_*)
    │   └── MultiAuth (composite)
    │
    ├── Tools (register_all):
    │   ├── notebooks: list/create/describe/rename/delete
    │   ├── sources: add/read/rename/delete/wait + drive import
    │   ├── chat: ask + configure + suggest_prompts
    │   ├── notes: save (upsert) + read/rename/delete (via studio)
    │   ├── studio: unified notes+artifacts surface
    │   │   ├── studio_list, studio_get, studio_generate
    │   │   ├── studio_download, studio_rename, studio_delete
    │   │   └── studio_retry
    │   ├── research: start/status/import
    │   ├── sharing: status/set_access/set_user/remove_user
    │   └── meta: server_info
    │
    └── Remote File Transfer (ADR-0024):
        ├── /files/dl — signed URL download
        └── /files/ul — signed URL upload
```

### 11.2 安全特性

- **Loopback Host Guard**: 拒绝非 loopback Host header（DNS rebinding 防护）
- **Bearer Auth**: 仅 env var，永不记录
- **OAuth 2.1**: 自托管 OAuth AS，密码门控 + scrypt + 速率限制
- **File Transfer**: HMAC-signed URL，15min-1h TTL

---

## 12. REST Server 实现

### 12.1 路由

| 路由 | 方法 | 功能 |
|------|------|------|
| `/v1/notebooks` | GET/POST | 列表/创建 |
| `/v1/notebooks/{id}` | GET/PATCH/DELETE | 获取/重命名/删除 |
| `/v1/notebooks/{id}/sources` | GET/POST | 列表/添加 |
| `/v1/notebooks/{id}/chat` | POST | 问答 |
| `/v1/notebooks/{id}/artifacts` | GET/POST | 列表/生成 |
| `/v1/notebooks/{id}/research` | GET/POST | 研究状态/启动 |
| `/v1/notebooks/{id}/share` | GET/POST | 分享管理 |

### 12.2 安全

- **Bearer Token Auth**: 仅 loopback 或显式 `NOTEBOOKLM_SERVER_ALLOW_EXTERNAL=1`
- **DNS Rebinding Guard**: Host header 验证
- **Concurrency Limits**: 每路由组 lifespan-owned limiter

---

## 13. 测试策略

### 13.1 测试架构

```
tests/
├── unit/                    # 单元测试
├── integration/             # 集成测试（VCR cassette 录制）
│   ├── cli_vcr/            # CLI 集成测试
│   ├── test_*_integration.py
│   └── concurrency/        # 并发测试
├── server/                 # REST server 测试
├── e2e/                    # 端到端测试（需认证）
├── cassettes/              # VCR 录制
│   └── *.yaml              # HTTP 交互录制
├── fixtures/               # 测试数据
├── _fixtures/              # 测试工厂
├── _guardrails/            # 架构守卫
│   ├── test_app_boundary.py           # _app/ 不导入 adapter
│   ├── test_classify_error_handler_consistency.py
│   ├── test_client_factory_parity.py   # 工厂与构造函数一致
│   └── test_no_forbidden_monkeypatches.py
└── _baselines/             # 可再生基线
```

### 13.2 关键测试策略

| 策略 | 实现 |
|------|------|
| **VCR Cassettes** | 录制 HTTP 交互，重放测试 |
| **Guardrails** | 架构规则自动检查（边界、一致性、monkeypatch） |
| **Regenerable Baselines** | 测试基线可重新生成 |
| **Per-file Coverage Floors** | 关键文件 90%+ 覆盖率 |
| **Constructor Injection** | 测试工厂通过 DI 注入 mock |

---

## 14. 代码组织与规模

### 14.1 模块统计

| 模块 | 文件数 | 说明 |
|------|--------|------|
| `src/notebooklm/` | ~150+ | 核心源码 |
| `src/notebooklm/_app/` | 20 | 传输中性业务逻辑 |
| `src/notebooklm/_auth/` | 30+ | 认证系统 |
| `src/notebooklm/_middleware/` | 10 | 中间件链 |
| `src/notebooklm/cli/` | 40+ | CLI 实现 |
| `src/notebooklm/mcp/` | 20+ | MCP Server |
| `src/notebooklm/server/` | 10 | REST Server |
| `src/notebooklm/rpc/` | 6 | RPC 协议 |
| `tests/` | 80+ | 测试 |

### 14.2 核心文件大小

| 文件 | 行数 | 职责 |
|------|------|------|
| `client.py` | 1018 | 主客户端 |
| `_rpc_executor.py` | 698 | RPC 执行 |
| `_research.py` | 1043 | 研究 API |
| `_sources.py` | ~1200 | 来源管理 |
| `_notebooks.py` | ~1500 | 笔记本管理 |
| `_artifacts.py` | ~1200 | 产物管理 |
| `_auth/session.py` | ~400 | 认证刷新 |
| `_idempotency.py` | 619 | 幂等性 |
| `_cookie_persistence.py` | 506 | Cookie 持久化 |
| `_curl_cffi_transport.py` | 538 | curl_cffi 传输 |

---

## 15. 关键 ADR（架构决策记录）

| ADR | 标题 | 状态 |
|-----|------|------|
| 0001 | Layered seams + property-bridge policy | Superseded |
| 0005 | Idempotency taxonomy | Accepted |
| 0009 | Middleware chain ordering | Accepted |
| 0013 | Composable session capabilities | Accepted |
| 0014 | Feature-local runtime adapters | Accepted |
| 0019 | Error and return contract | Accepted |
| 0021 | Transport-neutral app layer | Accepted |
| 0022 | Regenerable baselines | Accepted |
| 0023 | Master-token headless auth | Accepted |
| 0024 | MCP remote file transfer | Accepted |
| 0025 | MCP tool granularity | Accepted |
| 0026 | MCP studio surface | Accepted |
| 0027 | MCP app upload widget | Accepted |
| 0029 | Canonical storage writer | Accepted |
| 0030 | One recovery ladder | Accepted |
| 0032 | Cookie types + profile document | Rolling out |

---

## 16. 安全分析

### 16.1 已知风险

| 风险 | 严重性 | 说明 |
|------|--------|------|
| **未公开 API** | 高 | Google 可随时变更，无 SLA |
| **账号封禁** | 中 | 大量自动化调用可能触发反爬 |
| **数据隐私** | 中 | 文档内容上传到 Google 服务 |
| **Token 泄露** | 高 | `storage_state.json` 是 bearer credential |

### 16.2 安全措施

- **Credential 保护**: `NOTEBOOKLM_AUTH_JSON` 仅 env var，不落盘
- **SSRF 防护**: `get_guarded()` 每跳验证 host
- **DNS Rebinding 防护**: loopback-only bind + Host header 验证
- **File Transfer 安全**: HMAC-signed URL，短期 TTL
- **OAuth 安全**: scrypt 密码哈希 + 速率限制 + DCR 上限

---

## 17. 使用方式对比

| 方式 | 适用场景 | 复杂度 |
|------|----------|--------|
| **CLI** | 快速脚本、CI/CD | 低 |
| **Python API** | 应用集成、async 工作流 | 中 |
| **MCP Server** | Claude Code/Codex Agent | 中 |
| **REST Server** | 本地 HTTP 自动化 | 中 |
| **Agent Skill** | Claude/Cursor 等 Agent | 低 |

---

## 18. 典型工作流示例

### 18.1 批量文档 → 播客

```python
async with NotebookLMClient.from_storage() as client:
    # 1. 创建 notebook
    nb = await client.notebooks.create("Research")
    
    # 2. 批量导入来源
    for url in urls:
        await client.sources.add_url(nb.id, url, wait=True)
    
    # 3. 生成播客
    status = await client.artifacts.generate_audio(
        nb.id, 
        instructions="Make it engaging for beginners"
    )
    
    # 4. 等待完成
    final = await client.artifacts.wait_for_completion(nb.id, status.task_id)
    
    # 5. 下载
    await client.artifacts.download_audio(nb.id, "podcast.m4a")
```

### 18.2 研究 → 测验

```python
async with NotebookLMClient.from_storage() as client:
    nb = await client.notebooks.create("AI Research")
    
    # 深度研究
    task = await client.research.start(nb.id, "LLM reasoning", mode="deep")
    result = await client.research.wait_for_completion(nb.id, task.task_id)
    
    # 导入来源
    await client.research.import_sources(nb.id, task.task_id, result.sources[:10])
    
    # 生成测验
    quiz_status = await client.artifacts.generate_quiz(nb.id, difficulty="hard")
    quiz = await client.artifacts.wait_for_completion(nb.id, quiz_status.task_id)
    
    # 导出
    await client.artifacts.download_quiz(nb.id, "quiz.json", output_format="json")
```

---

## 19. 与同类工具对比

| 维度 | notebooklm-py | Firecrawl Parse | HunyuanOCR | anydoc |
|------|---------------|-----------------|------------|--------|
| **类型** | NotebookLM 自动化客户端 | 文档解析 API | OCR VLM | 文档转 Markdown |
| **输入** | 文档/URL/YouTube/Drive | 文档/URL | 图片/PDF | Word/Excel/PPT/PDF |
| **输出** | 音频/视频/测验/报告/播客 | Markdown | 文本 | Markdown |
| **OCR** | 通过 NotebookLM | 通过托管 OCR | 端到端 OCR | 无 |
| **部署** | 需 Google 账号 | 托管 API | 本地/PC | 本地 |
| **速度** | 分钟级（云端生成） | 秒级 | 秒级 | 毫秒级 |
| **Agent 集成** | MCP/Skill | API | 本地部署 | CLI |

---

## 20. 限制与注意事项

### 20.1 技术限制

1. **非官方 API**: Google 可随时变更内部接口
2. **速率限制**: 大量调用可能被限流
3. **需要 Google 账号**: 依赖 NotebookLM 服务可用性
4. **网络依赖**: 所有生成任务需云端完成
5. **认证复杂性**: Cookie/master-token/headless 多种路径

### 20.2 使用建议

- **生产环境**: 使用 master token + `NOTEBOOKLM_AUTH_JSON` env var
- **CI/CD**: 设置 `NOTEBOOKLM_AUTH_JSON` 为 secret
- **并行工作流**: 使用显式 notebook ID + 独立 profile
- **长期运行**: 配置 keepalive + auth refresh cron

---

## 21. 总结

notebooklm-py 是一个**工程 excellence** 级别的开源项目，展示了：

1. **逆向工程的严谨性**: 通过 VCR cassettes、guardrails、regenerable baselines 维护对未公开 API 的追踪
2. **架构的成熟度**: ADR 驱动的分层架构、transport-neutral app layer、composable session
3. **生产就绪的可靠性**: 幂等性、single-flight refresh、多层次 auth recovery、SSRF 防护
4. **Agent 时代的思维**: MCP server、Agent Skill、remote connector 支持

它的核心价值不在于"调用 Google API"，而在于**将 NotebookLM 的 grounded reasoning 能力封装为可编程、可批量、可自动化的基础设施层**，使 Agent 能够以极低 token 成本利用 Google 的 heavy analysis 能力。
