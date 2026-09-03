---
map: vibe-coding-v1-1-node-blueprint
status: done
updated: 2026-09-01
---

# 地图：Node.js 状态工具与工作流蓝图

## Destination

把 `aigineer` v1 的状态工具改成 Node.js-only 命令，并交付一张工程化蓝图：从目标输入、现状勘探、决策收敛、路线批准、节点施工到到达审计，标出每个阶段的 skill、产物、门槛和当前缺失能力。

## Current state

- v1 曾有脚本版状态工具和单元测试，本轮迁移为 Node.js，不保留双运行时。
- 已有地图优先工作流、入口 skill 和五类阶段语句。
- 现有 `docs/workflow.md` 描述主流程，`docs/blueprint/vibe-coding.md` 补充阶段契约、Skill 介入图和缺口清单。
- 当前仓库已有 Node `package.json`、Node 测试和独立蓝图制品。

## Route

| 节点 | 目标状态 | 交付物 | 验收 |
| --- | --- | --- | --- |
| N1 | Node CLI 行为与旧版一致 | `tools/aigineer.mjs`、Node 测试、`package.json` | 状态转换和 gate 场景通过 |
| N2 | 仓库不再依赖旧脚本命令 | 删除旧工具/测试，更新文档与忽略规则 | 全仓搜索无旧运行时引用 |
| N3 | 蓝图可读且可追溯 | `docs/blueprint/vibe-coding.md`、Skill 介入矩阵、缺口审计 | 阶段、输入输出、门槛和分支齐全 |
| N4 | 蓝图有可视化制品 | Archify workflow JSON + HTML | 9 项 showcase 验证无错误/警告 |
| N5 | v1.1 自举完成 | 本地图、测试和到达证据回填 | Node 测试、链接、图形验证和状态到达通过 |

## Evidence

- `npm test`：5/5 Node 场景通过。
- `node --check tools/aigineer.mjs`：通过。
- `git diff --check`：通过。
- Markdown 相对链接检查：12 个 Markdown 文件通过。
- Archify `validate workflow ... --quality showcase --json`：9/9 checks，0 errors，0 warnings。
- Archify `deliver`：HTML 已生成，spec SHA-256 `339f7fec2ec2e2b8d939103be295450ed73762b08532472ca239dcde244851ab`。
- Archify `visual-check`：当前环境没有可用 Chrome/Chromium，截图未执行，结果保持 `visualReview: pending`。

## Decisions so far

- Node.js 作为唯一命令运行时，使用 Node 内置模块和 `node --test`，不引入第三方依赖。
- `docs/workflow.md` 是行为真源，当前任务地图仍用 Markdown；可扩展蓝图推荐用 `templates/blueprint.yaml` 表达语义，并由 `templates/blueprint.schema.json` 约束结构。
- HTML 是由 Archify 生成的可视化投影，不反向承载规则。
- skill 缺口先以审计形式交付，不在本轮顺手新增一批未经验证的 skill。
- 入口 `aigineer` 负责阶段路由；具体 skill 只在地图节点命中时介入。

## Not yet specified

- 蓝图是否需要持续从真实任务运行中自动收集触发数据；本轮只定义手工可执行的观察点。
- 是否为状态工具增加目标仓库安装器；本轮只交付可直接运行的 Node CLI。

## Out of scope

- 不把旧脚本运行时作为备用命令保留。
- 不实现跨宿主 Skill 安装、MCP 管理、团队协作或 Flow 门禁。
- 不把“缺少 skill”直接等同于“必须新建 skill”；先给出边界、输入和建议触发条件。

## Arrival criteria

- [x] Node CLI 覆盖初始化、批准、gate、节点选择、验证、重规划和到达审计。
- [x] 旧脚本工具、旧测试和旧运行命令从交付路径移除。
- [x] 详细蓝图说明每阶段的目的、进入条件、skill、产物、出口和失败分支。
- [x] Skill 矩阵区分已有能力、可复用能力和真正缺口。
- [x] Archify 图形制品通过 showcase 验证，且与 Markdown 语义一致。
- [x] Node 场景测试、文档链接、空白和最终状态检查通过。
