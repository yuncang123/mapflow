# Mapflow v0.4 父子地图、回执与事件模型 Prior Art

日期：2026-09-03

## 结论先行

Mapflow v0.4 不应引入通用工作流引擎，也不应把 Cytoscape 的折叠状态变成事实。最浅且足够的复用组合是：

- **采用组件**：继续使用仓库已固定的 Cytoscape.js 3.34.2，并使用其原生 compound node、动态 add/remove/restore 与事件 API 构建层级投影。
- **借鉴设计**：从 Open Workflow Specification 和 Temporal 借用“父级引用一个版本化、独立运行、可等待并返回结果的子工作流”合同；父子 Mapflow runtime 仍各自独立。
- **借鉴设计**：从 W3C PROV 和 in-toto 借用“结果是由一次活动生成、由具体证据派生、可追溯且不被后续失效覆盖”的到达回执。
- **采用规范子集，不采用 SDK**：事件 envelope 使用 CloudEvents 的 `id/source/type/time/subject/data` 语义；Mapflow 自行补 `stream/seq/base_revision/actor/causation_id`，写入本地 append-only JSONL。
- **自研仓库胶水**：Proposal、确认门、Edge Run 生命周期、子图状态汇总和 stale 向上传播都是 Mapflow 的领域规则，无法由现成库直接替代。

`cytoscape-expand-collapse` 不进入依赖。它的 API 和视觉类名可作为交互参考，但其 README 明确声明项目不再维护，且 4.1.1 源码直接访问 Cytoscape 的 `_private` 并通过 remove/restore 保存折叠子项；这对长期固定版本的离线看板是脆弱耦合。

## 问题分类与检索边界

本轮只回答四类问题：

1. 父地图如何把一条 Work Edge 委托给独立子地图；
2. 子地图如何产生可由父边验证的到达回执；
3. 流式输入如何先进入 Proposal，再经确认成为正式事实；
4. Cytoscape 看板如何展开/收缩子地图而不改写真相。

按 Prior Art 阶梯检查了：

- 本仓库现有 Blueprint schema、runtime state、BoardModel、前端和已 vendored 依赖；
- Cytoscape.js 官方文档与 `cytoscape-expand-collapse@4.1.1` 发布包源码；
- CloudEvents 1.0.2、W3C PROV-DM、RFC 6902、in-toto Specification；
- Open Workflow Specification 的 nested workflow/lifecycle，以及 Temporal Child Workflow；
- 既有 SHOP/HTN 一手说明，确认通用规划器是否可整体采用。

没有扩大到多人权限、远程消息总线、密码学签名服务或分布式执行器；这些不是个人本地版 v0.4 的必要条件。

## 仓库现状

- [`templates/blueprint.schema.json`](../../templates/blueprint.schema.json) 的根对象和 Work Edge 均不包含 `submap`、binding 或父子映射字段；Schema 仍为 Blueprint v0.3、`schema_version: 2`。
- [`tools/mapflow-board-core.mjs`](../../tools/mapflow-board-core.mjs) 的 `compileBoardModel()` 一次接收一份 Blueprint 和一份 state，`createBoardSnapshotReader()` 只有一个 `mapPath/statePath`。
- [`tools/mapflow.mjs`](../../tools/mapflow.mjs) 把历史追加到内存数组后整体原子重写 `.mapflow/state.json`；它不是 append-only 事件账本。`active_edge` 也只能表达唯一活动边，不能区分多次 run 的等待、失败、取消和恢复。
- [`tools/board/app.js`](../../tools/board/app.js) 支持筛选、搜索、节点/边 Inspector、ETag 轮询和拓扑变化后重新布局，没有子地图注册表、按需加载、展开/收缩或面包屑。
- [`tools/vendor/cytoscape/NOTICE.md`](../../tools/vendor/cytoscape/NOTICE.md) 固定 Cytoscape.js 3.34.2；当前不含 expand/collapse 扩展。

因此现状是可靠的单图 projection，不是层级地图 runtime。

