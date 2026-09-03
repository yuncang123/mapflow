# Mapflow v0.3 地图模型

本文件解释 `templates/blueprint.yaml` 和 `templates/blueprint.schema.json` 的领域关系。行为顺序以 `docs/workflow.md` 为准。

JSON Schema 是可移植的结构合同；`mapflow-core.mjs` 在同一字段形状之上补充跨引用、Fact 值兼容性、Task Brief 绑定和文件存在性等语义校验。两者共享的字段类型和枚举必须保持一致，语义校验不要求仅靠 JSON Schema 表达。

## 核心关系

```text
[State Node A] -- Work Edge / Task Brief --> [State Node B]
        ^                  |                         ^
        |                  v                         |
     Predicates      Evidence Contract          Predicates
        ^                  |                         ^
        +------------ observed Facts ---------------+
```

- State Node 是 Predicate 的派生视图。
- Work Edge 是唯一施工单元，拥有前置、effects、约束和证据合同。
- Expected effects 供正向推演；Evidence Record 通过后才更新 Fact。
- `satisfied_nodes` 是运行投影，可以重算，不是独立事实。

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

闭包产出需要解释的 Predicate 和 `candidate_edges`，不决定现实执行顺序。正向搜索再从成功抵达 Destination 的事实世界反向追溯 `proven_edges`；批准和选择只允许使用后者。

## 正向事实世界搜索

从 observed Facts 出发，在彼此隔离的事实世界中反复应用 source、preconditions 和 invariants 已满足的候选边，直到没有新世界。同一世界中的 Fact 只有一个四值值，edge effect 会替换该 Fact 的旧值；不同分支不会把相反 Predicate 合并成一个伪世界。OR 备选只需一个世界抵达目的地。Accepted assumption 和 `certainty: conditional` 会沿其实际因果链传播；若所有抵达世界的目标 Predicate 都依赖它们，结论才是 `conditional`。

证明只改变临时推演状态。运行 Fact 由 `verify` 的实际 Evidence Record 更新。

## Proof gap

```yaml
type: missing-authorization
at_edge: publish-article
missing: owner-approved
caused_by: owner-approved=false
repair_scope: subgraph:candidate-ready:article-live
```

`repair_scope` 是局部细化边界。`replan` 同时核对显式声明的实体 change set 与实际 Blueprint diff，并拒绝 scope 之外的实体；无修改时显式声明 `--changes none`。`prove/approve` 不接纳绕过 replan 的后续编辑。修图不得删除或改写已有 Evidence Record，也不得删除或重定义已验证 Work Edge 的 source/target Node、引用 Predicate、适用 Invariant、所属 loop 和绑定 Brief；不再采用且未验证的边可从活动 Blueprint 删除，并由 Git/归档保存历史。

不可达诊断不会遍历输出所有候选边或所有目标的缺口。它先选择满足最多最终条件的事实世界，再从首个未满足目标中选择缺失条件最少的一条 OR 生产路线，只报告该路线的首个缺口；若该目标 Predicate 只在另一个事实世界可达，则报告 `incompatible-world-state`。

## Loop contract

Loop 列出参与循环的边、progress predicate、exit predicate 和 `max_iterations`。每条循环边必须以 effect 产出 progress，循环节点必须拥有能产出 exit 的退出边，列入 loop 的边必须实际位于拓扑环中。证明世界和 runtime 都按完成的循环边计数；预算耗尽且 exit 未成立时返回 `loop-budget-exhausted`，不继续展开或执行。

## 运行投影

`.mapflow/state.json` 使用 schema 2，保存 Blueprint identity/digest/snapshot、phase、destination status、active edge、verified edges 及其冻结合同、loop iterations、observed facts、derived satisfied nodes、最近 proof 和 Evidence Record。Evidence Record 以通用 executor 标识人工、Agent、工具或外部系统；只有 Agent executor 需要模型与推理元数据。digest 同时覆盖 Blueprint 和所有绑定 Task Brief 的内容。状态投影以 `actual_arrival: audited/not-audited` 区分逻辑可达与实际到达。Blueprint 或 Brief 在批准后发生变化会阻塞，必须显式 replan；arrived 状态不会接纳地图变更或刷新状态证明。

v0.2 的 `current_node/completed_nodes` 不再接受。由于 State Node 是派生结果，完成所有声明边也不是到达条件；OR 分支中未选择的边无需执行。

## 投影与看板

看板编译器同时读取 Blueprint、绑定的 Task Brief 和可选 runtime state，生成只读 `BoardModel`：

```text
Blueprint + Task Briefs + runtime state
                  ↓ compile
BoardModel(nodes, edges, facts, proof, evidence, acceptance, timeline)
                  ↓ project
local API + Cytoscape + text inspector
```

`BoardModel` 是可丢弃的投影合同，不是另一套事实存储：

- 节点带 Predicate 的期望值、当前四值 Fact、来源证据、满足状态和 proof gap。
- 工作边带 source/target、readiness、candidate/proven、Task Brief、evidence contract、实际 Evidence Record、acceptance、不变量、循环与失败分支。
- `expected effect` 和 `proven edge` 只说明推演结果；只有运行态登记的通过证据能让工作边成为 `verified`，只有 `arrive` 审计能显示实际到达。
- semantic ID 从正式模型原样保留，Cytoscape 元素、列表入口和检查器使用同一个 ID。

本地服务只接受 `GET`/`HEAD`，绑定 `127.0.0.1` 并提供 CSP。`/api/board` 返回 `ETag`；浏览器每秒轮询，`304` 时不更新 UI。同一拓扑的 Fact、edge、evidence 与 acceptance 变化原位刷新并保留视口和选择，节点或边增删、重连时才重新布局。

运行态已经登记 Blueprint digest 后，当前 Blueprint 或 Task Brief 发生未登记变化时，编译器使用 state 中冻结的 Blueprint 并标记 `source_status: stale`。文件半写入或暂时无效时保留进程内最近一次有效投影。`stale` 必须连同具体错误显示，不能静默混用新旧事实；若服务启动后从未获得有效版本，则 API 明确失败。

Archify 可以消费快照来制作静态讲解图，但动态看板使用 Cytoscape 保留筛选、搜索、下钻和原位更新。两者都只能从正式事实投影，不能反向写入 Blueprint 或 runtime state。
