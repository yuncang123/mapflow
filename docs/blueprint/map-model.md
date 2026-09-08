# Mapflow v0.6 地图模型

本文件解释 `templates/blueprint.yaml` 和 `templates/blueprint.schema.json` 的领域关系。行为顺序以 `docs/workflow.md` 为准。

JSON Schema 是可移植的结构合同；`mapflow-core.mjs` 在同一字段形状之上补充跨引用、Fact 值兼容性、Task Brief 绑定和文件存在性等语义校验。两者共享的字段类型和枚举必须保持一致，语义校验不要求仅靠 JSON Schema 表达。

## 核心关系

```text
Intent -> Destination -> State Node A -- Work Edge / Task Brief --> State Node B
                                  ^                 |                    ^
                                  |                 v                    |
Work Event -> Proposal -> confirm -> Fact <- Evidence / Map Receipt -----+
                                                    ^
Route Approval Request -> Route Approval -> Authorization Request -> Decision Record -> Edge Run
Completed Evidence -> Arrival Audit Request -> Human Answer -> Arrival Audit
```

- State Node 是 Predicate 的派生视图。
- Work Edge 是唯一施工单元，拥有前置、effects、约束和证据合同。
- Expected effects 供正向推演；Evidence Record 通过后才更新 Fact。
- `satisfied_nodes` 是运行投影，可以重算，不是独立事实。
- Work Event 只产生 Proposal；确认门是外部流式输入改变 Fact 的唯一入口。
- Work Edge 是定义，Edge Run 是一次执行尝试；Route Approval Request 固定正式图及证明并等待人的后续回答，Route Approval 固定人已接受的完整可达路线，Authorization Request 保存针对一条边的再下一次人工回答，Decision Record 解释为何由该授权启动本次 Run。
- Arrival Audit Request 在最终证据完成后冻结地图 digest、Route Approval、事件 revision、Evidence 摘要和 Acceptance，并等待后续独立人工回答；只有消费该一次性请求的 `arrive` 才能改变实际到达状态。
- Submap Binding 属于父 Blueprint，Map Receipt 是 child 到达后导出父 effect 的不可变证据。

## Intent 与 Destination

`intent.statement/status/open_questions` 持久化尚未完全定形的诉求。`draft` 可以继续勘探和证明，但不能批准；只有 `shaped` 且开放问题为空时，Destination Contract 才能进入 implementation。schema 2 的旧 Blueprint 缺少 Intent 时，runtime 以明确标记的 `legacy_inferred` shaped Intent 读取，避免升级破坏已有个人地图；新模板必须显式声明。

## AND、OR、迷雾与决策

- AND：一个 State/Join Node 同时列出多个 predicates。
- OR：多条 Work Edge 能产生同一个 Predicate 或到达同一状态。
- Fog Node：至少包含一个期望 `unknown/conflict` 的 Predicate，并通过 probe edge 解析。
- Decision Node：只在多条有效路线需要显式选择时使用，不把普通拆解伪装成决策。

同源边必须可独立执行。若边 B 的 precondition 或 invariant requirement 来自同源边 A 的 effect，模型返回 `hidden-edge-coupling`；修复方式是在 A 的结果处增加中间 State Node，让 B 从该状态出发。

## 反向闭包

从 `destination.requires` 和适用 invariant 的 Predicate 开始：

1. 已在起始 Fact 满足的 Predicate 停止回归。
2. 否则收集产生该 Predicate 的 Work Edge。
3. 把边的 source predicates、preconditions 和 invariant requirements 加入待解释集合。
4. 没有事实或产生边时保留为待证明条件；若所有 OR 路线都失败，再生成对应 proof gap。

闭包产出需要解释的 Predicate 和 `candidate_edges`，不决定现实执行顺序。正向搜索再从成功抵达 Destination 的事实世界反向追溯 `proven_edges`；完整路线只能在此集合上批准，后续施工授权也只能指向其中当前 ready 的边。

## 目标回归与人工确认

`goal_regression` 是看板对反向目标回归的只读投影：它从 Destination 开始按里程碑 State Node 分层，递归列出产生目标状态的 Work Edge，并为每层分别计算。wayfinding 草稿尚未拥有正式 Predicate 图时，同样使用这套形状：候选边从目标节点的入边递归闭包，但每个候选节点的后缀证明沿其通向目标的出边传播，不能把“产生该节点的入边”误当成目标侧路线：

- `suffix_proof`：暂时把该里程碑作为已成立条件后，向 Destination 的后缀是否逻辑可达或条件可达；这不是运行 Fact，也不是实际到达。
- `prefix_reachability`：当前事实能否观察到该里程碑，或正向模型是否只能在预期/条件世界中抵达。
- `bridge_status`：后缀证明与当前前缀之间是已接通、仅模型可达、等待起点前缀，还是后缀未证明。

