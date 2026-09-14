# Mapflow

Mapflow 描述从目的地反向形成可推导路线、再由实际证据推进到可审计到达的工作领域。它以个人 sidecar 保存地图真相，并通过小型合同接入人、Agent 与企业岗位。

## Language

**Intent**:
尚未完全定形的价值诉求、开放问题和期望方向。
_Avoid_: Approved goal, hidden prompt

**Fact**:
对当前世界状态的一项可引用陈述，值为 `true`、`false`、`unknown` 或 `conflict`。
_Avoid_: Guess, expected result

**Predicate**:
对 Fact 的具名期望，用来表达状态、前置、效果、约束或目的地。
_Avoid_: Free-form condition

**Destination**:
必须成立的目标 Predicate、全程不变量、边界和逐项验收组成的目的地合同。
_Avoid_: Goal sentence, task title

**Destination Confirmation**:
人在看过完整候选合同后，对该 Destination 的独立明确确认。
_Avoid_: First request, continue signal

**State Node**:
由一组 Predicate 派生的可观察工作状态，不拥有施工动作。
_Avoid_: Task, checklist item

**Fog Node**:
表示路线所需 Fact 仍为 `unknown` 或 `conflict` 的 State Node。
_Avoid_: Failure, false state

**Decision Node**:
表示多条可替代路线需要显式选择的 State Node。
_Avoid_: Any branch point

**Join Node**:
表示多个独立前置状态必须共同成立的 State Node。
_Avoid_: Sequential checklist

**Work Edge**:
把一个 State Node 推进到另一个 State Node 的独立有界工作。
_Avoid_: Vague possibility, node task

**Causal Contract**:
一条 Work Edge 的显式推导规则，绑定 premises、conclusions、rule basis、required witnesses 与 non-interference。
_Avoid_: Feasibility claim, model intuition

**Task Brief**:
一条 Work Edge 的施工合同，记录范围、授权、证据、验证、失败、岗位交接与上下文边界。
_Avoid_: Ticket number, full project document

**Role Handoff**:
当前 Work Edge 与真实岗位之间的输入、输出和决策权接口。
_Avoid_: Collaboration workspace, copied team process

**Context Contract**:
当前 Work Edge 的焦点、首要入口、条件式引用和注意力预算。
_Avoid_: Read everything, document bundle

**Context Pack**:
针对当前地图或 Work Edge 按 Focus、Work、Evidence 或 History 层披露的只读上下文。
_Avoid_: Complete repository dump, new source of truth

**Evidence Record**:
实际执行后形成的不可覆盖记录，绑定 Work Edge、被证明的 Predicate 和相关验收项。
_Avoid_: Completion claim, expected result

**Work Event**:
来自对话、工具、人工观察或外部系统的一次 occurrence，只能产生 Proposal。
_Avoid_: Fact, verified outcome

**Proposal**:
对正式 Fact 变化的待审候选。
_Avoid_: Auto-applied inference

**Decision Record**:
选择一条 Work Edge 时记录的 alternatives、理由、actor 和时间。
_Avoid_: Edge id only

**Edge Run**:
一条 Work Edge 的一次执行尝试。
_Avoid_: Work Edge definition, active flag

**Proof Gap**:
反向闭包或正向推演失败时产生的结构化反例，包含失败位置、缺失条件和最小修图范围。
_Avoid_: Generic blocker, plan failed

**Reachability Proof**:
在当前 Fact、约束和显式假设下，从起始状态到 Destination 的模型内推演结论。
_Avoid_: Guarantee, actual arrival

**Derivation Graph**:
保存 axioms、事实世界、规则应用和 Predicate 支持关系的完整推导对象。
_Avoid_: One preferred path, execution history

**Proof Certificate**:
把一次实际 Edge Run 与冻结合同、witness、digest 和推导关系绑定的证据对象。
_Avoid_: Model explanation, reported pass

**Goal Regression**:
从 Destination 向起始地递归形成里程碑节点和独立 Work Edge 的设计投影。
_Avoid_: Forward task list, approved route

**Suffix Proof**:
把一个中间 State Node 临时视为成立后，向 Destination 推导出的模型结论。
_Avoid_: Evidence Record, completion claim

**Prefix Reachability**:
从当前 Fact 到某个回归里程碑的观察或模型可达性。
_Avoid_: Suffix Proof, verified edge

**Arrival Audit Request**:
工作证据完成后冻结地图与验收摘要，等待指定 auditor 独立消费的一次性请求。
_Avoid_: Same-turn self approval, completion claim

**Arrival**:
Destination、Acceptance、Invariant 和剩余风险均可回指并已经独立审计的地图终态。
_Avoid_: Logical reachability, product success

**Submap Binding**:
父 Blueprint 中把一条 Work Edge 单向绑定到独立 child map 的版本化合同。
_Avoid_: Copied child nodes, bidirectional truth

**Map Receipt**:
由已到达 child map 生成并绑定其版本、验收和父 effect 映射的不可变回执。
_Avoid_: Child done boolean, path-only evidence

**Map Projection**:
从 Blueprint 与运行 Fact 生成的阅读视图，不反向改变地图真相。
_Avoid_: Source of truth, runtime

**Workspace Identity**:
把一次本地工作空间与 Mapflow 状态稳定关联的身份。
_Avoid_: Repository remote, project name

**Workspace Sidecar**:
与目标工作区及其 Git 内容分离的本地状态容器。
_Avoid_: Repository folder, collaboration server
