---
name: mapflow
description: "当用户明确说‘启用 mapflow’、‘进入地图优先模式’，或使用批准地图、执行工作边、重新规划、到达审计语句时，加载证据驱动的地图优先工作流。仅在这些入口语义明确时触发。"
---

# mapflow

Mapflow 的入口路由。行为唯一真源位于：

- 本仓库：`docs/workflow.md`
- 安装到目标仓库：`.mapflow/workflow.md`

## 入口动作

1. 读取目标仓库约定、行为真源、活动 Blueprint 和 `.mapflow/state.json`（若存在）。完成条件：能够报告目的地、四值事实、证明等级、活动 Work Edge、满足的 State Node 和 proof gaps。
2. 没有 Blueprint 时，先用 `destination-shaping` 定形目的地，再从当前工作环境的权威来源固定起始 Fact；只有仓库型工作才加载 `repository-recon`。随后用 `blueprint-planning` 建图，并在校验前用 `edge-slicing` 为每条候选边建立独立 Brief。完成条件：地图通过结构校验并得到一次正向可达性结论。
3. 有已批准地图时，加载 `edge-delivery` 推进唯一活动边。相邻 Skill：`../<name>/SKILL.md`。完成条件：实际证据已绑定 edge、predicates 和 acceptance IDs。
4. 在目标仓库使用 `node .mapflow/mapflow.mjs`；在本仓库使用 `node tools/mapflow.mjs`。Blueprint 局部修改后、再次 prove/approve 前，用 `replan --scope ... --changes ...` 登记精确 diff，保留既有 Evidence Record 和已验证 Work Edge 合同。

入口 Skill 不复制完整阶段规则。普通开发请求没有明确入口语义时，不自动套用完整 Mapflow。
