# Synthetic user precheck: fast regression selection

> 这是合成用户预检，不是真实用户研究，也不证明完整旅程、发布就绪、长期采用、无障碍体验或市场需求。

## 测试合同

- 问题：维护者修改 Mapflow 后，能否从 README 快速选出与改动匹配的最小回归，并准确理解恢复动作和证据边界？
- 目标用户：重视时间成本与证据边界的个人 Mapflow 维护者。
- 核心工作：生成回归计划，执行确定性层，并判断何时需要 Agent segment 或显式 Release。
- 关键旅程：`README -> regression-plan -> deterministic regression -> coverage boundary -> interruption recovery`。
- 可观察接缝：README、计划器 stdout、命令帮助和确定性测试摘要。
- 首次价值：计划器给出命中规则、层级、命令、预计耗时和未覆盖范围。
- 决策人：当前 Mapflow 维护者。
- 允许写入：本仓库的评测证据；评审不得修改产品代码。
- 人类限定未知：真实维护者的长期使用、信任、回访、无障碍体验和市场需求。

## 独立面板

三个新鲜评审只拿到相同的公开入口、目标用户和关键旅程，不读取其他评审结论，也不修改代码。每人都从 README 找到回归入口，运行计划和确定性层，再核对 Agent 与 Release 的非覆盖声明。

| 角色 | Verdict | 总分 | 首次计划价值 | P0 / P1 |
| --- | --- | ---: | ---: | ---: |
| 低耐心维护者 | continue | 96/100 | 约 1.1 秒 | 0 / 0 |
| 怀疑型维护者 | continue | 94/100 | 约 0.9 秒 | 0 / 0 |
| 连续性与真相审计者 | continue | 93/100 | 约 0.8 秒 | 0 / 0 |

面板中位分为 `94/100`，`3/3` 选择 continue，没有确认的 P0/P1。唯一 P3 是 `matched rules` 首行略密集；后续层级、覆盖边界和命令列表仍能恢复理解，因此不阻断关键旅程，也不触发继续调文案。

## 共同观察

- `regression-plan` 明确输出 `PLAN ONLY; tests executed: none`，不会把计划冒充执行结果。
- 自动影响选择只闭包到 `oracle -> runtime -> agent`；Agent 标为 `TARGETED ONLY`，只覆盖 `arrival-audit / fresh-session-resume / actual-arrival-boundary`。
- 输出明确声明 `complete journey coverage: NOT PROVIDED by segments`，且 Release 未自动选择。
- 只有显式 `--level release` 才加入完整 Greenfield 旅程、其余案例和矩阵聚合。
- `segment-turn` 失败或中断后使用新目标重新 prepare；`check` 在无结果时可重跑同一 run，检查失败后需新 run；`segment-report` 可在同一 run 重跑。
- 三名评审各自运行确定性层，均得到 `93/93 PASS`，并看到 Agent、完整旅程和 Release 均为 `NOT RUN`。

## Gate

`ready-for-small-human-test`。关键的快速回归选择旅程完成，无确认 P0/P1，中位分高于 80/100，且多数评审选择 continue。

这只说明当前入口不容易浪费下一位真实参与者的时间。它不替代已经单独记录的真实陌生 Codex arrival-audit segment，也不把完整 Greenfield 或七案例 Release 矩阵标记为通过。

## 收口

```text
SYNTHETIC USER PRECHECK
Panel and target: 3 independent synthetic maintainers evaluating fast regression selection
Critical journey: README -> plan -> deterministic regression -> boundary -> recovery
Gate: ready-for-small-human-test
Confirmed P0/P1: none
Repairs made: none in this acceptance round
Deterministic checks: each reviewer observed 93/93 PASS
Fresh-retest result: 3/3 continue; median 94/100
Human-only unknowns: real repeated use, trust over time, accessibility, payment, and market demand
Recommended next action: use the fast plan per change; reserve complete journeys and the release matrix for an explicit release candidate
```
