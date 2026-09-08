# Mapflow 可信地图演化回放 Prior Art

日期：2026-09-08

## 结论先行

Mapflow 需要的不是把最终图做成一段动画，而是“按历史时点重新投影当时可知的地图”，再把相邻时点的语义差异解释给人。应采用：

- **采用现有组件**：继续使用仓库已固定的 Cytoscape.js 3.34.2；使用其 `batch`、`add/remove`、`preset` layout 和 element animation，不新增图插件。
- **借鉴 Event Sourcing 的 as-of read model**：运行阶段复用现有 hash-chained JSONL 和事件内 projection snapshot；Wayfinding 另建同等级、append-only 的 `wayfinding-events.jsonl`，并在 `init` 时以 digest 将两段历史连接起来。
- **自行实现很薄的领域胶水**：从相邻 `BoardModel` 按 namespaced semantic ID 计算节点、边、状态、证据和验收差异；不采用通用 JSON diff 作为产品语义。
- **采用原生 Web 控件**：时间轴使用 `<input type="range">` 加播放、暂停、前后步和回到实时态，不引入 `vis-timeline`。
- **借鉴分布式追踪/Child Workflow 的多流边界**：父、子地图各自保留独立历史；组合回放保存各 stream head 的向量，并用 binding、causation 和 receipt pin 表达因果关系，不把不同流按墙上时钟伪装成一个权威全序。

该裁决落在“**采用组件 + 借鉴设计 + 仓库特定轻量胶水**”，没有理由引入数据库、工作流引擎、状态管理框架或新布局引擎。

## 1. 要解决的类别

能力可拆成四类：

1. 从空白、Wayfinding 到 runtime 的可验证历史和 as-of projection；
2. 相邻历史帧之间的语义图差异与稳定动画；
3. 可拖动、可播放且可访问的时间轴；
4. 父图与多级子图的独立历史组合。

历史帧必须回答“当时地图是什么”，差异必须回答“为什么变、由谁确认、影响哪个对象”。两者都只能由历史真相导出，不能从最终图倒推。

## 2. 本仓库已有能力与真实缺口

### 已经可以复用

- [package.json](../../package.json) 没有 runtime dependency；前端依赖以离线文件分发。
- [Cytoscape vendor notice](../../tools/vendor/cytoscape/NOTICE.md) 已固定 `cytoscape@3.34.2`，MIT，避免 CDN 和目标项目安装。
- [mapflow.mjs](../../tools/mapflow.mjs) 的 runtime event 已有 CloudEvents 风格 envelope、连续 `seq`、`base_revision`、`previous_digest`、event digest、actor 和完整 projection snapshot。每个 runtime 时点已经有足够数据做 as-of 投影。
- [mapflow-board-core.mjs](../../tools/mapflow-board-core.mjs) 会校验事件序号、map/stream identity、hash chain，以及最新事件 projection 与 `state.json` 一致；损坏时 fail closed。
- [app.js](../../tools/board/app.js) 已做到同一拓扑的状态更新不重新布局，子地图按 binding path namespace 并按需读取。

### 不能支持完整回放的缺口

- [mapflow-wayfinding.mjs](../../tools/mapflow-wayfinding.mjs) 的 `writeWayfinding()` 只对 `wayfinding.yaml` 做临时文件加 rename 的原子覆盖；`answerWayfindingQuestion()` 也只修改当前草稿。`enable → survey → shaping → regression` 的先前地图形态已经丢失。
- runtime `events.jsonl` 从 `init` 才开始，无法证明启用前为空、两枚迷雾候选出现、问题回答、Destination 确认和候选链逐项确认的过程。
- [mapflow-board-core.mjs](../../tools/mapflow-board-core.mjs) 的 `buildTimeline()` 只拼 `state.history` 和 Evidence 摘要，不读取事件 projection；[app.js](../../tools/board/app.js) 点击时间线只改 Inspector，画布仍是当前态。
- [mapflow-board.mjs](../../tools/mapflow-board.mjs) 只有当前 `/api/board` 和当前 `/api/submaps/<binding-path>`，没有历史索引或 frame endpoint。
- 当前拓扑变化会删除全部 Cytoscape elements、重新添加，再执行 `breadthfirst` 且 `animate: false`。这适合当前态刷新，不适合逐帧保持人的空间记忆。
- 子地图 API 只返回 child 当前态。展开状态是浏览器 session truth，但没有“父帧处于 seq N 时 child 应显示到哪个 seq”的组合游标。

