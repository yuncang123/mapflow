# Mapflow v0.5.5 动态地图旅程验收

> 结论：当前版本通过确定性回归和三名全新合成用户的关键旅程复测，达到 `ready-for-small-human-test`。这是个人使用验收候选，不等于完整 Release 矩阵、真实长期使用或市场验证。

## 本轮问题与修复

- 旧版 pending 人工请求缺少 `decision_owner` 时，看板不再假装有人负责，而把唯一下一步切换为“Agent 补登责任人”。新增 `assign-decision-owner`，只修改责任归属，不批准路线、不授权施工、不登记到达。
- 路线批准、施工授权、拒绝和到达审计只能由请求中登记的 `decision_owner` 身份消费；个人工作区默认身份 `human:owner` 在看板显示为“你”。
- 左侧对象列表与画布摘要节点都支持双击展开/收缩。展开后聚焦子地图，检查器顶部直接提供收缩按钮。
- 左栏明确区分“主地图真相计数”和“当前视图对象”；展开/收缩只改变投影对象数。
- 冻结的旧版到达审计 checkpoint 通过显式责任人补登后继续，事件合同为 `decision.owner.assigned -> arrival.audited`。

## 确定性证据

| 检查 | 结果 |
| --- | --- |
| `npm run test:regression` | 100/100 PASS；约 59.5 秒；Oracle + Runtime；case-package doctor PASS |
| `tests/test_board.mjs` | 27/27 PASS |
| `tests/test_mapflow.mjs` | 51/51 PASS |
| 人工门定向用例 | 2/2 PASS；覆盖补登、身份不匹配拒绝和到达 revision 保持 |
| `npm run benchmark:doctor` | 7/7 case packages + impact map PASS |
| Node 语法检查 | `mapflow-core`、`mapflow-board-core`、`mapflow-board`、`mapflow`、`board/app` 全部 PASS |
| `git diff --check` | PASS |

`test:regression` 明确未运行 Agent segments、完整旅程和 Release 矩阵。

## 浏览器观察

- 旧状态看板首屏显示：阶段“探路建模”、逻辑可达、尚未实际到达；唯一下一步为“补登路线确认责任人”，处理者为当前会话 Agent，完成后只恢复原人工门。
- 社区工作坊子地图从左侧列表双击后直接展开；当前视图对象 `5 -> 12`，收缩后恢复为 `5`。
- 主地图满足节点 `2/2`、完成工作边 `1/1`、验收 `1/1` 在展开期间不变；真相版本始终为 `77973b1bd02a`。
- 展开后的检查器顶部可见“收缩子地图”，并可追溯父工作边 `complete-workshop-preparation`、子地图 `prepare-community-workshop`、验收 `1/1` 和有效回执 `workshop-preparation-receipt-1`。

## Synthetic user precheck

三名全新评审使用独立子地图端口，只拿到产品入口、目标用户和关键旅程，不读取源码、内部文档、既有发现或其他评审结论。

| 角色 | Verdict | 总分 | 首次价值 | P0/P1 |
| --- | --- | ---: | ---: | ---: |
| 低耐心个人使用者 | continue | 89/100 | 15.2 秒 | 0/0 |
| 真相与连续性审计者 | continue | 90/100 | 12.884 秒 | 0/0 |
| 交互设计审计者 | continue | 82/100 | 11.5 秒 | 0/0 |

中位分 `89/100`，`3/3` 选择 continue，没有确认的 P0/P1。Gate 为 `ready-for-small-human-test`。

剩余非阻断观察：展开后的画布标签在当前布局下仍偏小；两组计数虽已明确命名，首次使用者仍需通过一次展开理解差值；历史凭据存在中英文混排。这些问题不阻断当前核验旅程，不继续用同一合成协议反复调参。

## 全局安装

- `node tools/install.mjs --global --force` 已安装 `0.5.5 (core)` 到 `C:\Users\chaoyuan12\.agents\skills\mapflow`。
- `install-manifest.json` 报告版本 `0.5.5`，全局 CLI 帮助包含 `assign-decision-owner`。
- 33 个无安装期转换的源码/安装文件执行 SHA-256 比对，`33/33` 一致。

## 证据边界

- 未运行 v0.5.5 的真实陌生 Codex Agent segment、完整 Greenfield 旅程或七案例 Release 矩阵；2026-09-07 的 segment 只能作为历史证据。
- 未证明超大地图、多层嵌套、移动端、仅键盘、屏幕阅读器、并发刷新和长时间运行体验。
- 合成用户不是实际用户，不能证明长期采用、项目成功率、无障碍体验、付费意愿或市场需求。

```text
SYNTHETIC USER PRECHECK
Panel and target: 3 fresh synthetic reviewers; personal Mapflow user
Critical journey: recover ownerless gate -> read truth -> expand from list -> inspect receipt -> collapse
Gate: ready-for-small-human-test
Confirmed P0/P1: none
Repairs made: actionable owner recovery and enforcement; direct list expansion; scoped counts; focused submap controls
Deterministic checks: 100/100 PASS; 7/7 case packages PASS; syntax and diff checks PASS
Fresh-retest result: 3/3 continue; median 89/100
Human-only unknowns: real repeated use, accessibility, large maps, project outcomes, and market demand
Recommended next action: perform one real personal-project walkthrough; reserve full journeys and the seven-case matrix for an explicit release candidate
```
