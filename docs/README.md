# Mapflow 文档地图

Mapflow 的产品使命是：**为所有任务提供清晰可靠的导航图。** 本页只说明各类文档的权威范围，防止阶段性设计、案例或历史记录被误读为当前产品边界。

## 当前真源

- [`workflow.md`](workflow.md)：行为唯一真源；定义显式启用、建图、推进、证据和到达规则。
- [`../CONTEXT.md`](../CONTEXT.md)：领域词汇；区分整项 Task、Navigation Map 与内部 Work Edge。
- [`blueprint/map-model.md`](blueprint/map-model.md)：当前 Blueprint 关系和 schema 3 语义。
- [`skill-routing.md`](skill-routing.md)：按当前位置加载最窄能力的路由。
- [`adr/`](adr/)：仍然有效的架构决定及其理由；ADR 不替代行为真源。

行为意图以 `workflow.md` 为准，当前 schema、运行时代码和测试提供可执行证据；彼此冲突就是待修缺陷，不能用 README、示例或历史记录单独改写行为。

## 条件式参考

- [`integration/enterprise-handoffs.md`](integration/enterprise-handoffs.md)：只有任务涉及跨岗位交接时加载。
- [`../templates/`](../templates/)：可选起点，不定义每个任务必须具有的字段或规模。
- [`../examples/`](../examples/)：展示不同任务形态；案例中的工程阶段、岗位和路线不是产品适用范围。
- [`../benchmarks/`](../benchmarks/)：当前有限案例的产品体验与回归合同，不证明已经覆盖“所有任务”。

## 历史材料

- [`research/`](research/)：带日期的 Prior Art 和当时裁决，只作为设计证据。
- [`wayfinding/`](wayfinding/)：Mapflow 自身早期版本的建图记录，不是当前 Workspace Head。
- [`../self-bootstrap-wayfinding.yaml`](../self-bootstrap-wayfinding.yaml) 与 [`../self-bootstrap/`](../self-bootstrap/)：v0.8.0 形成前的自举地图，保留当时“目的地反推闭环”的任务语境。
- [`../self-bootstrap-live/`](../self-bootstrap-live/)：v0.9.0 连续航段的自举地图，只记录活导航能力如何形成。
- [`../archive/`](../archive/)：已退出活动模型的完整历史快照。

新的任务地图保存在目标工作区之外的 Workspace Sidecar；不要把运行中的地图重新写进 `docs/wayfinding/`。
