# Real Codex segment: library-system-greenfield arrival audit

> 这是隔离的陌生 Codex 阶段测试，不是完整 Greenfield 旅程、真实用户研究、发布候选或生产证明。

## 测试合同

- 起点：已通过 `implementation-verified` 的联合快照，事件 revision 为 `17`，pending Arrival Audit Request 已存在。
- 输入：在全新 Codex 会话中先说“启用 mapflow，继续当前地图”，随后给出原主线的人工到达审计回答。
- 目标：一回合内读取仓库外 Sidecar，逐项回报 Acceptance、证据、非目标和遗留风险，并消费现有审计请求。
- 硬门：`arrived` 隐藏 Oracle 通过；目标文件零改动；revision `17` 之后只新增 `mapflow.arrival.audited.v1`。
- 预算：最多 1 轮、20 分钟。

## 四次运行

| Run | 条件 | 观察 | 结果 |
| --- | --- | --- | --- |
| `library-system-greenfield-arrival-audit-20260907143451-07b0df` | `workspace-write`，输入缺少恢复入口 | 115 秒、3 次工具动作、0 文件改动；Windows 工具启动持续返回 `CreateProcessWithLogonW failed: 1385`；事件仍停在 revision 17 | 基础设施失败，没有产品结论 |
| `library-system-greenfield-arrival-audit-20260907143730-ece78c` | `danger-full-access`，输入仍缺少恢复入口 | 211 秒、6 次工具动作、0 文件改动；Codex 只检查目标 Git，未恢复 Mapflow；事件仍停在 revision 17 | 测试协议失败，暴露陌生会话缺少入口 |
| `library-system-greenfield-arrival-audit-20260907144205-60652b` | `danger-full-access`，加入“启用 mapflow，继续当前地图” | 541 秒、30 次工具动作、0 文件改动；`arrived` Oracle 通过；事件从 revision 17 增至 18 | 阶段通过 |
| `library-system-greenfield-arrival-audit-20260907152317-f032e2` | `danger-full-access`，case `1.3.11` 最终合同 | 346 秒、23 次工具动作、0 文件改动；`arrived` Oracle 和精确事件序列均通过 | 阶段通过 |

两个成功 run 的唯一新增事件均是：

```text
mapflow.arrival.audited.v1
```

最新版 `1.3.11` run 从 revision `17` 开始，实际事件序列与期望序列都只有 `mapflow.arrival.audited.v1`。Codex 回报了 A1-A6 的实际检查、明确未做的外部发布与范围外功能，以及长期使用、无障碍和市场需求仍未验证；没有把合成体验检查说成真实用户证据。

原始证据保存在 `%LOCALAPPDATA%/Mapflow-benchmark/runs/<run-id>/` 的 `run.json`、`agent-turns.jsonl`、`turns.jsonl`、`checks.jsonl` 和 Agent 原始输出中。第三个 run 使用 case `1.3.10`，发生在事件序列硬门写入 `segment-report` 之前，因此保留原始报告不回写；第四个 run 使用 case `1.3.11`，其 `segment-report.json` 直接记录了精确事件序列门禁。

## 由反例得到的修复

1. `segment-turn` 固定加入公开恢复入口，但不提供节点 ID、命令、期望事件或标准路线。
2. case `1.3.11` 显式声明 `expected_event_types`。
3. Checkpoint 同时冻结事件 path、revision 和 head digest；doctor 校验它们与 Sidecar event head、state 一致。
4. `segment-report` 要求新增事件序列精确匹配，任何多余事件都进入 `segment-repair-and-retest`。
5. 只有尚未产生目标 checkpoint 检查或 Mapflow 增量的 run 才能归因为 `segment-infrastructure-failed`。

## 收口验收

- `node --check tools/benchmark.mjs`：通过。
- `npm test`：`93/93 PASS`，约 53 秒。
- `npm run benchmark:doctor`：7 个案例和 impact map 全部通过。
- `regression-plan` 针对本轮改动只选择 Oracle 层，没有自动选择 Agent segment 或 Release。
- README 本地链接与 3 个相关 JSON 文档检查通过。
- `git diff --check`：无空白错误；输出仅含工作树既有的 LF 到 CRLF 提示。

## 证据边界

这次结果证明：在一个合法的实施完成快照上，陌生 Codex 能通过公开入口恢复地图，并在一回合内保持到达审计边界。它没有重跑空白建图、目标定形、回归候选确认、路线批准和逐边施工，也不证明真人长期使用体验。完整旅程仅在发布候选或相关用户路径发生变化时显式运行。
