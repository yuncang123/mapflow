# v0.4 设计

## 领域裁决

保持 Blueprint/state schema 2 的向后兼容读取，使用可选字段扩展合同；包版本升级到 0.4.0。旧图缺少 `intent` 时仅作为“已定形的 legacy intent”读取，新的模板必须显式写 Intent。这样增加能力而不迫使已有个人地图重画。

运行真相链：

```text
Work Event -> Proposal -> confirmed/rejected
                         | confirmed
                         v
                       Map Fact -> State Node projection

Decision -> Edge Run -> Evidence / Map Receipt -> effects -> derived State
```

事件以 CloudEvents 风格 envelope 追加到 `.mapflow/events.jsonl`；每项包含连续 `seq`、前一事件摘要、当前 map digest 和去掉事件头的投影快照。state 是最近投影缓存；`rebuild` 校验 envelope、map identity、revision/hash chain 及 state/projection 等价后恢复它。完整 domain projection 留到事件中，避免为个人版引入事件数据库和复杂 reducer。

父图单向拥有 `submaps[]` binding。子图不知道父图。Receipt 绑定 child map ID/digest、state event revision、到达审计、Acceptance evidence、父 effect 映射和 actor；子图变化只使旧 receipt stale，不覆盖它。

## 运行状态机

```text
created -> active -> waiting -> active
                  -> blocked -> active | cancelled
                  -> passed
                  -> failed -> replan | branch(new run) | stopped
```

同一地图最多一个 active run；waiting/blocked 不伪装为 active，并释放 slot 供另一条独立边使用。`approve/select` 必须给出理由并产生 Decision Record。所有通过检查必须显式写 `--result pass`；Mapflow 不执行用户给出的任意命令，只登记观察和引用。

## 看板设计计划

- 主题：人的多分辨率工作地图，延续 field ledger / survey canvas 的测绘语言。
- 用户：维护一项跨对话、跨工具或跨领域工作的个人 Owner。
- 唯一主任务：先理解父图状态，再在不离开上下文的情况下展开一条复杂工作边。
- 字体：Bahnschrift/Segoe UI/Cascadia Mono；颜色继续以墨色、teal 证据、amber 活动、violet 迷雾、coral stale/失败编码。
- 签名交互：父边展开为 compound “地形框”；父边画线暂隐，以 projection-only portal edge 连接父 source、子图入口/出口和父 target。完整 binding path 允许在地形框中继续展开下一层。
- 交互边界：按钮具备 `aria-expanded`；列表、Inspector、画布选择同步；展开状态仅保存在浏览器会话。

```text
+ Route lens -------+ Survey canvas ----------------------+ Evidence ledger ----+
| parent route      | [parent state]                      | selected edge       |
| submaps           |      \                              | run / decision      |
| fog & stale       |   +-- submap terrain -----------+   | receipt / exports  |
| search            |   | entry -> work -> arrived    |   | [展开/收缩]        |
|                   |   +-----------------------------+   | freshness          |
+-------------------+-------------------------------------+---------------------+
```

桌面使用三栏；1180px 以下 Inspector 落到下一行；760px 以下纵向排列。reduced-motion 时取消路径流动和过渡，键盘仍可从列表展开子图。

## 验收矩阵

| 风险 | 可判断验收 |
| --- | --- |
| Intent 未收敛被开工 | draft/open questions 的图无法 approve |
| 模型推断污染事实 | propose 后 Fact 不变；confirm 后才更新 |
| 失败仍显示活动 | fail 后 run=failed、无 active run、执行 on_failure |
| 子图“逻辑可达”冒充完成 | child 未 arrived 时 verify-submap 失败 |
| Receipt 漂移 | child digest/state revision 改变后父边显示 stale |
| 展开改变真相 | 展开/收缩前后所有真相文件字节一致 |
| 事件链不可靠 | rebuild 成功；篡改/重复/截断失败 |
| state 被绕过事件手改 | event head 即使未变，只要 state 内容不等于最新 projection 也阻塞 |
| 等待工作占死地图 | waiting/blocked run 保留且释放 active slot，另一条独立边可启动 |
| 冷启动时 Brief 已漂移 | 看板从 state 冻结快照展示批准版 Brief，并标记 stale |
| 大任务递归拆图 | 语义 binding path 可逐层读取、展开、刷新和收缩 |
| 视觉可用性 | 桌面、窄屏、键盘、reduced-motion 浏览器检查通过 |
