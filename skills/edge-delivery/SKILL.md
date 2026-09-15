---
name: edge-delivery
description: "只执行当前活动 Work Edge，并用实际检查证明 effects、更新事实和派生状态；当施工边界已明确时使用。"
---

# edge-delivery：执行工作边并留证

## 步骤

1. **确定性派发**：运行 `next-actions --json`。无 active Run 时，普通 proven/ready 边用 `start`；只有 Brief 声明授权要求时才走 `request-authorization → authorize`。再运行 `gate`。完成条件：唯一 Run active，当前 Fact 满足 premises/invariants，边属于 Destination-reaching 路线。
2. **渐进披露**：先读 `context --layer focus`，执行本边时再读 `work`；只有 verifier 失败或需要判证/追责时读 `evidence/history`。完成条件：已读材料不超过 Brief 的文件数和字符预算。
3. **最小施工**：只执行当前边声明的工作和岗位输出，不预做后续边。完成条件：产物处于可回滚边界，非目标未进入改动。
4. **实际验证**：确认 verifier 已冻结程序、参数、cwd、超时、成功码和 proves。完成条件：每个 required conclusion 有可信验证来源。
5. **能力与证据**：执行 `issue-action`，再用一次性 token 调用 `verify-executed`；外部事实走 readback，子地图走 `verify-submap`。完成条件：pass 才应用 effects；reported、自报或失败结果不改变 Fact；能力已 consumed/revoked。
6. **运行分支**：外部等待用 `wait`，已知阻塞用 `block`，恢复用 `resume`，放弃本次尝试用 `cancel`；失败按 Brief 的 replan/branch/stop。完成条件：生命周期变化已追加事件，waiting/blocked 不占 active slot。
7. **出口判断**：再次运行 `next-actions`。若有多个 ready edges，全部交给人选择；若到达预检通过，创建 Arrival Audit Request、展示验收并结束本回合。完成条件：本轮以可信 Evidence、明确 proof gap、路线选择或 pending 审计问题结束。

对话、工具或岗位反馈先形成 Proposal；只有显式 `confirm` 才改变 Fact。本边证据只支持其绑定的 Predicate，不自动证明整项任务成功或最终价值。