因此，现有实现可完整回放 **runtime init 之后** 的状态，但没有产品入口；对 init 之前的过程则根本没有可信数据。不能用当前 `wayfinding.yaml` 中保留的回答或最终 Blueprint 补造中间帧。

## 3. Event Sourcing 与 as-of projection

### 3.1 Microsoft Event Sourcing pattern：借鉴设计

微软架构指南把 append-only event store 作为 system of record，状态由事件重放得到，materialized view 是面向查询的只读投影；它还明确指出可以恢复任意历史时点。快照只是减少重放成本的优化，不取代 event stream。

来源：[Microsoft Azure Architecture Center — Event Sourcing pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing)

适用于 Mapflow：历史图是 read model；当前 `state.json`、Wayfinding 当前 YAML 和 `BoardModel` 都是可替换投影，播放过去不能修改任何真相。

不整体采用通用 event-sourcing 框架：Mapflow 是单用户、本地、小流量 sidecar，现有 hash-chained JSONL 已覆盖顺序、完整性和重建边界。

### 3.2 KurrentDB：借 revision/cursor/checkpoint，不采用服务和 SDK

KurrentDB 官方 Node 文档区分单流 revision 与全局 log position，并支持从指定 revision 向前或向后读取；append 可带 expected stream state/revision 进行乐观并发检查。Projection checkpoint 绑定输入 position 及当时的 state/result。

来源：

