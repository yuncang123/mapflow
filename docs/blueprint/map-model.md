# Mapflow 地图模型

本文件解释 `templates/blueprint.yaml` 与 `templates/blueprint.schema.json` 的领域关系；行为顺序以 `docs/workflow.md` 为准。

JSON Schema 提供可移植结构合同，`mapflow-core.mjs` 负责跨引用、Fact 值、因果闭包、Task Brief 与文件绑定等语义校验。

Task 是产品入口，Navigation Map 是面向人的产品对象；Intent、Destination、State Node、Work Edge、Fact、Evidence 和 Arrival 是生成可靠导航图的内部领域模型。不要把一条 Work Edge 称为用户的整个 Task，也不要用示例中的工程阶段缩窄地图可服务的任务类型。

## 核心关系

```text
Task -> Intent -> confirmed Destination
                  |
                  v  goal regression
Fact -> State Node -- Work Edge / Causal Contract --> State Node
                  |             |
                  |             v
                  +------ forward derivation graph ------> Destination

next-actions -> Edge Run -> trusted witness -> Evidence -> Fact
Work Event -> Proposal -> confirm -----------------------> Fact
child Arrival -> Map Receipt ----------------------------> parent Fact
completed Acceptance -> Arrival Audit Request -> auditor -> Arrival Checkpoint
Arrival Checkpoint -> Successor Binding -> Origin Snapshot -> next Destination
```

- State Node 是 Predicate 的派生视图，不是任务。
- Work Edge 是唯一施工单元；Causal Contract 是它成立的推导合同，Task Brief 是它的执行合同。
- expected effects 只参与模型推演；可信 Evidence 才能更新运行 Fact。
- Decision Record 解释为什么启动某边；Edge Run 表示该边的一次执行尝试。
- Authorization Request 只属于明确受保护的 Edge Run，不是全路线批准。
- BoardModel 是只读投影，不是另一套状态。

## schema 3 因果合同

每条 Destination 相关边必须声明：

- `premises`：source node predicates、edge preconditions、适用 invariant requirements 的完整并集；
- `conclusions`：与 edge effects 完全一致；
- `proof_mode`：`executed-verifier`、`external-readback` 或 `submap-receipt`；
- `rule_basis`：规则所依据的 verifier/contract/receipt；
- `required_witnesses`：覆盖全部 conclusions 的 required evidence IDs；
- `non_interference`：本边不得破坏的 Predicate。

schema 2 只作为旧地图兼容读取；旧 `workflow/sdlc_stage` 不进入 schema 3 的产品模型。

## AND、OR、Fog 与 Decision

- AND：一个 State/Join Node 同时列出多个 Predicate；同一事实世界中必须全部成立。
- OR：多条边可产生同一 Predicate；推导图保留全部有效替代路线。
- Fog：路线所需 Fact 为 `unknown/conflict`，由 probe edge 解析。
- Decision：多条现实路线需要人选择；普通拆解不伪装成决策。

同源边必须独立。若 B 依赖 A 的 effect，B 必须从 A 产生的中间 State Node 出发；否则为 `hidden-edge-coupling`。

## 目标回归

从 `destination.requires` 与适用 invariant 开始递归查找 Predicate producers，再把每条 producer 的 source/preconditions/invariants 加入待解释集合。已有初始 Fact 支持时停止；所有 OR producers 都失败时才产生 proof gap。

回归得到完整候选链。`goal_regression` 对每个里程碑分别投影：

- `suffix_proof`：假设该里程碑成立时，向 Destination 是否可达；
- `prefix_reachability`：当前 Fact 或正向模型能否到达它；
- `bridge_status`：目标侧后缀与起点侧前缀是否接通。

Destination 必须由人在完整合同展示后的独立回答确认。其余候选节点/边作为完整链审阅，不逐对象审批；写入 Blueprint 并经 `validate/prove → init|replan` 后才成为正式拓扑。

## 正向事实世界与推导图

正向证明从 initial Facts 建立世界，在 premises 满足时应用 Work Edge。effect 替换同一世界中的旧 Fact 值；不同分支不合并成矛盾伪世界。Loop 同时受 progress/exit Predicate 和 max iterations 限制。

