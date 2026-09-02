---
name: mapflow
description: "当用户明确说‘启用 mapflow’、‘进入地图优先模式’或使用地图批准、执行节点、重新规划、到达审计语句时，管理个人开发的阶段状态与路由。仅在这些入口语义明确时触发。"
---

# mapflow：地图优先的个人开发入口

这个入口把一次开发工作保持在一个可追踪的状态机里。`docs/workflow.md` 是完整行为真源；本 skill 只负责识别阶段、指向状态工具和阻止过早施工。

安装到目标仓库后，行为真源位于 `.mapflow/workflow.md`，状态投影位于 `.mapflow/state.json`，状态命令为 `node .mapflow/mapflow.mjs`。在本仓库开发时使用 `node tools/mapflow.mjs`。

## 启动

用户说“启用 mapflow”“进入地图优先模式”或直接给出一个需要先规划的开发目标并明确要求地图优先时：

1. 读取目标仓库的 `AGENTS.md`、README、构建/测试入口和相关代码。
2. 读取 `.mapflow/state.json`（若存在）以及当前地图文件。
3. 没有状态时，先用 `node .mapflow/mapflow.mjs init --destination ...` 建立 `wayfinding + draft` 状态；地图正文由 Agent 按 `.mapflow/templates/map.md` 维护。
4. 用事实、目标、非目标、未知项和候选路线形成最小充分蓝图。

地图阶段的完成条件是：目的地可验收、当前现状有证据、关键未知项已解决或被明确列为探针、第一条可执行路线已经写入地图。达到条件后等待用户说“地图已批准，进入施工”。

## 阶段协议

| 用户语句 | Agent 动作 | 状态要求 |
| --- | --- | --- |
| `进入地图优先模式` | 勘探、提问、维护地图 | `wayfinding` |
| `地图已批准，进入施工` | 固定目的地和路线，选择第一个节点 | `approve` 后为 `implementation` |
| `执行地图节点 N` | 只实施 N，先调用 `gate`，完成后验证 | `implementation + approved + current_node=N` |
| `发现偏差，重新规划` | 停止施工，记录新事实并重算路线 | `replan` 后为 `wayfinding + changed` |
| `进行到达审计` | 对照目的地、验收和遗留风险复核 | `arrive` 后为 `arrived` |

“继续”“开始做吧”“按计划来”不是阶段切换语句。它们出现时，先显示当前阶段和下一节点，再要求用户使用上表中的明确语句。

## 实施门槛

在任何代码、配置或生成物写入前：

1. 确认目的地已批准，且当前节点唯一明确。
2. 调用 `node .mapflow/mapflow.mjs gate`（本仓库开发时调用 `node tools/mapflow.mjs gate`）；返回非零时保持地图阶段。
3. 只修改当前节点声明的范围。
4. 完成后运行节点验收，并调用 `verify --node N --evidence "..." --command "实际命令" --observed "实际输出摘要"`。

如果工具不可用，至少在对话中复述同样的四个条件；工具恢复后补写状态。没有批准目的地或当前节点时，Agent 的工作产出是地图和问题，不是代码。

## 路线变化

新证据改变目标、范围、依赖或验收时，立即使用 `replan`。不要为了保持原路线而掩盖偏差；保留已验证节点，重新定义未完成节点。目的地本身变化时，等待用户重新批准。

## 可选能力

核心能力按当前阶段和任务分辨率加载，不要求小任务全量启用：

- `destination-shaping`：把用户请求定形为 Destination Contract。
- `repository-recon`：以仓库证据形成事实、影响面和未知项报告。
- `blueprint-planning`：把现状到目的地收敛为带转移和回退的 Blueprint Map。
- `node-slicing`：把已批准地图节点切成有写集和验收的 Work Item。
- `node-delivery`：只实施当前 Work Item，记录节点级 Evidence Record。

旁路能力按需加载：`grilling` 解决取舍，`prior-art` 查现成方案，`diagnosing-bugs` 定位故障，`tdd` 组织行为测试，`code-review` 检查非微小改动，`session-handoff` 保存跨会话状态。它们不能绕过阶段协议。
