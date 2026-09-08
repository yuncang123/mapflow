---
name: blueprint-planning
description: "把目的地契约和四值起始事实收敛为状态节点、独立工作边和可达性证明；当路线需要反向拆解、存在迷雾/决策或正向推演失败时使用。"
---

# blueprint-planning：目标回归与可达性证明

核心循环是：**反向目标回归 → 正向可达性证明 → 反例驱动修图**。

## 步骤

1. **反向闭包**：从每个 Destination Predicate 反问“哪条独立 Work Edge 能产生它，执行前哪些 Predicate 必须成立”。完成条件：每个目标已在起始事实成立，或至少有一条产生边。
2. **状态建图**：State Node 只包含 Predicate；AND 使用多 Predicate 的 State/Join Node，OR 使用多条替代边，必要事实未知时使用 Fog Node，真实路线取舍才使用 Decision Node。完成条件：边 B 依赖边 A 的效果时已经插入中间状态，不存在同源边隐藏耦合。
3. **边合同**：每条 Work Edge 关联语义化 `brief_ref`、前置 Predicate、expected effects、不变量、certainty、失败分支和 Evidence Contract。完成条件：每个 effect 被必需证据覆盖，Task Brief 可独立施工。
   当一条边本身仍是一张多步地图时，在父 Blueprint 建立单向 Submap Binding，固定 child identity/digest、arrival、关闭策略和 acceptance export。完成条件：child 保持独立，exports 覆盖父边 effects。
4. **正向证明**：运行 `mapflow prove --map <blueprint.yaml>`，从有证据的起始事实搜索彼此隔离的事实世界；同一 Fact 在一个世界中只有一个值，OR 备选只需一条完整路线。完成条件：同时得到 `structural`、`reachability`、反向回归的 `candidate_edges` 和至少位于一条抵达路线上的 `proven_edges`，并明确 expected effect 不是 observed fact。
5. **局部修图**：对每个 proof gap 记录 `type/at_edge/missing/caused_by/repair_scope`，只替换受影响子图。完成条件：已验证 Fact、Work Edge 和 Evidence Record 得到保留，修图后重新执行反向闭包与正向证明。

反向回归得到的里程碑和 Work Edge 必须先作为候选交给人确认。完整候选链可以先投影，但确认问题必须按单个节点或单条边串行创建，`wayfinding.yaml` 同时最多有一个 `pending` 问题；当前回答留痕并更新草稿后才能移动到下一候选，不得用一个问题捆绑多个候选。候选链补齐语义、Task Brief、验收、非目标和授权并逐项确认后，才一次生成正式 Blueprint、执行正向证明并进入看板正式拓扑；空白 Sidecar 用 `init` 首次登记，已有正式地图的局部修订才用 `replan`。投影不得替人确认结构。

目标回归之前先回读 `wayfinding.yaml`。确认每个问题都指向一个具体节点、边或 Predicate，且最多一个问题为 `pending`；没有目标的提问不能被当成回归输入。草稿中的始发节点、目的地候选和候选边可以在看板用虚线显示，但它们与正式拓扑分开计数，不能被路线批准或请求施工授权。

## 停止条件

- 结构完整，且路线为 `logical` 或 `conditional`；
- 决策、迷雾、授权、外部依赖和循环预算均已显式化；
- 每项验收能追溯到目标 Predicate 和产生它的 Work Edge；
- 剩余未知拥有可执行探针或不阻塞完整路线；当前 ready 边仍需另行请求施工授权。

只允许表述：“在当前事实、约束和显式假设下，该路线通过正向可达性证明。”逻辑可达不表示现实已经到达。
