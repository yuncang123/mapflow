---
name: blueprint-planning
description: "把目的地契约和四值起始事实收敛为状态节点、独立工作边和可达性证明；当路线需要反向拆解、存在迷雾/决策或正向推演失败时使用。"
---

# blueprint-planning：目标回归与可达性证明

核心循环是：**反向目标回归 → 正向可达性证明 → 反例驱动修图**。

## 步骤

1. **反向闭包**：从每个 Destination Predicate 反问产生它的 Work Edge、premises 和 witness。完成条件：每个目标已在起始 Fact 成立，或至少有一条产生边。
2. **状态建图**：State Node 只包含 Predicate；AND 用多 Predicate State/Join，OR 用替代边，未知用 Fog，真实取舍才用 Decision。完成条件：边 B 依赖边 A 的 effect 时已有中间状态，同源边没有隐藏产出依赖。
3. **因果合同**：为每条边声明完整结构 premises、与 effects 完全一致的 conclusions、rule basis、required witnesses 和 non-interference。完成条件：不存在“可实现”式模糊边，每个 conclusion 有可回读 witness。
4. **边合同**：绑定语义化 Brief、范围、失败分支、授权、handoff 与 context；复杂边用单向 Submap Binding。完成条件：执行者与接收岗位不需要猜输入、输出、决策权或加载范围。
5. **完整投影**：把闭合候选链一次展示给人审阅；Destination 的人工确认不能替代路线审阅，但候选节点/边不逐项设置审批门。完成条件：审阅反馈已吸收，候选链完整且没有孤立终点。
6. **正向证明**：运行 `mapflow prove --map <blueprint.yaml>`，检查结构、五层证据边界、完整 derivation graph 和 digest。完成条件：至少一条 Destination-reaching 路线成立，或每个当前 frontier 缺口都有精确 repair scope。
7. **局部修图**：只替换受缺口影响的最小子图，再重跑反向闭包和正向证明。完成条件：已验证 Fact、Work Edge 和 Evidence 保留。

## 停止条件

- Destination 已被人确认；
- 候选链闭合并作为整体完成审阅；
- schema 3 因果合同和 Evidence Contract 完整；
- 路线为 `logical`/`conditional`，或缺口具有可执行探针；
- `logical` 只表述模型可达，不表述现实已到达。
