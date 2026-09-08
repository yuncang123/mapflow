# Mapflow v0.6.0 地图演化完整链路验收

> 结论：v0.6.0 已通过源码、确定性回归、安装分发和浏览器关键旅程验收，达到 `ready-for-personal-human-acceptance`。结论只覆盖 Mapflow 产品链路，不把确定性演示当成真实项目交付、真实人工接受或 GitHub Release。

## 本轮交付

- 新 Sidecar 先记录真实空白帧，再记录始发地与目的地两枚迷雾候选；正式节点/边仍为 `0/0`。
- `wayfinding-answer` 与语义变化的 `wayfinding-write` 追加带 actor、目标、原因、来源、规范快照和哈希链的 `wayfinding-events.jsonl`。
- 首个 runtime event 通过 digest bridge 固定 Wayfinding head；后续沿既有 runtime event snapshots 回放路线批准、逐边授权、Evidence、修图和到达审计。
- 看板提供第一帧、上一帧、播放/暂停、下一帧、0.5×/1×/2×、原生时间轴和回到实时；历史态只读，实时更新不会抢走历史视图。
- 每帧显示 actor、目标、原因，以及节点、边、Fact、Evidence、Acceptance 的语义变化；新增或变化对象在 Cytoscape 图上高亮。
- 旧 Sidecar 明确标记 partial coverage；日志、hash chain、stream identity、genesis、bridge 或当前草稿漂移时 fail closed。
- `board --map` 保持纯定义态，不会误读同目录的 runtime journal；父历史帧不会混入子地图当前态。

## 确定性证据

| 检查 | 结果 |
| --- | --- |
| `node --test tests/test_evolution.mjs` | 10/10 PASS |
| `npm test` | 110/110 PASS |
| `npm run test:regression` | Oracle + Runtime，110/110 PASS |
| `npm run benchmark:doctor` | 7/7 case packages + impact map PASS |
| `git diff --check` | PASS |
| 全局安装 dry-run | 24 个分发项完整 |
| 全局覆盖安装 | `0.6.0 (core)` |
| 安装内容核对 | 60/60；57 个字节一致，3 个路径改写与安装器合同一致 |

`test:regression` 未运行 Agent segments、完整陌生项目旅程或完整 Release 矩阵。

## 全局安装版浏览器验收

从 `C:\Users\chaoyuan12\.agents\skills\mapflow\runtime\evolution-demo.mjs` 启动真实 CLI 演示，得到 32 个可信帧。浏览器逐项观察：

1. 第 1 帧为“启用 Mapflow；此时尚无地图”，正式节点/边 `0/0`。
2. 第 2 帧出现横向分离、无连接的始发地和目的地迷雾候选；当前问题明确绑定始发节点。
3. 回归帧显示已确认目的地、目标侧后缀证明、当前事实前缀、未闭合桥，以及逐个节点/边的人工确认记录。
4. 播放后帧号前进，暂停后停止；时间轴可以跳转；历史态持续标识“只读”。
5. 回到实时后显示结构完整、逻辑可达、3/3 工作边已验证、2/2 Acceptance 通过、到达审计完成。
6. 浏览器控制台没有错误。

当前验收入口：`http://127.0.0.1:4197/`。它来自临时演示 Sidecar，服务停止后可随时重新运行 `npm run demo:evolution` 生成新实例。

## 关键边界

- 历史镜头是已记录 snapshot 的 as-of 只读投影，不是 undo，不成为执行依据。
- 语义 ID 决定候选到正式对象的连续性，不按文本相似度猜测身份。
- Wayfinding 与 runtime 是两条独立真相流，只由首个 runtime event 的 digest bridge 串联。
- 父子地图保留独立事件流；没有 receipt revision pin 时，不按墙上时间伪造全局顺序。
- 确定性 fixture 只证明 Mapflow 产品链路；真实项目成功、长期使用、无障碍和超大地图体验仍需人的实际试用。

## 发布状态

- 用户级 `0.6.0` 已覆盖安装并可直接使用。
- 当前源码改动和本验收证据尚未推送、打 tag 或创建 GitHub Release。
