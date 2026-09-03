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
4. **正向证明**：运行 `mapflow prove --map <blueprint.yaml>`，从有证据的起始事实搜索彼此隔离的事实世界；同一 Fact 在一个世界中只有一个值，OR 备选只需一条完整路线。完成条件：同时得到 `structural`、`reachability`、反向回归的 `candidate_edges` 和至少位于一条抵达路线上的 `proven_edges`，并明确 expected effect 不是 observed fact。
5. **局部修图**：对每个 proof gap 记录 `type/at_edge/missing/caused_by/repair_scope`，只替换受影响子图。完成条件：已验证 Fact、Work Edge 和 Evidence Record 得到保留，修图后重新执行反向闭包与正向证明。

## 停止条件

- 结构完整，且路线为 `logical` 或 `conditional`；
- 决策、迷雾、授权、外部依赖和循环预算均已显式化；
- 每项验收能追溯到目标 Predicate 和产生它的 Work Edge；
- 剩余未知不阻塞首条可执行边。

只允许表述：“在当前事实、约束和显式假设下，该路线通过正向可达性证明。”逻辑可达不表示现实已经到达。
