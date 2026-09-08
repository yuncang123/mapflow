# 起始事实勘探

- Blueprint schema 2 已能表达四值 Fact、Predicate、State Node、Work Edge、Evidence Contract、循环和失败声明，但没有 Intent 与子地图绑定。
- runtime state schema 2 只有 `active_edge`；失败检查仍保留活动边，`on_failure` 没有运行语义。
- `approve/select` 仅记录 edge ID，没有 Decision rationale。
- `verify` 的检查由操作者提供，旧实现默认 `pass`；失败仍先要求声明全部 effects。
- history 与 state 一起重写，不能把 state 当可删除投影，也不能检测事件截断或重复。
- BoardModel 和 HTTP 服务一次只读取一张图；前端没有 compound node、按需子图或展开控制。
- 现有看板已具备只读、ETag、最近有效快照、CSP、搜索、镜头和 Inspector，可直接扩展。
- 当前安装器可隔离安装 runtime 和 Skills；用户全局目录仍可能是旧版本，本轮不直接覆盖。

更完整的生态检索和复用裁决见 [Prior Art](../../research/mapflow-v0-4-prior-art.md)。
