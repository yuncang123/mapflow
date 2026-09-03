---
map: vibe-coding-v1
status: arrived
updated: 2026-09-01
---

# 地图：工程化高质量高效率 Vibe Coding v1

## Destination

在 `aigineer` 中交付一套可被个人 Agent 稳定执行的地图优先工作模式：先勘探现状与收敛目的地，再按已批准节点逐步实施；阶段、当前节点、偏差重规划和到达审计可被跨会话恢复和机器检查。

## Current state

- 已有文档型单人工作流和三档路径。
- 已确认蓝图应始终存在，但粒度随任务规模变化。
- 已确认仅靠自然语言或一次性 skill 触发不足以防止实施提前发生。
- 当前仓库没有状态工具、入口 skill 或地图模板。

## Route

| 节点 | 目标状态 | 交付物 | 验收 |
| --- | --- | --- | --- |
| N1 | 状态模型和命令边界明确 | 状态 schema 与 CLI 设计 | 状态转换和非法转换可枚举 |
| N2 | 实施前有可执行门槛 | 零依赖状态工具与测试 | 未批准地图时 gate 失败，批准后只允许当前节点 |
| N3 | Agent 能稳定进入和切换阶段 | `aigineer` 入口 skill 与触发协议 | 触发语、阶段状态和升级条件一致 |
| N4 | 工作流文档与模板反映地图优先 | `docs/workflow.md`、路由和模板 | 文档只保留一个行为真源，内部链接通过 |
| N5 | v1 可被实际使用 | README、示例状态和使用说明 | 从 map 到 arrive 的场景测试通过 |

## Decisions so far

- **地图优先是默认模式**：不是只有大任务才规划，而是所有任务都有最小蓝图；复杂度决定分辨率和是否持久化。
- **目的地锁定结果，不锁死实现**：验收状态、边界和非目标必须明确，具体代码方案允许由证据推动修订。
- **触发词与状态门并用**：用户用少量阶段语句表达意图，工具状态阻止 Agent 在未批准时进入施工。
- **路线可重算**：每个节点完成后更新现状；发现偏差进入 `replan`，不沿旧地图硬走。
- **工具保持轻量**：只管理地图阶段和证据边界，不复制 CoAgentWorkflow 的多人治理、Flow 或任务账本。

## Not yet specified

- 不同宿主的 skill 安装和启动适配方式；v1 只定义工作流状态，不管理宿主配置。
- 自动从 Git diff 推断当前节点；v1 要求 Agent 或用户显式更新状态。
- 面向团队的并发写集、审批和远程执行；交给目标项目已有协作系统。

## Out of scope

- 自动替用户决定产品价值、发布、凭证使用或不可逆操作。
- 生成“完美实现计划”或预测所有代码文件。
- 用状态工具替代测试、代码审查或真实产品验收。

## Arrival criteria

- [x] 有单一入口 skill，能识别地图、批准、执行、重规划和到达审计五类动作。
- [x] `.aigineer/state.json` 能表达阶段、目的地状态、当前节点、已完成节点和上次验证。
- [x] `gate` 在 `implementation + approved + current_node` 之外拒绝写入前置条件。
- [x] 每个状态转换有测试，非法跳转不会静默成功。
- [x] 文档、模板、skill 和工具的术语一致，链接和空白检查通过。
- [x] 运行场景覆盖正常路线、未批准施工、偏差重规划和最终到达。

## Execution evidence

- `python -B -m unittest discover -s tests -p 'test_*.py' -v`：4/4 通过。
- `python -B tools/aigineer.py --help`：入口和 8 个状态命令可发现。
- 实际状态链：`init → approve → gate → verify(N1..N5) → arrive`，最终 `phase=arrived`。
- 文档 Markdown 链接、尾随空白和 `git diff --check`：通过。
