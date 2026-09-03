# Mapflow

Mapflow 为目的地尚未拥有明确地图的工作建立可检验路线。它面向所有工作类型；人、Agent、Git、文档、会议和外部系统都只是事实或执行来源。

## Language

**Fact**:
对当前世界状态的一项可引用陈述，值为 `true`、`false`、`unknown` 或 `conflict`。
_Avoid_: Status flag, guess

**Predicate**:
对 Fact 的一个具名期望，用来声明状态、前置条件、效果、约束或目的地。
_Avoid_: Check, condition string

**Destination**:
一组必须成立的目标 Predicate、全程约束和逐项验收合同。
_Avoid_: Goal sentence, task title

**State Node**:
由一组 Predicate 派生的可观察工作状态；它不拥有施工动作，也不被手动宣布完成。
_Avoid_: Task, step, work item

**Fog Node**:
表示路线所需 Fact 仍为 `unknown` 或 `conflict` 的 State Node。
_Avoid_: Failure, false state

**Decision Node**:
表示多条可替代路线需要显式选择的 State Node。
_Avoid_: Any decomposition point

**Join Node**:
表示多个独立前置状态必须共同成立的 State Node。
_Avoid_: Sequential checklist

**Work Edge**:
把一个 State Node 推进到另一个 State Node 的独立有界工作，关联一个 Task Brief、效果和证据合同。
_Avoid_: Transition, node task

**Task Brief**:
一条 Work Edge 的施工合同，使用语义化名称记录范围、非目标、授权、验收和回退。
_Avoid_: Ticket number, node description

**Evidence Record**:
实际执行后形成的不可覆盖记录，绑定 Work Edge、被证明的 Predicate 和相关验收项。
_Avoid_: Completion claim, expected result

**Proof Gap**:
反向闭包或正向推演失败时产生的结构化反例，指明失败位置、缺失条件和最小修图范围。
_Avoid_: Generic blocker, plan failed

**Reachability Proof**:
在当前事实、约束和显式假设下，从起始状态到 Destination 的模型内推演结论。
_Avoid_: Guarantee, actual arrival

**Map Projection**:
从 Blueprint 与运行事实生成的阅读视图；它可以刷新或重新生成，但不反向改变正式事实。
_Avoid_: Source of truth, runtime
