---
name: mapflow
description: "把目的地反向演化为可推导地图，并沿可信工作边推进到可审计到达；仅在用户显式调用时使用。"
---

# mapflow

Mapflow 的用户级入口路由。本仓库维护副本：`docs/workflow.md`；用户级安装包：`references/workflow.md`。

它是服务人的仓库外 sidecar，不介入普通任务。只有用户显式输入 `$mapflow`、`启用 mapflow` 或 `进入地图优先模式` 后才运行本流程。

维护仓库使用 `../../tools/mapflow.mjs`；用户级安装包使用 `runtime/mapflow.mjs`。

## 入口动作

1. **恢复 Sidecar**：运行 `enable --root <当前工作目录> --json`，读取返回的 Blueprint、Wayfinding、events、Brief 和 state 路径。完成条件：身份与路径可回指，目标工作区未新增 `.mapflow` 或其他 Mapflow 文件。
2. **只加载 Focus**：先运行 `context --root <当前工作目录> --layer focus --json`；没有正式地图时读取 `wayfinding.yaml` 的当前问题。完成条件：能够用一句 Destination、一个当前边/问题和一个证据层级说明现在应关注什么。
3. **定形和建图**：无 Blueprint 时，仓库任务按顺序读取 `repository-recon`、`destination-shaping` 阶段参考，固定四值起始 Fact 并展示完整 Destination Contract，等待后续独立人工确认；只有这个对象需要建图前的强确认。确认后读取 `blueprint-planning`，把完整反向候选链一次投影给人审阅，再读取 `edge-slicing` 补齐各边合同。候选节点/边无需逐项审批。完成条件：Destination 已确认，候选链闭合，每条边有因果、Evidence、handoff 与 context 合同。
4. **登记证明**：运行 `validate/prove`；新地图用 `init`，已有地图只对精确 diff 用 `replan`。完成条件：结构完整、推导图 digest 已产生，至少一条路线为 logical/conditional，或者得到带 repair scope 的明确缺口。
5. **确定性派发**：每轮运行 `next-actions --json`。多条 ready edge 全部展示，由人选择；普通边执行 `start`，只有 Brief 声明授权要求时才创建 `request-authorization`。完成条件：最多一个 active Run，普通边没有被加上额外审批门。
6. **按需施工**：有 active edge 时才加载 `context --layer work` 并读取 `edge-delivery` 阶段参考；失败诊断、证据判定或追责分别加载 Evidence/History，不预读。维护仓库中的阶段说明位于 `../<name>/SKILL.md`；用户级安装包内含阶段参考位于 `references/skills/<name>.md`。完成条件：可信 witness 更新 Fact，reported 观察不更新 Fact，上下文未越过 Brief 预算。
7. **独立到达审计**：`next-actions` 指向到达时，创建 `request-arrival-audit`、展示冻结验收并结束当前回答。收到后续指定 `human:*` 或 `agent:*` auditor 回答时，第一项运行时动作使用该请求执行 `arrive`。完成条件：请求、回答和 arrival event 因果链完整，同一回答没有创建并消费请求。
8. **连续航段**：Arrival 后运行 `next-actions`；只有人给出新的完整 Destination 时才制作带 `continuity` 的追加式 Blueprint，并用 `continue` 绑定最新 checkpoint。完成条件：同一 map identity、旧节点/边/证据/checkpoint 未变、易漂移 Fact 已重新观测、Successor Binding 与新 ready/proof 状态可回读。

回答已登记的建模问题时使用 `wayfinding-answer --question <id> --answer <text> --evidence-ref kind:ref`，不要只留在聊天记录。

需要完整规则时按当前分支读取行为真源；入口 Skill 不复制状态模型和所有 CLI 细节。
