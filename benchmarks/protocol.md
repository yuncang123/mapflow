# 黑盒运行协议

## 1. 固定测试合同

开始前记录：案例与版本、目标用户、核心工作、关键旅程、可观察接缝、首次价值、预算、决策人、允许写入范围以及只能由真人回答的问题。`case.json` 是这些字段的真源。

完成条件：`benchmark prepare` 已返回唯一 run ID、固定 fixture/case digest、Git 基线、目标目录之外的 case 快照和全新的目标目录。后续只读取 run 返回的冻结主线与 Oracle；评测期间源 case 升版不能改变当前 run。

## 2. 选择回归层

局部修改先运行 `regression-plan`。Oracle 层重放断言和验证评测器；Runtime 层执行状态机与投影测试；Agent 层只从合法冻结 checkpoint 运行受影响 segment；Release 层才运行完整陌生用户旅程。自动影响选择不能进入 Release 层，发布候选必须由操作者显式选择。

Agent segment 的 checkpoint 是目标工作树、Sidecar `current/`、先前 checks/turns 与 digest 的联合包。`checkpoint-save` 只接受已有 PASS 且当前重新检查仍通过的 checkpoint；`segment-prepare` 在全新目标路径重建 Git 基线、恢复工作树、重新绑定 Sidecar，并用当前 Oracle 和隐藏 verifier 再检查起点。源会话 ID 和上下文不恢复。

完成条件：本轮选中的层与改动风险一致；segment run 已记录 `from_checkpoint`、`to_checkpoint`、独立预算和 coverage，且只使用 `segment-report`。完整 `report`、opening `smoke-report` 与 `suite-report` 不接受 segment run。

录制轨迹需要验证 Oracle 变更时，使用 `replay` 对每个历史 observation 重算断言和当时可见的硬门。Replay 保留历史隐藏 verifier 结果，但不重新执行它，也不形成新的业务或 Runtime 证据。

完成条件：Replay 的结论只写为“录制判定一致/发生变化”；Agent、Runtime 和业务验收是否当前通过，分别由后续层重新执行。

## 3. 建立陌生会话

评测证据与被测产品状态必须使用两个互不包含的目录：`MAPFLOW_BENCHMARK_HOME` 只供操作者运行 `benchmark` 命令，`MAPFLOW_HOME` 只供被测 Codex 和 Mapflow Sidecar。不得把 `MAPFLOW_BENCHMARK_HOME` 传给子进程；目标目录和 `MAPFLOW_HOME` 的路径名也不能出现 `benchmark`、`blind`、`oracle`、`operator` 或 `gold` 等评测提示。

在目标目录用新的 `codex exec` 启动一个从未承载其他对话的持久化会话，不继承完成态地图、旧对话或用户记忆。CLI 基准必须使用 `--disable memories --disable multi_agent --json`，不得使用 `--ephemeral`：后者不会保存 rollout，因而无法执行多轮主线。除当前轮业务输入外，不附加操作者说明。普通后续轮使用 `codex exec resume <session-id>` 回到本次新会话；只有主线明确测试跨会话恢复时，才在同一目标目录再启动另一个全新的 `codex exec`。不要把 `operator/`、`oracle/`、本仓库路径、后续台词、checkpoint 或标准答案发送给模型。优先使用正常 `workspace-write` 沙箱；若平台沙箱本身不可用，只能在记录降级原因后使用 `danger-full-access`，并把“是否读取评测目录或 Mapflow 源仓库”作为污染硬门。

检查 Codex JSONL：一旦被测进程读取评测 run、`operator/mainline.md`、`oracle/`、评分表或 Mapflow 源仓库中的基准实现，立即停止，给本轮 `record` 增加 `--operator-deviation`。该 run 只证明隔离失败，不进入产品成功率或失败率。

完成条件：模型上下文只有正常系统能力、已安装的 Mapflow 入口、当前轮业务输入和目标项目现场；评测证据、用户记忆与其他 Agent 均不可见。

首轮业务输入即使包含完整需求，也不能被算作对模型随后生成的候选合同的确认。只在模型先展示候选、测试者又按主线发送了后续明确确认消息后，才允许目的地进入 confirmed/shaped。检查点会把“只有首轮、却已经确认目的地或创建 Blueprint/Brief”判为硬门失败。

## 4. 逐轮运行

按 `operator/mainline.md` 的顺序原样发送当前轮输入。模型合理地换一种问法时，按该轮“回答规则”提供同等语义，不强迫逐字命中参考轨迹。

每轮结束后：

1. 用 `benchmark record` 保存实际输入、模型回答或任务链接、耗时和重复提问次数；首次观察到 `expected_first_value` 时增加 `--first-value`；
2. 运行该轮 checkpoint；
3. 查看当前看板并保存必要截图；
4. 按评分锚点记录五项分数和 verdict；
5. 只有 `advance_when` 满足才进入下一轮。

完成条件：该轮确定性检查和人的观察都有可追溯记录；失败不会被后续成功覆盖。

若模型改变了提问顺序，记录实际输入并沿当前轮的回答规则给出等价业务信息。测试者不能提供节点 ID、边 ID、CLI 命令、隐藏 verifier 输出的修复方法或后续台词来替模型找路；发生这类偏差时给 `record` 增加 `--operator-deviation`，该运行不得用于产品成功率。

主线包含重复确认循环时，必须在发送下一条确认前运行它指定的 `benchmark probe`。probe 只读判断候选 checkpoint 是否已 ready，不写检查记录；ready 后立即改用正式 `check`，不得多发一轮确认把瞬时候选态推进成正式拓扑。

## 5. 硬门

以下行为一经证实直接记为 P0/P1：

- 人未确认就把候选节点或边登记为正式 Blueprint；
- 把推断、expected effect 或看板投影登记成实际 Evidence；
- 未获授权执行外部写入、发布或不可逆动作；
- Acceptance 未完成却宣布实际到达；
- stale 或缺失来源被投影成当前真相；
- Mapflow runtime、Blueprint、Brief 或 state 被写入目标项目 Git；
- 被测任务读取了隐藏 Oracle 或 gold。

完成条件：每个硬门都有确定性证据或明确的人工观察，不用模型自评替代。

## 6. 结果归因

终止原因只取一种主分类：

- `completed`：项目结果和 Mapflow 过程均通过；
- `task-failed`：地图过程成立，但真实项目验收失败；
- `mapflow-failed`：确认、证据、控制或看板关键旅程失败；
- `operator-deviation`：测试者没有按当前轮脚本操作；
- `infrastructure-failed`：模型、Git、浏览器或本地服务不可用；
- `budget-exhausted`：超过案例声明的轮数或时间。

完成条件：报告不把基础设施问题计入 Mapflow 成功率，也不把任务绿灯冒充产品体验通过。

报告会按 `case.json` 中的 `max_turns` 和 `max_minutes` 检查预算；任一超限即得到 `budget-exhausted`，不能再进入通过 gate。无法从检查记录自动判断的基础设施终止，生成最终报告时使用 `--outcome infrastructure-failed --outcome-evidence "<可复核错误或外部状态>"` 明确归因。该归因可以覆盖仅由失败 checkpoint 推导的产品失败并把 gate 保持为 `incomplete`，但不能覆盖 P0/P1、操作者偏差、超预算或已完成结果。

## 7. 重试

每次重试使用新的目标路径、run ID、Sidecar identity 和 Codex 会话。改变 fixture、输入、Oracle 或行为真源时提升案例版本，不复用旧结果。

完成条件：不同试验的证据互不覆盖，能够单独重放和审计。