- [KurrentDB Node client — Reading Events](https://docs.kurrent.io/clients/node/v1.3/reading-events)
- [KurrentDB Node client — Appending Events](https://docs.kurrent.io/clients/node/v1.3/appending-events)
- [KurrentDB — Projection streams and checkpoints](https://docs.kurrent.io/server/v26.1/features/streams#projections-events-and-streams)

适用于 Mapflow：`stream + seq + digest` 足以作为历史 cursor；Frame API 必须显式接受 cursor，不能只接受时间戳。

不采用 `@eventstore/db-client`/KurrentDB：本轮 npm 元数据显示客户端本身约 2.4 MB，并引入 gRPC/protobuf 依赖，且还需要外部服务；这会破坏离线、零安装、个人 sidecar 的产品边界。

### 3.3 当前“每事件完整 projection”可直接用于第一版

严格的 Event Sourcing 会从 typed events 经 reducer 重建任意状态。Mapflow 当前并非这样：`rebuild` 校验完整链后直接采用最后一个事件携带的 projection。第一版不应借回放功能顺手重写整个 runtime。

裁决：

- runtime 历史帧直接读取已验证事件中的 projection snapshot；
- wayfinding journal 同样保存经 schema 校验的完整 draft snapshot；
- `delta/summary` 用于解释和动画，但始终可以由相邻 snapshot 重算，不作为第二份真相；
- 将来事件量真正造成成本后再引入 periodic snapshot + reducer replay；目前每事件已有 snapshot，再加 snapshot 库没有收益。

## 4. Wayfinding 历史：独立流优于强行升级 runtime 流

有两个可行方案：

| 方案 | 优点 | 代价 | 裁决 |
| --- | --- | --- | --- |
| 把 wayfinding/runtime 全塞入新版 `events.jsonl` | 表面上只有一条流 | 需要让现有 event projection 从 runtime state 变成 union；`state.event_stream`、init/rebuild/旧事件兼容一起重写 | 暂不采用 |
| `wayfinding-events.jsonl` + 现有 `events.jsonl`，init 建立 digest bridge | 保持候选真相与正式运行真相边界；旧 runtime schema、rebuild 和安装包兼容面最小 | Board 要拼接两个有序 segment | **采用** |

建议 Wayfinding envelope：

```yaml
schema: mapflow.wayfinding-event/v1
source: mapflow://<workspace-id>/wayfinding
stream: wayfinding/<workspace-id>
seq: 4
type: mapflow.wayfinding.question.answered.v1
time: <RFC3339>
actor: human:owner
subject: question/confirm-destination
base_revision: <previous event digest or genesis digest>
previous_digest: <previous event digest>
data:
  summary: 人确认了目的地合同
  reason: <human answer>
  target: { kind: destination, id: deliver-orderpulse }
  snapshot: <validated canonical wayfinding draft>
event_digest: <canonical payload sha256>
```

写入顺序沿用 runtime：先验证候选 snapshot，append event，再原子替换当前 YAML。若二者 head 不一致，普通写命令和看板 fail closed，并允许从最新已验证 snapshot 重建 Wayfinding 当前态。

`init` 的首个 runtime event 增加不可变 bridge：

```yaml
data:
  details:
    source_wayfinding:
      stream: wayfinding/<workspace-id>
      seq: 17
      head_digest: <digest>
      draft_digest: <canonical wayfinding digest>
```

“什么都没有”的第 0 帧不能伪造。新 sidecar 的 genesis event 应保存 `before: { sidecar: absent, formal_nodes: 0, formal_edges: 0 }`，这表示 `enable` 当时观察到没有 Mapflow truth；第 1 帧才显示两枚互不相连的迷雾候选，正式拓扑仍为 0/0。

`writeWayfinding` 应按排除 `updated_at` 后的 semantic digest 判定 no-op，避免纯时间戳生成虚假演化帧。

## 5. Cytoscape 图差异与布局稳定

Cytoscape 官方 API 已提供所需原语：`cy.add()` 增加元素；`cy.batch()` 将多次修改合并为一次样式计算/重绘；element `animate()` 支持 position/style/duration/easing；`preset` layout 使用调用方给定的位置且可动画；`breadthfirst` 适合树、森林和 DAG。

来源：[Cytoscape.js API](https://js.cytoscape.org/)，具体见 [`cy.add`](https://js.cytoscape.org/#cy.add)、[`cy.batch`](https://js.cytoscape.org/#cy.batch)、[`eles.animate`](https://js.cytoscape.org/#eles.animate)、[`preset layout`](https://js.cytoscape.org/#layouts/preset) 与 [`breadthfirst`](https://js.cytoscape.org/#layouts/breadthfirst)。

### 5.1 不采用的候选

- `cytoscape-undo-redo@1.3.3`：它记录并反转 Cytoscape 画布操作。Mapflow 的过去态必须来自 sidecar 历史，绝不能让视图操作成为历史真相；只借鉴前后步交互，不采用代码。
- `cytoscape-dagre@4.0.1` / `cytoscape-elk@2.3.0`：可改善 DAG/compound 自动布局，但不能自动解决跨帧 semantic identity 和 mental map stability；ELK 还带约 8 MB 的 `elkjs`。当前内置布局已够用。
- `jsondiffpatch@0.7.6` / `microdiff@1.6.0`：通用 JSON diff 不理解节点/边 semantic ID、候选转正式、rewire、Evidence 或 receipt。后者虽小，仍会把数组顺序噪音当产品变化。不采用。

### 5.2 推荐的 semantic diff

稳定视觉键使用：

```text
visual_key = <binding-path namespace>::<semantic-id>
```

候选节点升级为正式节点时只改变 `layer/status`，只要 semantic ID 未变就沿用同一个 visual key 和位置。确需改名时，事件显式给出 `supersedes`；否则按 remove + add 处理，不能由相似文本猜测同一对象。

相邻帧派生：

```yaml
nodes: { added: [], removed: [], status_changed: [], content_changed: [] }
edges: { added: [], removed: [], rewired: [], status_changed: [] }
facts: { changed: [] }
evidence: { added: [] }
acceptance: { changed: [] }
cause_event: { stream, seq, type, actor, target, reason }
```

位置策略：

1. 捕获现有 visual key 的位置和 viewport；
2. 在 `cy.batch()` 中只 remove/add/update 差异元素；
3. 原有元素使用位置账本，不移动；
4. Wayfinding regression 根据已有 `depth` 固定横向列，新增 producer 从 target 附近淡入到目标位置；运行态大多只变状态，不重排；
5. 必须重布局时，用 `preset` 动画到确定性目标位置，并保留用户 pan/zoom；
6. forward 时新增绿色描边、变化黄色、阻塞/反例红色、退出淡出；backward 使用严格逆 diff；颜色之外同时显示图标/文字；
7. `prefers-reduced-motion` 下 duration 为 0。

这比每帧 `remove all → breadthfirst` 更能维持人的空间记忆，也无需新布局依赖。

## 6. 时间轴与交互

### 候选裁决

`vis-timeline@8.5.4` 提供复杂 items/ranges/groups/zoom；本轮 npm 元数据的 unpacked size 约 77.8 MB。Mapflow 只需离散 frame scrubber 和少量 stream lane，引入它会增加远超需求的 CSS、数据模型和分发体积。拒绝整体采用。

采用原生 `<input type="range">`，旁边放：第一帧、上一步、播放/暂停、下一步、实时态、速度。WAI-ARIA Slider Pattern 要求可通过方向键、Home/End 操作，并提供 `aria-valuemin/max/now`；非人类可读数值要用 `aria-valuetext`。来源：[W3C WAI-ARIA APG — Slider Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/slider/)。持续运动还必须能暂停/停止；来源：[WCAG 2.2 Understanding 2.2.2 Pause, Stop, Hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html)。

交互门槛：

- 默认处于“实时态”，不自动播放；只有人点击后才播放。
- 拖到过去后显示固定、醒目的“历史态 · seq N · 只读”；Inspector、计数、节点和边全部来自同一 frame。
- 轮询继续发现 live head，但不能把用户从历史态弹回现在；只显示“新增 N 帧”，点击“回到实时态”才切换。
- 每帧标题必须是领域变化，如“确认里程碑：回归测试可验收”，不能只显示 `wayfinding_write`。
- Inspector 同时展示 before/after、actor、target、human answer/evidence ref、为什么建立或移除，以及下一帧会发生什么。
- 播放到 head 自动暂停；页面不可见时暂停；键盘焦点和屏幕阅读器公告不能每 1 秒轰炸。

## 7. 推荐的历史 API

保持现有 `/api/board` 不变，新增只读接口：

```text
GET /api/evolution
GET /api/evolution/frames/<frame-id>
GET /api/submaps/<binding-path>/evolution
GET /api/submaps/<binding-path>/evolution/frames/<frame-id>
```

`/api/evolution` 只返回轻量 index，ETag 绑定两个 segment head：

```yaml
schema: 1
map_id: orderpulse-demo
coverage:
  complete: true
  from: pre-enable
  reason: null
live_frame: runtime:24
frames:
  - id: wayfinding:0
    stream: wayfinding/orderpulse-demo
    seq: 0
    phase: empty
    at: ...
    type: mapflow.workspace.enabled.v1
    actor: system:mapflow
    target: { kind: workspace, id: orderpulse-demo }
    summary: 启用前尚无地图
  - id: runtime:1
    stream: map/orderpulse-demo
    seq: 1
    phase: implementation
    bridge_from: { frame: wayfinding:17, digest: ... }
```

Frame endpoint 返回：

```yaml
frame:
  id: wayfinding:7
  cursor: { segment: wayfinding, seq: 7, digest: ... }
  event: { type, at, actor, subject, summary, reason, target }
  board: <BoardModel compiled only from this snapshot>
  diff_from_previous: <semantic diff>
  stream_heads: { root: { segment: wayfinding, seq: 7, digest: ... } }
```

Frame 必须用事件中冻结的 Wayfinding draft 或 runtime Blueprint/Brief/state snapshot 编译，不能混入磁盘上的当前 Blueprint/Brief。Index 可缓存到进程内，head digest 改变时失效；不能落成另一个可写真相文件。

## 8. 子地图多流合成

Temporal 官方文档把 Child Workflow 定义为独立 Workflow Execution；父级等待 child spawn，可选等待结果，并由 Parent Close Policy 控制父关闭后的处理。child 的状态变化存在自己的 Event History。来源：[Temporal — Child Workflows](https://docs.temporal.io/child-workflows)。

OpenTelemetry 将 operation 表达为可嵌套 span，并允许 immutable Link 指向同一或不同 trace 的 SpanContext；事件时间也可能因自定义时间而乱序。来源：[OpenTelemetry Trace API](https://opentelemetry.io/docs/specs/otel/trace/api/)，尤其是 Span、Event ordering 与 Link。

Lamport 的 `happened-before` 是偏序；把无因果关系的事件强行排成全序需要额外规则。来源：[Leslie Lamport, Time, Clocks, and the Ordering of Events in a Distributed System](https://doi.org/10.1145/359545.359563)。

借鉴到 Mapflow：

- 每张 child 保持自己的 `wayfinding/runtime` segments、seq 和 hash chain；父图不复制 child 全量事件。
- 父 binding 建立一个因果入口；`verify-submap` 的 parent receipt event 固定 child map digest 和 child event revision，形成因果出口。
- 展开历史 child 时，组合游标不是单个时间，而是：

```yaml
composite_cursor:
  root: { frame: runtime:9, digest: ... }
  children:
    preparation:
      frame: runtime:12
      digest: ...
      basis: { kind: receipt-pin, parent_frame: runtime:9 }
```

- 没有 receipt pin 时，child lane 由自己的 frame 控制。可提供按 `time, binding-path, seq` 排列的“演示顺序”，但必须标成 presentation order；真正的因果只来自 stream order、binding、causation link 和 receipt pin。
- sibling child 不得因为时间戳接近而互相建立先后依赖。
- child 在绑定之前已有的历史默认不进入父级主线，可在 child 独立历史中查看。
- 收缩态摘要节点必须使用 composite cursor 指定的 child as-of 状态，不能泄漏 child 当前态。

这保留了 Mapflow 已有“父单向绑定、child 独立真相、receipt 固定 revision”的模型，也能对任意深度 binding path 递归。

## 9. 兼容和可信边界

- 新建 sidecar 可从 pre-enable genesis 完整覆盖，`coverage.complete: true`。
- 已有 runtime stream 只能从首个现存事件开始，标 `coverage.complete: false, from: runtime-init`；不得根据最终地图生成假的勘探/确认动画。
- 已有、尚未 init 的 Wayfinding 只有当前 YAML 时，升级后写一个 `migration-anchor` snapshot，标 `from: current-wayfinding-snapshot`，历史仍为 partial。
- event schema、Blueprint 或 BoardModel 升级时，未知版本 fail closed；旧 frame 不能用当前 schema 默默重解释。
- 历史 frame 不加载当前外部 evidence 文件内容，只显示被冻结的引用和 digest，避免外部文件变化改写过去。
- 播放、展开/收缩、速度、选中、viewport 都是浏览器会话状态，不写 Blueprint、events、Wayfinding 或 state。

## 10. 最终复用深度裁决

| 能力 | 最强候选 | 裁决 | 原因 |
| --- | --- | --- | --- |
| 历史真相与 as-of | 当前 runtime JSONL + Wayfinding 同构 journal | 采用现有实现并补组件 | 已有 seq/hash/projection，缺的只是 init 前历史 |
| 通用 EventStore | KurrentDB / `@eventstore/db-client` | 借鉴 API，不采用代码 | 服务和 gRPC 依赖超出本地 sidecar |
| 历史状态框架 | Redux undo history | 只吸收 past/present 交互 | playback 不是 undo，不能丢弃 future 或修改真相 |
| 图渲染/动画 | Cytoscape.js 3.34.2 | **采用组件** | 已固定、离线、能力完整 |
| 图 undo 插件 | `cytoscape-undo-redo` | 不采用 | 画布操作不能成为历史 |
| 新布局 | dagre/ELK/fCoSE | 暂不采用 | 不能替代 semantic ID 位置账本，新增体积 |
| 图差异 | jsondiffpatch/microdiff | 自研语义 diff | 通用数组/对象 diff 不懂 Mapflow 领域 |
| 时间轴 | 原生 range + buttons | **采用平台组件** | 最轻、键盘语义明确、易离线 |
| 复杂 timeline 库 | vis-timeline | 不采用 | 能力与体积远超离散帧播放 |
| 子地图历史 | Temporal child + OTel link + Lamport 偏序 | 借鉴设计 | 保持独立流、显式因果和组合 cursor |

## 11. 实施验收焦点

1. 新工作区确实可播放：无 sidecar → 两枚无连线迷雾候选 → 勘探 → Destination 确认 → 反向候选逐项确认 → init → 路线批准 → 边执行/Evidence → replan 或 arrival audit。
2. 每一帧直接来自通过完整性校验的历史 snapshot；篡改、截断、重复 seq 或 bridge digest 不匹配时 fail closed。
3. 前后步时 Inspector、计数和图完全一致，不出现“历史图 + 当前 evidence/child”的混合态。
4. 候选转正式沿用 semantic identity；状态变化不重布局，新增/移除/rewire 有清晰且可关闭的动画。
5. 停在历史态时 live 更新不抢走视图；回到实时态一步到 head。
6. native range 的方向键、Home/End、可读 `aria-valuetext`、播放暂停、reduced motion 均可用。
7. 多子图回放用 stream-head vector；parent receipt 精确固定 child revision，sibling 不因时间戳被伪造为因果顺序。
8. 旧地图清楚显示 partial coverage，不伪造空白到 init 的历史。
9. board 仍只接受 GET/HEAD；所有回放操作对 sidecar 和目标工作区均零写入。
10. 完整链路加入确定性测试：Wayfinding journal 重建、runtime as-of、semantic diff、bridge、legacy coverage、child composite cursor、ETag、浏览器前后步与无布局抖动。

通过这些条件后，Mapflow 才能准确宣称“演示地图从什么都没有到当前形态的真实演化”，而不只是把最终图按预设顺序播放。
