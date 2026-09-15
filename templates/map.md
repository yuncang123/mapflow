---
map: semantic-map-name
status: draft
updated: YYYY-MM-DD
---

# Destination

- 目标 Predicate：
- 不变量：
- 验收及其证明对象：

# Initial state

| Fact | Value (`true/false/unknown/conflict`) | Evidence |
| --- | --- | --- |
| 待填写 | unknown | 无 |

# Continuity（仅后继航段）

- 前一 Arrival Checkpoint / receipt digest：
- 前一目的地节点（新 `origin_node`）：
- 导入 Predicate：
- 需要新 Evidence 的易漂移 Predicate：

# Backward regression

从每个目标 Predicate 反向记录能够产生它的独立 Work Edge，以及该边需要的前置 Predicate。AND 使用多 Predicate 的 State/Join Node；OR 使用多条替代边。

# Forward proof

- 结构：complete / incomplete
- 可达性：logical / conditional / unreachable
- Candidate edges（反向回归得到的候选集合）：
- Proven edges（至少位于一条抵达路线上的边）：
- 证明依赖的显式假设、迷雾或授权：

# Route

| From state | Work edge / Task Brief | To state | Preconditions | Effects | Evidence contract |
| --- | --- | --- | --- | --- | --- |
| 待填写 | `semantic-edge` / `briefs/semantic-edge.md` | 待填写 | 待填写 | 待填写 | 待填写 |

# Loops

| Loop | Edges | Progress predicate | Exit predicate | Max iterations | Runtime iterations |
| --- | --- | --- | --- | --- | --- |
| 无 | - | - | - | - | 0 |

# Proof gaps and repairs

记录 `type`、`at_edge`、`missing`、`caused_by` 和 `repair_scope`。修图保留已验证事实和 Evidence Record，只替换受影响子图。

# Arrival audit

- [ ] 每个目标 Predicate 在实际事实中成立
- [ ] 每项验收均能回指通过的 Work Edge 证据
- [ ] 不变量未被破坏
- [ ] 非目标保持排除
- [ ] 剩余风险和未知项已回报
- [ ] Arrival Checkpoint 已生成且 receipt digest 可校验
