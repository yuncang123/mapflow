# ADR 0003: 父级绑定子地图并验证到达回执

## Status

Accepted

## Context

大目标必须能递归拆解，但把子图节点直接复制进父图会产生双向真相、ID 冲突和无法判断的完成传播。

## Decision

父 Blueprint 单向拥有 Submap Binding；child 保持独立 Blueprint、state 和事件历史。父边 effects 只在 `verify-submap` 重新读取 child、确认 map digest、到达审计、Acceptance evidence 与 export mapping 后接纳。Receipt 是不可变快照；child 后续漂移只使它 stale。看板用 projection-only compound boundary 和 portal edge 表达层级，不写回正式地图。

## Consequences

- 大地图可以递归拆成可独立执行和验收的子地图。
- receipt 接纳后，child Blueprint digest 与 arrival state revision 成为本次 Work Episode 的不可变证据对象。漂移表示完整性损坏，支持的恢复只有还原被固定的 child 版本，或建立 successor parent map；不能在原父图中重绑已验证边并覆盖历史证明。
- `on_parent_close: invalidate` 不能让原地 replan 先作废一个已接纳 Receipt 再留下不可达父图；遇到这种情况 replan 在写入前拒绝，并要求 successor parent map。
- 本地路径是 realization adapter，不扩展为远程编排或云同步。
