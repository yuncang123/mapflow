---
name: destination-shaping
description: "把模糊请求收敛为目标 Predicate、不变量、验收证据和授权边界；当目标、价值、范围或非目标会改变路线时使用。"
---

# destination-shaping：目的地定形

把 Intent 变成可证明的 Destination Contract，不提前决定工作边或实现结构。

## 人工确认硬门

用户的首轮请求只提供原始 Intent，即使它已经非常完整，也不能确认尚未由 Mapflow 展示的候选合同。先展示完整的 Destination Contract，明确哪些字段已经由证据支持、哪些仍是 unknown；然后等待后续独立消息明确确认这个候选对象。确认前保持 `intent.status: draft` 和 `destination.status: pending`，不得把自己的总结解释为用户确认，也不得创建 Blueprint、Task Brief 或实现。

有效确认应写入一个 `target.kind: destination` 的 wayfinding question：保存人的原话、`status: answered` 和会话来源 `evidence_refs`。泛化的“继续”“开始”“按计划来”不满足此门，除非它在后续消息中明确引用并确认刚展示的目的地合同。后续消息若只补充事实、约束或修改意见，本轮只能更新候选、重新展示完整合同并创建新的确认问题；修改消息不能同时确认尚未展示的修订版。只有人的原话含明确确认语义时，`wayfinding-write` 才允许目的地从 pending 变成 confirmed。

## 步骤

1. **Intent**：保存原始价值诉求、`draft/shaped` 和会改变路线的开放问题。完成条件：关键取舍已确认，status 为 shaped 且开放问题为空；否则保持 draft。
2. **目标 Predicate**：把最终必须成立的结果写成语义化 Predicate。完成条件：每一项都能由事实观察判断，不是动作或任务标题。
3. **验收映射**：为每项目标指定 acceptance ID、所证明的 Predicate 和可观察证据。完成条件：所有目标 Predicate 至少被一项验收覆盖。
4. **不变量**：记录路线中不能被破坏的约束，并指出适用工作边或外部动作。完成条件：授权、安全、成本和时间边界都有明确所有者。
5. **范围收敛**：列出 in scope、out of scope 和需要用户决定的最上游取舍。完成条件：剩余歧义不会导向两张不同地图；否则一次只问一个关键问题。

每次提问前必须在回复中标明该问题的建模目标：目标节点或边的语义 ID、要补齐的 Predicate/验收/边界，以及回答后会更新 `wayfinding.yaml` 的哪个字段。`wayfinding.yaml` 同时最多登记一个 `pending` 问题；其他未来取舍只留在 Intent 的开放项或候选结构中。问题回答后先更新草稿中的 `status`、`answer` 和 `evidence_refs`，再判断 Intent 是否可以从 `draft` 变为 `shaped`，然后才能创建下一个 `pending` 问题；只有上述后续人工确认已经留痕时才能改为 `shaped`，不要只把答案写进普通对话记录。

## 产出

```yaml
intent:
  statement: "原始价值诉求"
  status: shaped
  open_questions: []
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
