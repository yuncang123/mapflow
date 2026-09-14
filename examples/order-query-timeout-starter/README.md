# OrderPulse 空白起点演示

这是 Mapflow 的真实建图起点，不包含预先生成的地图。这个目录故意没有 `blueprint.yaml`、`briefs/`、`state.json` 或 `events.jsonl`；它只保留本说明，便于把后续地图生成过程完整演示出来。

## 启动一个真实的空工作区

下面的 PowerShell 会在临时目录创建一个独立的 Git 项目，并让 Mapflow 在项目外建立空 Sidecar：

```powershell
$demoRoot = Join-Path $env:TEMP ("orderpulse-api-live-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force $demoRoot | Out-Null
git -C $demoRoot init
"# OrderPulse API`n`n这里暂时只有项目入口，问题和目标都交给 Mapflow 勘探。" | Set-Content (Join-Path $demoRoot "README.md")
git -C $demoRoot add README.md
git -C $demoRoot -c user.name="Mapflow Demo" -c user.email="mapflow-demo@example.invalid" commit --quiet -m "initialize OrderPulse demo project"

$workspace = node tools/mapflow.mjs enable --root $demoRoot --json | ConvertFrom-Json
node tools/mapflow.mjs board --root $demoRoot --port 4185
```

打开 `http://127.0.0.1:4185`。此时应看到：

- 横向分离且没有连线的“始发地仍在迷雾中”和“目的地仍在迷雾中”；
- `0 个正式节点 · 0 条正式工作边`，同时有 `2 个待确认节点`；
- 唯一问题明确指向始发候选，要求固定四值事实和来源；
- 看板仍然只读，两枚候选不属于 Blueprint，不能批准或执行。

## 按真实使用过程建图

不要把完成态 Blueprint 复制进这个工作区。接下来每次只推进一个确认门：

1. **勘探**：让 Agent 读取项目自身约定、Git 状态、入口代码和可用运行证据，只记录起始 Fact；不要先猜目的地。
2. **目的地定形**：通过 grilling 确认“修复订单查询偶发超时”究竟要达到什么可观察结果，补齐非目标、授权、不变量和验收证据。
3. **确认目的地**：人确认完整 Destination Contract 后，仍留在 Wayfinding 候选层，不立即创建 Blueprint。
4. **反向目标回归**：从目的地逐层提出“哪条独立工作边能产生这个里程碑”，每次只提出候选节点和边。
5. **整体审阅候选链**：一次展示节点语义、边顺序、因果规则、Brief、验收、非目标和授权；吸收人的整体反馈，但不建立逐对象审批门。候选链闭合前正式拓扑始终为零。
6. **正式登记与证明**：完整候选链审阅并闭合后，才一次生成独立 Task Brief 和 Blueprint；先 `validate/prove`，空白 Sidecar 用 `init` 首次登记。若证明失败，只修复对应 proof gap 子图；已有正式地图的局部修订才用 `replan`。
7. **实施与验收**：批准一条 ready/proven Work Edge，执行真实检查并登记 Evidence；Git tag 只作为阶段实现凭据，不把 commit 画成节点。
8. **继续刷新**：每次事实、证据、Edge Run 或 Blueprint 变化，看板通过轮询自动刷新；只有正式拓扑变化才重新布图。

推荐的第一次对话开场白：

> 启用 mapflow。先只做现场信息勘探，不创建 Blueprint。请把当前 OrderPulse 工作区的起始事实、证据来源、未知项和可能影响目的地的开放问题列出来，等我确认后再进入目的地定形。

## 完成态参考

当你完成上面的真实流程后，最终形态可以对照 [OrderPulse 完成态参考](../order-query-timeout/README.md)。参考地图用于验收投影和证明结果，不是本演示的起点，也不应复制到空工作区跳过人工确认。
