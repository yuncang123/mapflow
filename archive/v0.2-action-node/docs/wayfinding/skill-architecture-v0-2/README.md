---
map: skill-architecture-v0-2
status: done
updated: 2026-09-02
---

# 地图：核心 Skill 拆分与落地

## Destination

在不假设已有 Skill 的前提下，为“目的地优先、蓝图收敛、按节点施工”的单人开发工作流定义职责明确、低耦合的核心 Skill，并吸收本地与公开 prior art，形成可独立分发、可按任务分辨率组合的仓库内实现。

## Current state

- v1.1 已有 `aigineer` 入口、状态 CLI、工作流行为真源和蓝图模板。
- 既有能力能覆盖部分 grilling、wayfinding、TDD、诊断和审查，但目标契约、仓库影响报告、地图到施工切片没有稳定的独立入口。
- 本轮 prior-art 结论保存在 `docs/research/skill-prior-art.md`，能力边界保存在 `docs/blueprint/skill-architecture.md`。

## Route

| 节点 | 目标状态 | 交付物 | 验收 |
| --- | --- | --- | --- |
| N1 | 核心能力边界收敛 | `docs/blueprint/skill-architecture.md` | 每个能力有独立问题、输入、输出、边界和复用裁决 |
| N2 | 五个核心 Skill 可被发现和加载 | `skills/destination-shaping/`、`repository-recon/`、`blueprint-planning/`、`node-slicing/`、`node-delivery/` | 每个 `SKILL.md` 通过 `quick_validate.py` |
| N3 | 路由与共享模板一致 | `README.md`、`docs/skill-routing.md`、`skills/aigineer/SKILL.md`、蓝图/Work Item 模板 | 相对链接、字段和核心链路没有矛盾 |
| N4 | 可视化投影反映新分工 | `docs/blueprint/vibe-coding.workflow.json/html` | Archify showcase 9/9、0 errors、0 warnings |
| N5 | 节点级证据和边界完成审计 | 测试、JSON 解析、diff 检查、视觉检查回执 | 工程检查实际通过，Chrome 缺失保持 visual review pending |

## Decisions

- `destination-shaping` 只拥有 Destination Contract，不扫描仓库或选择实现路线。
- `repository-recon` 合并 `impact-mapping`，统一产出事实、调用方、被调用方、共享契约、生成物和回归面。
- `node-delivery` 与 `aigineer` 合并节点证据和到达协议，不另造独立 `evidence-auditor`。
- `node-slicing` 承担地图到 Work Item 的稳定转换；它不重新定义目的地。
- `product-validation` 和 `release-action` 暂停在按需/未来边界，不进入默认单人开发链路。
- 本轮只写入 `aigineer` 仓库，不自动安装到用户级 `C:/Users/chaoyuan12/.agents/skills`。

## Out of scope

- 自动 Skill Hub、依赖解析器或动态编排运行时。
- 真实用户研究、业务指标验证、部署、发布、外部写入和凭证管理。
- 将 CoAgentWorkflow 的多人协作、Flow 门禁或团队制度变成核心 Skill 的硬依赖。

## Evidence

- 五个新增 Skill 与既有 `aigineer` 共 6 个入口均通过 `quick_validate.py`。
- `npm test`：5/5 状态工具场景通过。
- `node --check tools/aigineer.mjs`：通过。
- `templates/blueprint.schema.json` 与 Archify 输入 JSON 均能解析。
- Markdown 相对链接检查：19 个文件通过。
- Archify `validate` 与 `deliver`：9/9 checks、0 errors、0 warnings，HTML 已重新生成。
- Archify `visual-check`：当前环境没有 Chrome/Chromium，截图未执行，`visualReview` 保持 `pending`。

## Arrival audit

- [x] 核心 Skill 的职责和边界已写入能力架构。
- [x] 五个核心 Skill 已落盘并通过格式校验。
- [x] 路由、模板和可视化投影已同步。
- [x] 工程验证证据已记录，未验证的视觉检查保持明确。
- [x] 产品价值、发布和全局安装没有被误宣布为已完成。
