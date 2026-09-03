# Mapflow 动态看板 Prior Art

日期：2026-09-03

## 类别与来源

目标属于“本地动态图投影 + 证据检查器”，不是通用任务管理器。本轮检查了：

- 本仓库的 Blueprint、runtime state、原子写入、安装器和 vendored `js-yaml`；
- npm registry 中的 `cytoscape@3.34.2`、`sigma@3.0.x`、`vis-network@10.1.0`；
- 已归档 Archify 静态图与当前 Map Projection 约束。

## 候选

### Cytoscape.js

MIT，3.34.2，提供节点/边样式、选择、事件、缩放、平移和内置布局。浏览器 bundle 可离线分发，适合 Mapflow 的中小型语义图和丰富边检查器。采用组件。

### Sigma.js

MIT，偏 WebGL 大规模图渲染，并依赖 graphology 生态。Mapflow 当前瓶颈是语义解释、证据追溯和稳定布局，不是十万级节点吞吐；不采用代码，保留为未来大图替代渲染器。

### vis-network

MIT/Apache-2.0，交互能力覆盖需求，但 npm 包体和能力面明显更大，超出轻量本地投影需要。不采用。

### Archify

适合精致静态交付物，缺少持续读取 runtime state、增量刷新和面向证据的 Inspector。只借鉴视觉表达，不作为动态运行时。

## 裁决

落在“采用组件 + 借鉴设计”：

- vendor Cytoscape.js 的固定版本浏览器 bundle 和许可证，不依赖 CDN 或目标项目安装；
- 使用内置 breadth-first 布局，不增加布局插件；
- Mapflow 自己定义 BoardModel、ETag 刷新、last-known-good、只读本地服务、过滤器和证据 Inspector；
- 借鉴 read-model projection 与 overview/filter/details-on-demand；正式事实仍只来自 Blueprint、state 和 Evidence Record。
