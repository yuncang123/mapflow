# Mapflow v0.4 完整个人版

## Destination

把 Mapflow 从“单张定义图 + 单一活动边”推进为可长期用于真实工作的个人本地工作地图：模糊 Intent 能收敛，工作事件先形成 Proposal，Work Edge 拥有可恢复的运行实例，大目标可委托给独立子地图，父图只在验证子图到达回执后接纳效果，人能在只读 Cytoscape 看板原位展开和收缩子地图。

## 必须成立

- Intent 已持久化；只有 `shaped` 且无开放问题时，Destination 才能批准。
- 外部对话、工具和人工观察只创建 Proposal；确认 Proposal 后才改变 Fact。
- 每次 Work Edge 执行都是独立 Edge Run，明确记录 active、waiting、blocked、passed、failed、cancelled。
- 失败检查不应用 expected effects，并实际触发 `replan`、`branch` 或 `stop`。
- 父边只接受已到达子地图的、绑定 digest 和 Acceptance 的 Map Receipt。
- 看板按需读取子地图，在父边位置展开；展开状态不写入 Blueprint、state 或 events。
- `.mapflow/events.jsonl` 追加保存运行事件，`.mapflow/state.json` 可由事件重建。
- v0.3 Blueprint 和 state 可读取；v0.4 安装到隔离项目后仍能离线运行。

## 不变量

- Projection 始终只读，不能反向宣布 Fact 或验收通过。
- expected effect 不等于 observed fact；逻辑可达不等于实际到达。
- 已有 Evidence、Receipt 和事件只追加，不因 stale 或 replan 被覆盖。
- 不自动执行真实外部写入，不增加云同步、多人权限或第三方平台依赖。

## 到达证据

1. `npm test` 全部通过。
2. 示例父图和子图通过 validate/prove/运行/receipt/arrive 路径。
3. 事件日志可重放，重复、截断和篡改可检测。
4. 看板在真实浏览器完成展开、收缩、刷新、stale、窄屏、键盘与 reduced-motion 验收。
5. 隔离安装产物版本、schema、Skills、CLI 和看板一致。

当前仓库内验收结果与明确未证明项见 [acceptance.md](acceptance.md)。

## 工作边

- [固化 v0.4 合同](briefs/define-v0-4-contracts.md)
- [实现事件与运行生命周期](briefs/build-event-runtime.md)
- [实现父子地图回执](briefs/build-submap-receipts.md)
- [实现多分辨率看板](briefs/build-multiresolution-board.md)
- [完成分发与验收](briefs/verify-complete-distribution.md)
