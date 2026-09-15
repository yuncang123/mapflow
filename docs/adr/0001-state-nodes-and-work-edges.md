---
status: accepted
---

# 状态属于节点，工作属于边

Mapflow v0.3 使用四值 Fact 和 Predicate 派生 State Node，把独立工作、Task Brief、前置条件、效果与证据合同放在 Work Edge；运行时执行 edge，并从实际证据重新计算 satisfied nodes。这个选择替代 v0.2 的动作节点模型，因为后者会隐藏边间依赖、把“计划效果”误当“已完成状态”，也无法统一编码与非编码工作。传统 STRIPS/HTN 规划器只作为设计来源，不成为运行依赖：Mapflow 必须容纳逐步发现的事实、迷雾、授权和证据。

## Consequences

- v0.2 state 与命令不兼容，旧模型只保存在 `archive/v0.2-action-node/`。
- OR 通过替代 Work Edge 表达；AND 通过多 Predicate 的 State/Join Node 表达。
- `expected effect` 只支持逻辑推演；Fact 只有在 Evidence Record 通过后才更新。
- Board 和其他图形化视图都是 Map Projection，不是运行真源。
