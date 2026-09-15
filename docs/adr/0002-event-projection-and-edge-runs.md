# ADR 0002: 追加事件、Proposal 门与 Edge Run

## Status

Accepted

## Context

整体重写 state 无法区分一次边定义与多次执行，也无法证明对话或工具输入是否经过确认。失败、等待和恢复只能藏在 history 文本中。

## Decision

运行 occurrence 使用 CloudEvents 风格 envelope 追加到本地 JSONL，并以 hash chain、连续 seq 和 source/id 去重校验。state 是可重建投影。外部 Work Event 必须先产生 typed Proposal；只有 confirmed Proposal 导出的事实事件才能改变 Fact。每次 Work Edge 执行建立独立 Edge Run；同时最多一项 active。

## Consequences

- 可追溯、可重建，并能明确显示 waiting/blocked/failed/cancelled。
- 个人版事件携带完整投影快照，文件大于纯 reducer 事件，但避免引入数据库和迁移框架。
- `verify` 只登记调用方报告，不改变 Fact；`verify-executed` 只运行 Edge Run 开始前冻结的 verifier，并以实际退出码和输出摘要决定是否应用 effects。
