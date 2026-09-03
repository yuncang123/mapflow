---
name: edge-delivery
description: "只执行已批准 Task Brief 对应的一条活动 Work Edge，并用实际检查证明 effects、更新事实和派生状态；当施工边界已经明确时使用。"
---

# edge-delivery：执行工作边并留证

## 步骤

1. **开工门**：确认 Destination 已批准、`active_edge` 唯一、Blueprint 与绑定 Task Brief 的联合 digest 未变化，并运行 `mapflow gate`。完成条件：from State Node、全部 preconditions 和适用 invariants 在实际 Fact 中成立；循环边仍有预算且 exit predicate 尚未成立。
2. **事实重读**：复核 Task Brief、允许执行面和相关上下游。完成条件：新事实未改变范围、依赖或验收；有变化则 `replan`。
3. **最小施工**：只执行该边声明的工作，不预做后续边。完成条件：产物处于可回滚边界，非目标没有进入改动。
4. **实际验证**：从便宜到昂贵运行检查，并区分实际、模拟、推测和未验证项。完成条件：每个 required effect Predicate 都有观察结果。
5. **证据写入**：调用 `verify --edge ... --proves ... --acceptance ... --outcome-ref kind:ref --executor kind:identity`，记录检查、观察以及 Git/文档/会议/回执等实现引用；Agent executor 另记录实际模型和推理强度。完成条件：通过证据更新 Fact，`verified_edges` 追加，`satisfied_nodes` 重新派生；失败或 unverified 不应用 effect。
6. **出口判断**：实际目的地 Predicate 与逐项 acceptance 证据都成立时才进行 `arrive`；否则只从当前 proof 的 `proven_edges` 选择下一条 ready edge。循环预算耗尽或路线不再可达时局部修图。

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

工程或流程证据只支持其绑定的 Predicate；不自动证明产品价值、生产运行或公开发布。