反向推理只能产生候选。看板的正式 Cytoscape 拓扑只投影已写入 Blueprint 并由 runtime 登记的节点和 Work Edge；空白 Sidecar 的第一版地图用 `init` 登记，已有地图的局部修订才用 `replan`。wayfinding 看板的“当前路线”投影当前确认对象、相邻候选边和已确认候选，未确认的其余候选仍可在“目标回归/全部候选”镜头和待确认清单中审阅。候选节点或边必须逐个经过人类确认、补齐独立 Task Brief、验收合同和非目标边界，整条候选链闭合后才能一次进入正式图。`wayfinding.questions` 同时最多包含一个 `pending` 问题，缺省 status 也按 pending 处理；已回答历史可以保留，未来候选不能提前登记成待答队列。可选的 `state.regression_proposals` 只作为“待人确认”清单显示，不改变节点、边、Fact、Evidence 或证明结果。

## 正向事实世界搜索

从 observed Facts 出发，在彼此隔离的事实世界中反复应用 source、preconditions 和 invariants 已满足的候选边，直到没有新世界。同一世界中的 Fact 只有一个四值值，edge effect 会替换该 Fact 的旧值；不同分支不会把相反 Predicate 合并成一个伪世界。OR 备选只需一个世界抵达目的地。Accepted assumption 和 `certainty: conditional` 会沿其实际因果链传播；若所有抵达世界的目标 Predicate 都依赖它们，结论才是 `conditional`。

证明只改变临时推演状态。运行 Fact 由显式通过的 `verify` Evidence Record、确认后的 Proposal 或通过 readback 的 Map Receipt 更新。

## Proof gap

```yaml
type: missing-authorization
at_edge: publish-article
missing: owner-approved
caused_by: owner-approved=false
repair_scope: subgraph:candidate-ready:article-live
```

`repair_scope` 是局部细化边界。`replan` 同时核对显式声明的实体 change set 与实际 Blueprint diff，并拒绝 scope 之外的实体；无修改时显式声明 `--changes none`。`prove/approve` 不接纳绕过 replan 的后续编辑。修图不得删除或改写已有 Evidence Record，也不得删除或重定义已验证 Work Edge 的 source/target Node、引用 Predicate、适用 Invariant、所属 loop 和绑定 Brief；不再采用且未验证的边可从活动 Blueprint 删除，并由 sidecar 事件或显式归档保存历史。

不可达诊断不会遍历输出所有候选边或所有目标的缺口。它先选择满足最多最终条件的事实世界，再从首个未满足目标中选择缺失条件最少的一条 OR 生产路线，只报告该路线的首个缺口；若该目标 Predicate 只在另一个事实世界可达，则报告 `incompatible-world-state`。

## Loop contract

Loop 列出参与循环的边、progress predicate、exit predicate 和 `max_iterations`。每条循环边必须以 effect 产出 progress，循环节点必须拥有能产出 exit 的退出边，列入 loop 的边必须实际位于拓扑环中。证明世界和 runtime 都按完成的循环边计数；预算耗尽且 exit 未成立时返回 `loop-budget-exhausted`，不继续展开或执行。

## 运行事件与投影

用户级 runtime 先按 Workspace Identity 解析仓库外 Workspace Sidecar。Git worktree 使用 canonical worktree root，非 Git 工作使用当前目录；每个 sidecar 用 manifest 反向校验绑定根目录，身份不一致时 fail closed。Blueprint、Brief、事件和投影都属于 sidecar，目标工作区只作为事实、执行和证据来源。

sidecar 的 `wayfinding-events.jsonl` 以 `mapflow.wayfinding-event/v1` 保存空白、问题回答和候选草稿快照，`events.jsonl` 追加 CloudEvents 风格 envelope 并用 seq 与 hash chain 形成 runtime 真相；`state.json` 使用 schema 2 保存可重建投影。首次 runtime event 以 `source_wayfinding` digest bridge 固定候选 journal head。每个 runtime event 携带 transition details 和 projection snapshot，`rebuild` 可验证后恢复 state；事件重复、截断、篡改、bridge 不一致或 event/state head 不一致都会阻塞回放或继续写入。旧 sidecar 没有完整 Wayfinding journal 时只能声明 partial coverage，不能根据最终 Blueprint 伪造过去。