`derivation_graph` 完整保存：

- 有来源的 initial axioms；
- 隔离的 fact worlds；
- 每次 rule application 的 premises、conclusions、basis 和 proof mode；
- Predicate support alternatives；
- primary proof 与稳定 SHA-256 digest。

`proven_edges` 只包含至少位于一条 Destination-reaching 路线的边。runtime readiness 还要求当前 observed Fact 满足其中一条边的实际前置。

## Proof Gap 与 Replan

Proof Gap 指出 `type/at_edge/missing/caused_by/repair_scope`。诊断只报告当前可达 frontier 上最接近 Destination 的真实缺口，不把未来 premise 或陈旧历史边当当前阻塞。

`replan` 核对 repair scope、显式 change set 和实际 Blueprint/Brief diff。已验证边的 source/target、Predicate、Invariant、Loop、Causal Contract、Brief 与 Evidence 不可重定义；新工作建立 successor route。

## Task Brief

Task Brief frontmatter 与 edge ID 一一绑定：

```text
scope + authorization + evidence + verification + failure
                    + optional handoff + optional context
```

- `handoff` 保存 from/to roles、inputs、outputs、decision rights，只是外部岗位接口。
- `context` 保存 focus、最多五个 load-first、条件式 load-on-demand 与 max-files/max-chars。
- Brief digest 与 Blueprint digest 一起冻结；执行中漂移会阻塞 gate/evidence。

## 运行事实与证据

一张地图最多一个 active Edge Run。无授权要求的 ready/proven 边可直接 `start`；受保护边必须先产生并消费 Authorization Request。

Action Capability 只保存 token hash，并绑定 map/brief/edge/run/verifier digest、允许动作和过期时间。`verify-executed` 保存真实退出码、时间与 stdout/stderr digest；`reported` 永远不应用 effects。

events 以 seq、base revision、previous digest 和 event digest 形成可校验链；state 是它的可重建投影。事件重复、截断、篡改或 state/head 不一致时 fail closed。

## 父子地图

父图单向持有 Submap Binding，固定 child identity/digest、arrival 条件、关闭策略和 `child Acceptance/Predicate → parent effects` exports。`verify-submap` 每次 readback child Arrival；Map Receipt 绑定 child event revision。child 漂移使 receipt stale，不能覆盖旧证据或补画历史。

## 五层状态与 Arrival

Board/runtime 同时区分：结构成立、声明模型可推导、当前运行就绪、执行推导有证据、到达已审计。前一层不蕴含后一层。

Arrival Audit Request 冻结 Blueprint/Brief digest、事件 revision、Evidence 与 Acceptance。只有指定 `human:*` 或 `agent:*` auditor 在后续独立回答中消费该请求，地图才生成不可变 Arrival Checkpoint。

## 连续导航

Arrival Checkpoint 记录当时的 Destination、目的地节点、目标 Fact、map/evidence digest、事件 revision、auditor、时间和 receipt digest。它证明“当时到达”，不充当永久现状。

后继 Blueprint 使用根级 `continuity` 合同：

```yaml
continuity:
  predecessor:
    checkpoint: previous-map-arrival-checkpoint-1
    receipt_digest: <sha256>
  origin_node: previous-destination-node
  imported_predicates: [previous-destination-predicate]
  revalidate: [drift-prone-predicate]
```

`continue` 校验 receipt、同一 map identity 和追加式拓扑；旧正式对象保持逐项相同。`revalidate` 指定的 Fact 使用 successor initial observation，其余事实继承运行态，并共同形成 Successor Binding 中的 Origin Snapshot。

## 投影

```text
Blueprint + Briefs + state/events + child summaries
                         ↓
BoardModel(nodes, edges, proof, evidence, arrivals, successors, handoffs, runs, acceptance)
                         ↓
local read-only API + Cytoscape + inspector
```

`board --map` 只显示定义；`board --root` 才读取 sidecar 运行态。默认显示完整 Route Set；推荐路线只是镜头。SSE 只通知 revision 变化，Board 随后回读权威投影，低频轮询负责丢通知时恢复。任何投影都不能反向修改 Blueprint、Fact、Evidence 或 Arrival。
