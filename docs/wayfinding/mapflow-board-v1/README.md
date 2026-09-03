---
map: mapflow-dynamic-board
status: arrived
updated: 2026-09-03
---

# Destination

交付一个可离线安装、动态刷新、只读且证据可追溯的 Cytoscape 看板，使人能够从全局态势下钻到 State Node、Work Edge、Task Brief、Proof Gap、Acceptance 和 Evidence Record。

# Current state

- Mapflow v0.3 的 Blueprint、runtime state、Task Brief 与 Evidence 已能编译为稳定 BoardModel。
- 只读本地服务、Cytoscape UI、ETag 刷新、last-known-good、离线安装和浏览器交互均已实现。
- 四条 Work Edge 已验证，五项目的地验收通过；复用裁决见 [Prior Art](../../research/mapflow-board-prior-art.md)，视觉合同见 [design.md](design.md)。

# Boundaries

## In scope

- 只读 BoardModel 编译器与 last-known-good 刷新协议。
- 绑定 `127.0.0.1` 的本地 HTTP 服务、ETag 和静态资源。
- Cytoscape 图、路线过滤、搜索、Inspector、验收与事件时间线。
- 项目级安装、CLI、自动化测试和真实浏览器验收。

## Out of scope

- 从看板修改 Blueprint、执行 Work Edge 或写入外部系统。
- 远程托管、多人实时同步和超大图 WebGL 优化。

# Route

| State | Work edge | Result | Evidence |
| --- | --- | --- | --- |
| v0.3 runtime 可用，看板缺失 | `compile-board-model` | 真相可编译为稳定 BoardModel | 单元测试与 fixture |
| BoardModel 合同成立 | `build-interactive-board` | 本地服务与交互式图可用 | API、ETag、DOM 与安全头测试 |
| 看板可用 | `wire-board-distribution` | CLI、安装器与文档可分发 | 安装 smoke test |
| 分发成立 | `audit-board-in-browser` | 桌面与窄屏核心旅程通过 | 浏览器截图、交互与刷新验收 |

# Arrival audit

- [x] 投影严格区分正式事实、逻辑推演与实际到达。
- [x] 状态变化原位刷新，拓扑变化才重新布局。
- [x] 节点、边、Brief、Evidence、Acceptance 和 Proof Gap 可追溯。
- [x] 半写入或无效来源保留最后有效地图并明确标记 stale。
- [x] 看板无业务写入口，服务只绑定本机地址。
- [x] 项目级安装后无需联网或安装前端依赖。
- [x] 自动化与真实浏览器验收均通过。

验收证据：`npm test` 通过 42 项；Blueprint 为 `complete/logical` 且无 proof gap；真实浏览器通过桌面与 720px 窄屏、节点/边下钻、Predicate 搜索、三种镜头、变化时间线、动态原位刷新、stale 回退和控制台零错误检查。结论不替代真实用户研究或超大图性能测试。
