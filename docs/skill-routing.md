# Skill 路由

Mapflow 只加载当前模型边界需要的能力；各 Skill 通过明确产物衔接。

| 当前需要 | Skill | 产物 | 完成条件 |
| --- | --- | --- | --- |
| 把模糊愿望变成目标谓词 | `destination-shaping` | Destination Contract | 目标、验收、不变量和授权可判断 |
| 勘探仓库型工作的起始地 | `repository-recon` | 四值 Fact 与代码影响面 | 关键仓库事实有来源或探针 |
| 找路、证明、修图 | `blueprint-planning` | State Node、Work Edge、proof gaps | 结构完整且逻辑/条件可达 |
| 让一条边可独立执行 | `edge-slicing` | 语义化 Task Brief | 执行面、证据和失败边界完整 |
| 执行当前工作边 | `edge-delivery` | 产物与 Evidence Record | effects 有实际证据并更新 Fact |

旁路能力：

非仓库工作直接按行为真源从文档、会议、人员或外部系统固定起始 Fact，不加载 `repository-recon`。

- 关键意图取舍：`grilling`；
- 外部一手事实：`research`；
- 现成方案与组件：`prior-art`；
- 一次性设计疑问：`prototype`；
- 术语与不可逆架构取舍：`domain-modeling`；
- 行为测试先行：`tdd`；
- 已知故障：`diagnosing-bugs`；
- 非微小改动复核：`code-review`；
- 跨会话或工具交接：`session-handoff`。

普通请求不自动进入 Mapflow。用户明确启用后，从当前 proof gap 或 active edge 选择最窄 Skill；不把所有能力一次加载。
