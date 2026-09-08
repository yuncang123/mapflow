---
map: mapflow-v0-3-redesign
status: complete
updated: 2026-09-03
---

# Destination

Mapflow 使用状态节点和独立工作边描述所有类型的工作；运行时能够验证结构、推演逻辑可达性、报告最小证明缺口，并且只有工作边的实际证据才能改变事实和派生节点状态。

# Current state

已验证事实和影响面见 [recon.md](recon.md)，复用裁决见 [Prior Art](../../../../../docs/research/mapflow-reasoning-prior-art.md)。用户已明确批准采用该方向，并允许归档原模型。

# Boundaries

## In scope

- 归档 v0.2 动作节点模型。
- 新领域词汇、ADR、行为真源、Blueprint schema 与模板。
- edge-first CLI、证明缺口、证据绑定和到达审计。
- 五个核心 Skill、分发入口、安装器和测试同步。

## Out of scope

- 动态浏览器看板、远程服务、自动执行工作边和外部系统写入。
- v0.2 兼容适配层。

# Route

| State | Independent work | Resulting state | Verification |
| --- | --- | --- | --- |
| v0.2 模型仍是活动真源 | `archive-action-node-model` | v0.2 核心语义可恢复且活动入口可被替换 | 归档清单和 Git diff |
| 旧模型已归档 | `define-state-edge-contract` | v0.3 术语、schema、模板和 ADR 一致 | schema 场景与引用检查 |
| v0.3 合同已固定 | `implement-edge-runtime` | CLI 按 edge 批准、门禁、验证、重规划和到达 | 定向 Node 测试 |
| runtime 行为成立 | `rewrite-agent-workflow` | 文档、Skills、安装分发只指向 v0.3 | 安装场景、`npm test`、`git diff --check` |

# Arrival audit

- [x] 状态节点、独立工作边、四值事实和证据合同成为活动真源。
- [x] 反向闭包、正向证明与结构化 proof gap 有自动化测试。
- [x] `active_edge/verified_edges/satisfied_nodes` 替换节点完成状态。
- [x] 每项最终验收可追溯到工作边证据。
- [x] v0.2 已归档，活动入口不存在兼容双轨。
- [x] 用户现有未提交安装器改动得到保留。
