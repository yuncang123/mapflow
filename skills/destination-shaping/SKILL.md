---
name: destination-shaping
description: "把模糊请求收敛为目标 Predicate、不变量、验收证据和授权边界；当目标、价值、范围或非目标会改变路线时使用。"
---

# destination-shaping：目的地定形

把愿望变成可证明的 Destination Contract，不提前决定工作边或实现结构。

## 步骤

1. **目标 Predicate**：把最终必须成立的结果写成语义化 Predicate。完成条件：每一项都能由事实观察判断，不是动作或任务标题。
2. **验收映射**：为每项目标指定 acceptance ID、所证明的 Predicate 和可观察证据。完成条件：所有目标 Predicate 至少被一项验收覆盖。
3. **不变量**：记录路线中不能被破坏的约束，并指出适用工作边或外部动作。完成条件：授权、安全、成本和时间边界都有明确所有者。
4. **范围收敛**：列出 in scope、out of scope 和需要用户决定的最上游取舍。完成条件：剩余歧义不会导向两张不同地图；否则一次只问一个关键问题。

## 产出

```yaml
destination:
  statement: "可观察的目的地"
  requires: [target-predicate]
  invariants: [named-invariant]
  acceptance:
    - id: observable-proof
      proves: [target-predicate]
      proof: "实际证据"
boundaries:
  in_scope: []
  out_of_scope: []
  authorization: []
```

不把 expected effect 写成 observed fact，不替用户授权发布、凭证、外部写入或不可逆动作。
