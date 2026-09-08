# Mapflow 快速回归 Prior Art

日期：2026-09-07

## 问题

完整陌生 Codex 旅程一次可持续数小时。它适合发布候选的产品体验验证，不适合每个局部修复。需要把回归拆成确定性 Oracle、Runtime 状态门、受影响 Agent 阶段和发布级完整旅程，并允许从已经证明合法的状态继续测试。

本需求属于 stateful agent checkpoint、录制轨迹回放和测试影响选择。先检查本仓库，再核对公开生态。

## 仓库内基础

现有 `benchmark prepare` 已冻结 case、fixture 和 Oracle；`check` 已把 BoardModel observation、断言、Git diff 和隐藏 verifier 结果写入 run；`agent-turn` 已隔离 Codex 会话与评测目录。缺口不是新的评测器，而是：

- 把一个已通过 checkpoint 的目标仓库、Sidecar 和前置判定保存成可移植联合快照；
- 从联合快照建立新的陌生 Agent 分段 run，且不能冒充完整旅程；
- 用已有 observation 重新执行当前 Oracle 断言，快速发现评测合同回退；
- 按改动路径选择最小测试层，发布级完整旅程保持显式触发。

## 候选

| 候选 | 可复用点 | 不直接采用的原因 | 裁决 |
| --- | --- | --- | --- |
| 本仓库现有 benchmark runner | 已有稳定 run/case/checkpoint ID、隔离、隐藏 Oracle 和 JSONL 证据 | 尚无联合状态快照、分段报告和 replay | 直接扩展 |
| LangGraph persistence/time travel | checkpoint、thread、从历史状态创建分支；官方文档把 checkpoint 作为 super-step 状态快照 | checkpoint 绑定 LangGraph 图状态和 checkpointer；不能恢复任意 Git 工作树、仓库外 Sidecar 与 Mapflow 事件 | 借鉴设计 |
| pytest markers / test selection | 用 marker 和表达式选择小集合，默认快速路径可预测 | Mapflow 是 Node CLI，且影响面还包含文档与 Agent 行为，不值得引入 Python runner | 吸收思想 |
| promptfoo CLI filtering/cache | 支持按 pattern 过滤测试和缓存；适合批量 prompt/eval | 当前 `promptfoo@0.122.2` 带大量模型、服务、遥测和存储依赖；不能恢复本地 Codex 多轮会话的联合状态 | 不采用代码，只借鉴过滤入口 |
| Inspect AI retry/resume | 稳定 sample ID、限制、日志和失败样本恢复 | 现有产品体验 prior-art 已裁决为设计借鉴；Python task runner 仍不能替代真实 Codex + Sidecar 表面 | 延续既有裁决 |

一手资料：

- [LangGraph persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)
- [pytest markers](https://docs.pytest.org/en/stable/example/markers.html)
- [promptfoo CLI](https://www.promptfoo.dev/docs/usage/command-line/)
- [Inspect eval logs](https://inspect.aisi.org.uk/eval-logs.html.md)

包注册表核对：2026-09-07 的 `promptfoo@0.122.2` 为 MIT，但直接依赖包含模型 SDK、Web 服务、OpenTelemetry、数据库、模板和解析组件；`@langchain/langgraph-checkpoint@1.1.5` 为 MIT，但只提供 LangGraph checkpointer 合同。二者的代码采用面都大于本需求。

## 实现裁决

落在“采用仓库现有实现 + 借鉴外部设计”，保持 Node 零新增依赖：

1. `checkpoint-save` 只接受当前仍通过的已固化 checkpoint，冻结目标工作树（不含 `.git`）、Sidecar `current/`、此前 checks/turns 和各部分 digest。
2. `segment-prepare` 从 case 声明的 checkpoint 包创建新 Git 基线、恢复工作树与重新绑定的 Sidecar，并标记 `run_mode: segment`。
3. `segment-turn` 只发送该 segment 的自然语言输入，启动新的、无历史 Codex 会话；`segment-report` 只证明这一段，不生成完整旅程或发布结论。
4. `replay` 对已录制 observation 重跑断言与硬门，不执行业务写入，也不把历史 verifier 结果说成新的运行证据。
5. `regression-plan` 根据改动路径或显式层级选择 `oracle -> runtime -> agent -> release`；自动选择永不升级为 release，完整旅程只由发布候选显式触发。

联合 checkpoint 是评测 fixture，不是生产恢复机制。快照必须保持模型不可见的 Oracle 与目标工作区分离；恢复后由当前 Runtime 和 Oracle 重新检查目标 checkpoint，不能仅信快照标签。
