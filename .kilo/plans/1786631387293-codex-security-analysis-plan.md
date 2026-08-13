# Codex Security 代码分析计划

## 目标
深入分析 `openai/codex-security` 的漏洞检测原理、数据流和架构，澄清其不是病毒查杀工具，而是基于 LLM 的静态应用安全测试（SAST）扫描器。

## 核心结论
- **检测机制**：不是基于签名的病毒查杀，而是让 LLM（默认 `gpt-5.6-sol`）阅读源代码并推理安全漏洞
- **执行模式**：启动一个 Codex agent 线程，通过 system prompt（SKILL.md）指导 LLM 执行审计
- **结果可信度**：完全依赖 LLM 的推理能力；没有传统 SAST 的污点分析或符号执行

## 已完成的代码分析
1. **CLI/SDK 层**：`cli.ts` 解析参数，`api.ts` 编排扫描生命周期
2. **Prompt 构造**：`scanPrompt()` 将扫描参数注入环境变量，构造包含技能路径、目标、模式的指令
3. **Agent 触发**：通过 `@openai/codex-sdk` 启动 thread，`runStreamed(prompt)` 驱动 LLM
4. **Bundled Plugin Skills**：
   - `security-scan/SKILL.md`：标准扫描，独立基线审计员 + 并行调查者
   - `deep-security-scan/`：深度多轮扫描，带 worker 状态机
   - `security-diff-scan/`：Git diff 扫描
5. **结果收集**：`runScanEvents()` 消费事件流，`collectResult()` 验证并加载 `scan-manifest.json` / `findings.json` / `coverage.json` / `report.md`
6. **合同验证**：`contract.ts` 使用 Ajv 校验 JSON Schema，验证 SHA256 签名、指纹确定性、覆盖率一致性
7. **历史追踪**：`scan-comparison.ts` 用第二个 LLM 线程做语义匹配，识别跨扫描的同一漏洞
8. **Deep Scan 状态机**：`deep_scan_workbench.py` 用 SQLite 管理 worker 生命周期（setup/discovery/dedup）

## 检测原理详解
```
用户代码
   ↓
SDK 构造 prompt（含 skill 路径、目标、模式、知识库）
   ↓
Codex SDK 启动 thread，LLM 读取 SKILL.md 指令
   ↓
LLM 执行：
  - 基线审计子 agent（fork_turns）
  - 并行调查者子 agent
  - 离线源码搜索（ripgrep/git grep）
  - 威胁建模
  - 验证每条 finding 的 source-to-sink 路径
   ↓
LLM 写入 scan-manifest.json / findings.json / coverage.json
   ↓
SDK 验证 JSON Schema + 确定性指纹 + 文件哈希
   ↓
可选：二次 LLM 调用做 findings 语义去重
```

## 关键架构决策
| 决策 | 现状 | 影响 |
|------|------|------|
| 模型固定为 `gpt-5.6-sol` | `config.ts` DEFAULT_CODEX_CONFIG | 扫描质量高度依赖该模型的安全推理能力 |
| 子 agent 用 `fork_turns: "none"` | SKILL.md | 每个 worker 独立推理，无递归委托 |
| 结果文件由 LLM 直接写入 | SKILL.md step 8 | 文件完整性靠后处理 Schema 验证保证 |
| 历史匹配用独立 LLM | scan-comparison.ts | 额外 token 成本，但支持跨扫描去重 |
| Deep Scan 用 SQLite 协调 | deep_scan_workbench.py | 支持 crash recovery，但增加复杂度 |

## 安全边界与限制
- **不是病毒扫描器**：不检查二进制、内存、网络流量、进程行为
- **纯静态分析**：不执行代码、不做运行时污点跟踪
- **LLM 幻觉风险**：finding 可能包含不存在的漏洞或错误路径
- **成本模型**：按 token 收费，大型仓库扫描费用较高
- **认证要求**：需要 OpenAI API key 或 ChatGPT 订阅（企业版需单独申请 Trusted Access）

## 下一步分析建议
1. 阅读 `sdk/typescript/_bundled_plugin/schemas/` 下的 JSON Schema，理解 findings/coverage 的精确数据结构
2. 阅读 `sdk/typescript/_bundled_plugin/scripts/report_projection.py`，了解 Markdown 报告生成逻辑
3. 分析 `cost.ts` 的定价模型，估算不同仓库规模的扫描成本
4. 对比传统 SAST（Semgrep、CodeQL）与 Codex Security 的检测覆盖差异

## 验证方式
- 运行 `npm run build` 编译 TypeScript
- 运行 `npm test` 执行测试套件
- 对小型测试仓库执行 `codex-security scan .` 观察输出

## 未涉及范围（Out of Scope）
- 病毒查杀/反恶意软件功能（该工具不具备）
- Playwright/browser 自动化（SDK 不包含）
- Termux/Android 部署可行性（平台限制，非代码分析范围）
