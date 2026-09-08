---
name: edge-delivery
description: "只执行已批准 Task Brief 对应的一条活动 Work Edge，并用实际检查证明 effects、更新事实和派生状态；当施工边界已经明确时使用。"
---

# edge-delivery：执行工作边并留证

## 步骤

1. **开工门**：确认完整路线已批准、唯一 `active_run` 为 active、该 Run 关联当前路线下的新鲜 granted 授权，且 Blueprint 与绑定 Task Brief 的联合 digest 未变化，并运行 `mapflow gate`。完成条件：from State Node、全部 preconditions 和适用 invariants 在实际 Fact 中成立；循环边仍有预算且 exit predicate 尚未成立。
2. **事实重读**：复核 Task Brief、允许执行面和相关上下游。完成条件：新事实未改变范围、依赖或验收；有变化则 `replan`。
3. **最小施工**：只执行该边声明的工作，不预做后续边。完成条件：产物处于可回滚边界，非目标没有进入改动。
4. **实际验证**：从便宜到昂贵运行检查，并区分实际、模拟、推测和未验证项。完成条件：每个 required effect Predicate 都有观察结果。
5. **证据写入**：调用 `verify --edge ... --result pass|fail --proves ... --acceptance ... --outcome-ref kind:ref --executor kind:identity`，记录检查、观察以及 Git/文档/会议/回执等实现引用；Agent executor 另记录实际模型和推理强度。子地图边改用 `verify-submap` 回读 arrival 和 Acceptance。完成条件：通过证据更新 Fact，run 为 passed，`verified_edges` 追加，`satisfied_nodes` 重新派生；失败或 unverified 不应用 effect，并执行失败分支。
6. **运行分支**：外部等待使用 `wait`，已知阻塞使用 `block`，条件恢复后用 `resume --run`，放弃本次尝试用 `cancel`。完成条件：每次生命周期变化已追加事件，waiting/blocked 不显示为 active。
7. **出口判断**：实际目的地 Predicate、逐项 Acceptance 证据和当前子地图 receipt 都成立时，运行 `request-arrival-audit --question ... --decision-owner human:<identity>`，向人展示冻结验收、非目标与遗留风险并结束本回合；创建请求的同一回答不得执行 `arrive`。收到后续独立人工回答时，先读取 pending request ID，第一项运行时动作直接执行 `arrive --request ... --answer ... --actor human:<identity>`；此前不得运行 `prove`、`gate` 或任何会追加 runtime event 的命令。若人不接受冻结结果，则不消费为到达，改为显式 `replan`。若尚未通过到达预检，在结果汇报后刷新 proof：恰有一条 ready/proven 后续边时，在同一回答结束前建立新的施工授权请求并展示问题；有多条时先展示差异并请人选择，不暗选。循环预算耗尽、receipt stale 或路线不再可达时局部修图。完成条件：响应以 pending 到达审计、replan 缺口、选择问题或 pending 授权问题之一结束，使用者无需猜测下一步。

## Evidence Record

```yaml
edge: review-candidate
claim: 候选稿已经批准
proves: [candidate-approved]
acceptance_ids: []
executor: human:owner
checks:
  - command: 实际命令或观察动作
    result: pass
    observed: 实际输出摘要
limits:
  simulated: []
  inferred: []
  unverified: []
  product_unknowns: []
```

对话、模型输出或工具发现的新 Fact 先用 `propose` 登记；只有显式 `confirm` 后才进入正式 Fact。Edge delivery 不直接把流式输入当证据写入。

工程或流程证据只支持其绑定的 Predicate；不自动证明产品价值、生产运行或公开发布。