## 候选与裁决

### 1. Cytoscape.js compound nodes：采用组件

官方文档说明 compound node 通过 child node 的 `data.parent` 建立；parent 的位置和尺寸由后代推导，并提供 `parent()`、`children()`、`descendants()` 等 compound API。父关系不能通过普通 `data()` 修改，但可通过 `eles.move()` 调整。官方 `eles.remove()` 返回的集合可由 `eles.restore()` 恢复。

来源：

- [Cytoscape.js：Compound nodes](https://js.cytoscape.org/#notation/compound-nodes)
- [Cytoscape.js：Compound node collection API](https://js.cytoscape.org/#collection/compound-nodes)
- [Cytoscape.js：remove/restore](https://js.cytoscape.org/#eles.remove)
- 本仓库固定版本：[`tools/vendor/cytoscape/NOTICE.md`](../../tools/vendor/cytoscape/NOTICE.md)

采用理由：

- 已是 Mapflow 的离线渲染组件，不增加新依赖或分发面；
- 原生支持层级边界和动态元素更新；
- 可以只加载当前展开子图，避免把整个项目递归展开；
- collapse 状态可保留在浏览器 projection 内，不污染 Blueprint/state。

限制：Cytoscape 的 compound 结构只是视觉容器，图算法不会自动按 Mapflow 的父子语义处理它；父边是否完成、子图是否到达仍必须由 BoardModel 编译。

### 2. `cytoscape-expand-collapse`：不采用代码，只借鉴交互

发布包 4.1.1（MIT）提供 `collapse/expand`、递归操作、collapsed children、meta edge、before/after events 和视觉 cue。其 README 同时明确写明仓库“不再维护”。发布包源码的 `removeChildren()` 把 child `remove()` 后保存在 `root._private.data.collapsedChildren`，展开时直接读取 `_private` 并 `restore()`；跨边也通过改写端点产生 meta edge。

来源：

- [官方仓库/README](https://github.com/iVis-at-Bilkent/cytoscape.js-expand-collapse)
- [npm 发布包](https://www.npmjs.com/package/cytoscape-expand-collapse)
- 本轮核对命令：`npm view cytoscape-expand-collapse@4.1.1 readme`，并检查该发布包 `src/expandCollapseUtilities.js` 与 `src/index.js`

不采用理由：

- 自报不再维护；
- 访问 `_private`，与 Mapflow 当前较新的 Cytoscape 3.34.2 形成非公开 API 耦合；
- 它假定完整 compound graph 已经在浏览器中，Mapflow 需要按需读取独立 Blueprint/state，并传播 stale/receipt 状态；
- meta edge 是视觉合并，不知道父边、acceptance 或 evidence contract。

可借鉴：`isExpandable/isCollapsible`、递归展开、before/after event、collapsed class，以及“折叠后用 meta edge 保持方向感”的交互语言。

### 3. Open Workflow Specification nested workflow：借鉴父子合同

官方 DSL 的 `run.workflow` 用 `namespace/name/version/input` 指向独立 workflow；`await` 决定父 task 是否等待，且不等待时不能返回子结果。规范还定义 created、started、suspended、resumed、retried、cancelled、faulted、completed 等 lifecycle CloudEvents。

来源：

- [Open Workflow Specification DSL reference：Run / Workflow Process](https://github.com/serverlessworkflow/specification/blob/main/dsl-reference.md#run)
- [Lifecycle events](https://github.com/serverlessworkflow/specification/blob/main/dsl-reference.md#lifecycle)

借鉴理由：版本化引用、输入合同、等待语义和生命周期正好覆盖“父边委托子地图”的边界。

不整体采用：该规范面向自动化 runtime 和数据传递；Mapflow 面向开放世界中的人/Agent/工具共同工作，并要求四值事实、证据合同和人工确认。把 Blueprint 编译成该 DSL 会丢失迷雾、证据可信度和到达审计语义。

### 4. Temporal Child Workflow：借鉴独立运行和父级关闭策略

Temporal 官方说明 Child Workflow 由 Parent Workflow 发起；父级必须等待 child 成功启动，可以选择是否等待 child 结果。父子不共享本地状态，各有 Event History；父级关闭时通过 Parent Close Policy 决定对子级 abandon、request cancel 或 terminate。

来源：[Temporal Child Workflows](https://docs.temporal.io/child-workflows) 与 [Parent Close Policy](https://docs.temporal.io/parent-close-policy)

借鉴理由：

- 子地图不是父 state 的内嵌可变片段，而是有自己历史和状态的独立执行；
- 父边必须先拿到“已绑定/已启动”事实，最终再选择等待到达回执；
- 父地图归档、取消或 replan 时必须声明对子地图的处理策略。

不采用 Temporal：本地个人工作流不需要 server、worker、task queue、SDK 和 durable execution；引入它会把轻量 Mapflow 变成分布式执行平台。

### 5. Camunda subprocess/call activity：借鉴“显示折叠”和“独立调用”的分离

Camunda 官方文档把 embedded subprocess 的 collapsed/expanded 视图与 call activity 分开：前者是同一流程内的可视化分组，后者引用一个可复用的独立 process，创建 child instance，并在 child 完成后让 parent 继续；call activity 还支持显式 process/version binding 与 input/output mapping。

来源：[Camunda Embedded Subprocesses](https://docs.camunda.io/docs/components/modeler/bpmn/embedded-subprocesses/) 与 [Call Activities](https://docs.camunda.io/docs/components/modeler/bpmn/call-activities/)

借鉴理由：这直接支持 Mapflow 的关键分离——Cytoscape compound 是显示/下钻，真正的子地图是 Work Edge 调用的版本化独立地图；父级只接收 `exports`，不隐式共享 child 全部事实。

不采用 BPMN/Camunda runtime：其 token、变量传播、部署绑定和远程执行平台超出个人本地 Mapflow；只借调用边界，不照搬默认变量传播。

### 6. W3C PROV-DM：借鉴回执的来源关系

PROV-DM 把 `Entity`、`Activity`、`Agent` 及 `wasGeneratedBy`、`wasDerivedFrom`、`wasAttributedTo/wasAssociatedWith` 分开；还定义 Bundle 为“具名 provenance 描述集合，本身也是 Entity”，从而支持 provenance of provenance，并以 invalidation 表达一个 Entity 不再可用。

来源：[W3C Recommendation: PROV-DM](https://www.w3.org/TR/prov-dm/)，尤其是 [Entity and Activity](https://www.w3.org/TR/prov-dm/#section-entity-activity) 与 [Bundles](https://www.w3.org/TR/prov-dm/#section-provenance-of-provnance)

借鉴到 Mapflow：

- 子地图 Blueprint/state/evidence 是被使用的 Entity；
- 子地图 run/到达审计是 Activity；
- arrival receipt 是该 Activity 生成、由 acceptance evidence 派生的 Entity；
- 人、Codex、会议或外部系统只是与 Activity 关联的 Agent；
- 子地图后来 stale 时追加 invalidation/stale 事件，不覆盖原回执。

不采用完整 PROV 序列化：PROV 很通用但不会验证 Mapflow Predicate、Acceptance、binding digest 或父边 effects；完整 PROV-N/PROV-O 会给个人 CLI 增加不必要的词汇和转换成本。

### 7. in-toto link metadata：借鉴证据绑定，不采用供应链模型

in-toto 规范将 link metadata 定义为“一步已被执行”的声明，并记录 materials、products、byproducts、command；layout 声明预期步骤、授权 functionaries 和步骤间材料/产品匹配，通常再由签名验证。

来源：[in-toto Specification](https://github.com/in-toto/docs/blob/master/in-toto-spec.md)，尤其是 `3.1.2 Link metadata`

适合借鉴：receipt 必须绑定输入定义摘要、输出事实、验收/证据引用、执行者和时间，不能只写 `child-arrived: true`。

不采用其 schema/库：它服务软件供应链、文件制品和密钥信任；Mapflow 要覆盖会议、采购、写作等非文件工作。个人版 v0.4 先使用 digest 和 readback，不强制签名。

### 8. CloudEvents 1.0.2：采用 envelope 语义，不采用 SDK/传输

CloudEvents 将 event 定义为“表达一次 occurrence 及其 context 的数据记录”。必需属性为 `id`、`source`、`specversion`、`type`；`source + id` 唯一，可把重发识别为 duplicate；`subject/time/datacontenttype/dataschema` 是通用上下文。规范明确 payload 是领域数据，也不规定 storage/transport。

来源：[CloudEvents Specification v1.0.2](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md)

采用方式：沿用其稳定 envelope 含义和命名，自行实现几十行 schema 校验；不引入 `cloudevents` npm SDK，不引入 broker。Mapflow 另加本地流所需的：

```yaml
schema: mapflow.event/v1
id: <globally unique event id>
source: mapflow://<project>/<map-id>
type: mapflow.proposal.created.v1
time: <RFC3339>
subject: proposal/<proposal-id>
stream: map/<map-id>
seq: 42
base_revision: <current projection or definition digest>
actor: <human/agent/tool identity>
causation_id: <optional prior event id>
correlation_id: <map run or proposal id>
data: { ...typed domain payload... }
```

CloudEvents 只解决 envelope 和去重标识，不保证 append-only、顺序、exactly-once、确认或权限；这些仍是 Mapflow runtime 责任。

### 9. KurrentDB/Akka Event Sourcing：借鉴追加、并发检查和重放边界

KurrentDB 官方文档把每次状态变化保存为 stream 中的独立 event，append 时可携带 expected stream revision；revision 不匹配则拒绝写入。Akka Typed Persistence 把 command handler 与 event handler 分开：前者针对 current state 验证命令并产生持久化 event，只有 event handler 用已持久化 event 更新 state，恢复时重放事件。

来源：[KurrentDB Streams](https://docs.kurrent.io/server/v25.1/features/streams)、[Appending Events](https://docs.kurrent.io/clients/dotnet/v1.0/appending-events) 与 [Akka Event Sourcing](https://doc.akka.io/libraries/akka-core/current/typed/persistence.html)

借鉴到 Mapflow：Proposal 类似尚未通过 command validation 的意图；accept 时校验 `base_revision`，成功后才追加 domain event；BoardModel/state 只重放持久事件。修正用 superseding/compensating event，不改旧记录。

不采用数据库或 Akka runtime：个人本地版用一个受锁保护的 JSONL stream、seq 和原子 projection 即可；EventStore 服务或 JVM actor 系统的运行/迁移成本没有对应收益。

### 10. RFC 6902 JSON Patch：保留为局部工具，不作为 Proposal 主合同

RFC 6902 定义按序执行的 `add/remove/replace/move/copy/test`，`test` 失败可使 HTTP PATCH 原子失败。它可以表达“仅当 base 值仍相同才接受修改”。

来源：[RFC 6902](https://www.rfc-editor.org/rfc/rfc6902)，尤其是 [test](https://www.rfc-editor.org/rfc/rfc6902#section-4.6) 和 [Error Handling](https://www.rfc-editor.org/rfc/rfc6902#section-5)

不作为 Proposal 主合同：Blueprint 中的 nodes/edges 是按语义 ID 管理的集合，数组索引 patch 对重排敏感；JSON Patch 也不会表达“这个变更为何成立、证明什么、谁批准”。v0.4 应保存 typed Proposal（observe fact、revise destination、add/remove edge、bind submap 等），必要时在 `data.patch` 中附 JSON Patch 作为可预览实现细节。

### 11. SHOP/HTN：继续只借鉴递归拆解

SHOP 用预定义 method 把 nonprimitive task 递归分解为 primitive task，并在当前规划状态中处理。来源：[University of Maryland SHOP project](https://www.cs.umd.edu/projects/shop/description.html)。

Mapflow 可继续借鉴“一个不可直接执行的工作递归下沉为子任务”的思想，但不采用 planner/runtime：父子地图在工作中才发现 Predicate、证据和方法，不能假设完整 domain method library 已存在。

## v0.4 最小领域合同建议

### 父子绑定放在父地图，子地图保持可独立使用

不要同时在父 Blueprint 写 `submap_ref`、又在 child 写 `parent_map/parent_edge`；双向真相会漂移。父地图拥有 binding，child 只知道自身 identity。建议新增顶层 `submaps`：

```yaml
submaps:
  - id: migrate-query-capability
    parent_edge: migrate-query-capability
    map_ref: maps/migrate-query/blueprint.yaml
    expected_map_id: migrate-query
    expected_map_digest: <sha256>
    await: arrival
    on_parent_close: preserve   # preserve | cancel | invalidate
    exports:
      - child_acceptance: query-regression-passed
        child_predicates: [query-migrated, query-regression-green]
        proves_parent: query-capability-migrated
```

最低校验：

- `parent_edge` 存在，且一个 binding 只能属于一条边；
- child map ID/digest 与 binding 一致；
- `exports` 覆盖父边需要由子图产生的 effects；
- child acceptance 必须实际通过，不能只因逻辑可达而导出；
- parent edge 的其他 required evidence 仍需分别满足；
- 循环引用、重复 map identity 和无界递归必须报结构缺口；
- child 变更后，不删除旧 receipt，而把 binding/父 evidence 标为 stale。

`submap` 是 Work Edge 的一种 realization，不应新增“子地图节点”真相类型；看板可生成 projection-only container。

### Arrival Receipt 是不可变快照，不是布尔值

```yaml
schema: mapflow.arrival-receipt/v1
receipt_id: <uuid>
binding_id: migrate-query-capability
child:
  map_id: migrate-query
  map_digest: <sha256>
  state_revision: <event seq/head digest>
arrival:
  audited_at: <RFC3339>
  destination_predicates: [query-migrated, query-regression-green]
  acceptance:
    - id: query-regression-passed
      evidence_ids: [evidence-...]
  residual_risks: []
generated_by:
  run_id: <child map run id>
  actor: <identity>
receipt_digest: <canonical payload sha256>
```

父级接收时必须重新读取 child 当前定义/状态，核对 digest、audited arrival、acceptance、evidence 与 export mapping，随后生成自己的 `submap.receipt.accepted` 事件。不能把 child state 路径或一句“已完成”当父边证据。

### Proposal 与正式事实之间只有单一确认门

事件序列应是：

```text
外部 WorkEvent
  -> proposal.created
  -> proposal.reviewed (可选，多次)
  -> proposal.accepted | proposal.rejected | proposal.superseded
  -> accepted proposal 导出一个或多个 typed domain events
  -> projection 重放 domain events 得到 MapFact/EdgeRun/Decision/Receipt 当前态
```

规则：

- `proposal.created` 永远不能直接改变 Fact、Blueprint、Edge Run 或 Arrival；
- `accepted/rejected/superseded` 是追加事件，不能覆写 proposal；
- accept 必须校验 `base_revision`；过期 proposal 返回 stale 并要求重基，不可静默套用；
- rule-based 自动确认必须显式记录 `actor=rule:<id>` 和命中的 policy；模型推断默认只能产生 proposal；
- event payload 引用大证据文件，不把敏感内容整块复制进日志；
- `.mapflow/state.json` 变成可删除重建的 projection/cache；`.mapflow/events.jsonl` 才是 runtime 真相。

### Edge Run 取代单一 `active_edge` 的隐式生命周期

一条 Work Edge 可有多次 run；边定义与执行尝试不能混为一体。最小生命周期：

```text
created -> approved -> active
active  -> waiting -> active
active  -> blocked -> active | cancelled
active  -> failed  -> retried(new run) | replan | stopped
active  -> verified
```

每次转换都是事件；`verified_edges`、`active_edge`、waiting/blocked 数量由事件投影。`on_failure` 必须在 failed event 后产生明确的 branch/replan/stop 后续事件，而不是只展示声明。个人版仍可约束同一 map 同时只有一个 active run，但 waiting child run 不应伪装成 active。

## 看板最小实现建议

1. BoardModel 先编译父图；collapsed parent Work Edge 仍按现状显示，并带 `submap_summary`（phase、arrival、acceptance、fog、stale、receipt）。
2. 点击展开后，前端向只读 API 请求指定 binding 的 child BoardModel；不要预加载所有后代。
3. 前端使用 namespaced element ID（如 `migrate-query::state-ready`），生成一个 projection-only compound boundary；父 Work Edge 的语义 ID和 Inspector 保留。
4. 展开时隐藏父边的画布 representation，用 source-to-entry 和 child-exit-to-target 的 projection meta edges 保持方向；这些 synthetic elements 明确标记 `projection_only: true`，不得出现在 Blueprint、Evidence 或 CLI 写命令里。
5. 收缩只移除/缓存 child elements 并恢复父边；折叠集合、面包屑和 viewport 属于浏览器会话状态，可放 `sessionStorage/localStorage`，不得写入 Mapflow runtime。
6. 只对刚展开/收缩的局部子图布局，保存父图节点位置；事实状态刷新不触发布局。若 child source stale，则保留 last-known-good 并把 stale 汇总到父边。
7. 键盘可达列表和 Inspector 与画布同步；展开/收缩按钮必须有 `aria-expanded`、子地图摘要和错误回退，不能只靠双击或小图标。

## 最终复用深度裁决

| 能力 | 最强候选 | 裁决 | 原因 |
| --- | --- | --- | --- |
| 层级画布 | Cytoscape.js compound nodes | 采用组件 | 已 vendored，能力够用，无新增依赖 |
| 自动折叠插件 | cytoscape-expand-collapse | 不采用代码，借鉴交互 | 不再维护且依赖 `_private`，不懂 Mapflow runtime |
| 父子地图合同 | Open Workflow nested workflow + Temporal Child Workflow | 借鉴设计 | 版本引用、独立历史、await/close policy 可复用；执行平台过重 |
| 到达回执 | W3C PROV + in-toto link metadata | 借鉴设计 | provenance/attestation 结构合适；完整序列化与签名超出 v0.4 |
| Event envelope | CloudEvents 1.0.2 | 采用规范子集 | 稳定的一手标准；SDK/消息系统无必要 |
| Proposal patch | typed domain proposal；RFC 6902 仅可选附件 | 自研领域合同 | 通用 patch 缺少语义、证据和确认边界 |
| 事件存储 | 本地 append-only JSONL + projection | 自研轻量胶水 | 引入 EventStore/Temporal 与个人仓库规模不相称 |
| 自动规划 | SHOP/HTN | 仅吸收递归拆解思想 | 完整领域 method 假设不成立 |

## 实施前的验收焦点

- 修改 child Blueprint 后，旧 receipt 仍可审计但父 edge 立即显示 stale，不能继续算 verified；
- 未确认 Proposal 即使来自 Codex、Git 或会议，也不会改变任何正式 Fact；
- 重放 events 可确定性重建 state，截断/重复 event 能被 seq 与 `source+id` 检出；
- 展开/收缩不改 Blueprint、events 或 state 文件；刷新浏览器后即使保留视图偏好，也必须重新从真相投影状态；
- child 逻辑可达但未 arrival 时，父 edge 不得 verified；
- child receipt acceptance 与 parent export 不匹配时产生结构化 proof gap；
- parent replan/close 对 running child 的 preserve/cancel/invalidate 行为有事件证据；
- 不使用扩展内部 API，Cytoscape 固定 bundle 和许可证仍由现有安装测试覆盖。

上述条件成立后，v0.4 才是“有真实父子语义的可展开地图”，而不是在单图上套一个视觉文件夹。