state 保存 Blueprint identity/digest/snapshot、冻结的 Task Brief snapshots、phase、destination status、Route Approval Requests、Route Approvals、Authorization Requests、Arrival Audit Requests、active run/edge、Edge Runs、Decision Records、Work Events、Proposals、Map Receipts、verified edges 及其冻结合同、loop iterations、observed facts、derived satisfied nodes、最近 proof 和 Evidence Record。Evidence Record 以通用 executor 标识人工、Agent、工具或外部系统；只有 Agent executor 需要模型与推理元数据。digest 同时覆盖 Blueprint 和所有绑定 Task Brief 的内容。状态投影以 `actual_arrival: audited/not-audited` 区分逻辑可达与实际到达。Blueprint 或 Brief 在批准后发生变化会阻塞，必须显式 replan；replan 同时撤销当前 Route Approval，并使 pending 路线批准、施工授权与到达审计请求失效。arrived 状态不会接纳地图变更或刷新状态证明。

一张地图同时最多一个 active Edge Run，但可以保留多个 waiting/blocked run，并在 active slot 释放后为另一条独立 ready/proven Work Edge 请求授权。运行实例采用 `active -> waiting/blocked -> active`、`active -> passed/failed/cancelled`；resume 只能复用原 Run 绑定且仍属于当前路线的授权。failed 后由 `on_failure` 触发 replan、停止，或把指定备用 edge 作为待授权建议；任何失败分支都不能绕过新的人工授权直接启动 Run。`active_edge` 仅作为兼容投影保留。

v0.2 的 `current_node/completed_nodes` 不再接受。由于 State Node 是派生结果，完成所有声明边也不是到达条件；OR 分支中未选择的边无需执行。

## 父子地图与回执

`submaps[]` 由父图单向持有：`parent_edge` 指向定义边，`map_ref/state_ref` 指向 sidecar 内的独立 child，`expected_map_id/digest` 固定版本，`exports` 把 child Acceptance 和 Predicate 映射为 parent effects。一个父边最多绑定一个子地图；exports 必须覆盖该边所有 effects。`on_parent_close` 只声明 preserve/cancel/invalidate disposition，个人版不擅自执行 child 外部写入。父级接纳 Arrival Receipt 后，child digest 和 state revision 在本次 Work Episode 中不可变；漂移必须还原固定版本，或新建 successor parent map，不能重解释已验证边。

Map Receipt 绑定 child map digest、event revision、arrival audit、Acceptance evidence、export mapping、actor 和 receipt digest。`verify-submap` 每次都重新读取 child，不接受“逻辑可达”、路径存在或手工 done 布尔值。Receipt 历史只追加；child 定义或 state revision 变化后，父投影把旧 receipt 标成 stale，到达审计随即阻塞。

## 投影与看板

看板编译器同时读取 Blueprint、绑定的 Task Brief 和可选 runtime state，生成只读 `BoardModel`：

```text
Blueprint + Task Briefs + runtime events/state + child summaries
                  ↓ compile
BoardModel(nodes, edges, runs, proposals, receipts, facts, proof, acceptance, timeline)
                  ↓ project
local API + Cytoscape + text inspector
```

`BoardModel` 是可丢弃的投影合同，不是另一套事实存储：

- 节点带 Predicate 的期望值、当前四值 Fact、来源证据、满足状态和 proof gap。
- 工作边带 source/target、readiness、candidate/proven、Task Brief、evidence contract、实际 Evidence Record、acceptance、不变量、循环与失败分支。
- `expected effect` 和 `proven edge` 只说明推演结果；只有运行态登记的通过证据能让工作边成为 `verified`，只有后续人工回答对应 Arrival Audit Request 后的 `arrive` 才能显示实际到达。
- semantic ID 从正式模型原样保留，Cytoscape 元素、列表入口和检查器使用同一个 ID。
- 每一层只携带直接 child 的 submap summary；展开时 `/api/submaps/<binding-path>` 按语义路径按需返回 child BoardModel。前端为完整路径命名空间化 child 元素，并递归生成 projection-only compound container 与 portal edges；这些元素不能被 CLI、Evidence 或 Blueprint 引用。

本地服务只接受 `GET`/`HEAD`，绑定 `127.0.0.1` 并提供 CSP。`/api/board` 返回 `ETag`；浏览器每秒轮询，`304` 时不更新 UI。同一拓扑的 Fact、edge、evidence 与 acceptance 变化原位刷新并保留视口和选择，节点或边增删、重连时才重新布局。

运行态已经登记 Blueprint digest 后，当前 Blueprint 或 Task Brief 发生未登记变化时，编译器使用 state 中冻结的 Blueprint 与 Brief snapshots，并标记 `source_status: stale`。文件半写入或暂时无效时保留进程内最近一次有效投影。`stale` 必须连同具体错误显示，不能静默混用新旧事实；若服务启动后从未获得有效版本，则 API 明确失败。事件头匹配但 state 内容不等于最新事件 projection 时同样 fail closed。

Archify 可以消费快照来制作静态讲解图，但动态看板使用 Cytoscape 保留筛选、搜索、下钻和原位更新。两者都只能从正式事实投影，不能反向写入 Blueprint 或 runtime state。
