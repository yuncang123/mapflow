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

**Intent**:
尚未完全定形的价值诉求、开放问题和期望方向；只有收敛为 `shaped` 才能批准对应 Destination。
_Avoid_: Approved goal, hidden prompt

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

**Work Event**:
来自对话、工具、人工观察或外部系统的一次 occurrence；它只能产生 Proposal，不能直接改变 Fact。
_Avoid_: Fact, command result

**Proposal**:
对正式 Fact 变化的待审候选；接受、拒绝和过期都用追加事件记录。
_Avoid_: Auto-applied inference, mutable suggestion

**Decision Record**:
选择一条 Work Edge 时记录的 alternatives、理由、actor 和时间。
_Avoid_: Edge id only

**Edge Run**:
一条 Work Edge 的一次执行尝试，拥有 active、waiting、blocked、passed、failed 或 cancelled 生命周期。
_Avoid_: Work Edge definition, active flag

**Arrival Audit Request**:
最终工作证据完成后冻结地图 digest、Route Approval、事件 revision、Evidence 摘要和 Acceptance，并等待后续独立人工回答的一次性请求。
_Avoid_: Completion claim, same-turn self approval

**Submap Binding**:
父 Blueprint 中把一条 Work Edge 单向绑定到独立 child map 的版本化合同。
_Avoid_: Copied child nodes, bidirectional truth

**Map Receipt**:
由已到达 child map 生成、绑定其定义摘要、事件 revision、Acceptance evidence 和父 effect 映射的不可变回执。
_Avoid_: Child done boolean, path-only evidence

**Proof Gap**:
反向闭包或正向推演失败时产生的结构化反例，指明失败位置、缺失条件和最小修图范围。
_Avoid_: Generic blocker, plan failed

**Reachability Proof**:
在当前事实、约束和显式假设下，从起始状态到 Destination 的模型内推演结论。
_Avoid_: Guarantee, actual arrival

**Goal Regression**:
从 Destination 向起始地递归回归里程碑节点与独立 Work Edge 的设计投影；它区分目标侧后缀证明、当前事实前缀和正向模型前缀。
_Avoid_: Automatically approved plan, actual arrival

**Suffix Proof**:
把一个中间 State Node 作为临时成立条件后，向 Destination 推导出的逻辑或条件可达性；不写入运行 Fact。
_Avoid_: Evidence Record, completion claim

**Prefix Reachability**:
从当前起始 Fact 到某个回归里程碑的观察状态或正向模型可达性；它可以是迷雾、未接通或仅模型可达。
_Avoid_: Suffix Proof, verified edge

**Bridge Status**:
同时解释某个里程碑的目标侧后缀和起点侧前缀是否接通；只读投影，不是新的事实状态。
_Avoid_: Runtime status flag

**Map Projection**:
从 Blueprint 与运行事实生成的阅读视图；它可以刷新或重新生成，但不反向改变正式事实。
_Avoid_: Source of truth, runtime

**Workspace Identity**:
把一次本地工作空间与它的 Mapflow 助手状态稳定关联的身份；Git worktree 和普通目录各自独立。
_Avoid_: Repository remote, project name

**Workspace Sidecar**:
由用户级 Mapflow 管理、与目标工作区及其 Git 内容分离的本地状态容器，保存该工作区的 Blueprint、Brief、事件和投影。
_Avoid_: Repository folder, tracked project metadata
