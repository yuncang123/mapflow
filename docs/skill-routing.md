# Skill 路由

Mapflow 只加载当前边需要的最窄能力。入口始终先取 `context --layer focus`，不会一次加载完整流程、所有历史或全部岗位资料。

| 当前需要 | Skill | 产物 | 完成条件 |
| --- | --- | --- | --- |
| 把模糊愿望变成目标谓词 | `destination-shaping` | Intent + Destination Contract | 人已确认目标、验收、不变量和边界 |
| 勘探仓库型工作的起始地 | `repository-recon` | 四值 Fact 与影响面 | 关键事实有来源、冲突或探针 |
| 反向找路并正向证明 | `blueprint-planning` | State/Edge、推导图、proof gaps | 候选链闭合且存在 Destination-reaching 路线 |
| 让一条边可独立施工 | `edge-slicing` | Task Brief | 因果、证据、交接、上下文和失败合同完整 |
| 执行当前边或验收子图 | `edge-delivery` | Edge Run、Evidence/Receipt | effects 被可信 witness 建立 |

分层加载：

- Focus：每轮默认，仅定位 Destination 和当前边/问题。
- Work：已经选择或启动一条边时加载。
- Evidence：需要判断 witness、Acceptance 或 Proposal 时加载。
- History：重建因果、审计或诊断 stale 时限量加载。
- 企业岗位参考：只有 handoff 需要设计或发生交接争议时读取 `docs/integration/enterprise-handoffs.md`。

非仓库工作直接从文档、会议、人员或外部系统固定 Fact，不加载 `repository-recon`。普通请求不自动进入 Mapflow；只有用户显式启用后，入口 Skill 才恢复仓库外 sidecar。
