---
name: mapflow
description: "当用户明确说‘启用 mapflow’、‘进入地图优先模式’或使用地图批准、执行节点、重新规划、到达审计语句时，加载地图优先工作流。仅在这些入口语义明确时触发。"
---

# mapflow

地图优先个人开发的入口路由。完整行为规则只维护在一个真源中：

- 本仓库：`docs/workflow.md`
- 安装到目标仓库：`.mapflow/workflow.md`

## 入口动作

用户明确启用 mapflow 后：

1. 读取目标仓库 `AGENTS.md`、README、构建/测试入口，以及上述行为真源。
2. 读取 `.mapflow/state.json`（若存在）和当前地图文件，向用户报告当前阶段、目的地状态、活动节点和下一步。
3. 按行为真源选择并加载 `destination-shaping`、`repository-recon`、`blueprint-planning`、`node-slicing` 或 `node-delivery`；旁路能力只在路由命中时加载。
4. 在目标仓库使用 `node .mapflow/mapflow.mjs`；在本仓库使用 `node tools/mapflow.mjs`。

入口 Skill 不复制阶段规则、验收标准或完整施工步骤。没有明确启用语义时，不自动把普通开发请求升级为完整 mapflow；需要时只提示用户使用“启用 mapflow”。
