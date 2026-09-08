# Mapflow v0.5 空白建图基准测试

> 历史单案例说明：本页保留 v0.5 空白建图过程的设计依据，不再作为当前发布验收入口。持续回归请从 [产品体验验收矩阵](../../../benchmarks/README.md) 开始；端到端主线已改为图书管理系统，OrderPulse 只承担故障诊断专项。

这是一套可以交给新会话重复执行的基准测试。它验收的不是一张预先写好的图，而是：

> 从没有 Blueprint、Brief、正式 Fact、State 和 Event，只有两枚迷雾候选的仓库外 Sidecar 开始，经过真实勘探、目的地定形、人类确认、反向目标回归、正向可达性证明、执行和到达审计，逐步生成一张可解释、可验收的地图。

基准案例使用虚构的 `OrderPulse API` 项目：

> 修复订单查询偶发超时，并证明正常请求、超时重试和下游失败回退均符合预期后安全发布。

这个案例只是演示载体。Mapflow 的状态—工作边—证据模型同样适用于调研、写作、采购、会议、发布和运营。

## 1. 测试边界

### 必须从空白开始

测试起点必须同时满足：

- 目标工作区是一个新鲜的 Git 项目，或一个明确授权的真实项目；
- Mapflow 已启用，sidecar 中只有初始 `wayfinding.yaml` 和空 `briefs/` 目录，没有正式的 `blueprint.yaml`、Brief 文件、`state.json` 和 `events.jsonl`；
- 在勘探尚未开始时，看板显示两个无连线的迷雾候选，同时明确正式拓扑为 `0 个节点 · 0 条边`；
- 不复制 [完成态参考地图](../../../examples/order-query-timeout/blueprint.yaml)；
- 不把对话中的推断、看板上的显示或 Agent 的计划直接当成正式 Fact。

`examples/order-query-timeout-starter/` 只提供空白案例说明和项目初始化提示；它不是地图。完成态示例只能在最后用于对照投影和证据形状。

### 真相和投影

测试期间始终遵守以下边界：

| 对象 | 作用 | 是否能单独改变真相 |
| --- | --- | --- |
| 目标项目 Git、文档、会议记录、命令输出、外部回执 | 产生实现凭据或 Evidence | 能作为来源，但必须被记录和回读 |
| Workspace Sidecar `blueprint.yaml` | 保存人确认的定义 | 候选链闭合后首次用 `init` 登记；后续明确修改用 `replan` 登记 |
| `events.jsonl` / `state.json` | 保存运行事件和可重建投影 | 由 runtime 追加和重建 |
| 动态 HTML/Cytoscape 看板 | 阅读、筛选、展开、收缩、刷新 | 不能确认 Fact、批准边或登记 Evidence |

逻辑可达不等于实际到达。没有实际检查和 Evidence Record 时，不得宣称目标已经完成。

## 2. 涉及的文档

新会话开始前，先阅读这些文档；它们分别回答“怎么做”“对象是什么”“当前项目有什么事实”。

| 文档 | 时机 | 作用 |
| --- | --- | --- |
| 目标项目的 `AGENTS.md`、`README.md`、架构/运行说明 | 勘探 | 了解项目边界、命令、责任人和已有证据 |
| [docs/workflow.md](../../workflow.md) | 全程 | Mapflow 行为唯一真源：阶段、确认门、证明、执行和到达审计 |
| [docs/blueprint/map-model.md](../../blueprint/map-model.md) | 建图前 | Blueprint、四值 Fact、State Node、Work Edge 和证据合同 |
| [CONTEXT.md](../../../CONTEXT.md) | 遇到术语时 | Fact、Fog Node、Decision Node、Proof Gap、Map Projection 等定义 |
| [templates/blueprint.yaml](../../../templates/blueprint.yaml) | 候选链闭合后 | 可选的 Blueprint 字段起点；必须按当前项目重写，不能当成完成地图 |
| [templates/task-brief.md](../../../templates/task-brief.md) | 每条边施工前 | 固化该 Work Edge 的范围、非目标、授权、出口和失败边界 |
| 本文档 | 新会话执行 | 基准测试步骤、证据清单和通过标准 |

测试运行时在 Workspace Sidecar 中逐步产生：

```text
workspace.json       工作区身份和仓库外路径
current/blueprint.yaml   人确认的正式地图定义
current/wayfinding.yaml  勘探阶段的始发候选、问题目标和候选边
current/briefs/*.md      每条正式 Work Edge 的独立 Task Brief
current/events.jsonl     追加事件真源
current/state.json       可由事件重建的运行投影
```

现场勘探笔记、决策记录、验收报告和外部回执可以放在 sidecar 的辅助目录，或引用目标项目/外部系统中的权威位置；它们不是自动生效的 Fact。

## 3. 准备空白工作区

下面的 PowerShell 创建一个与 Mapflow 仓库无关的临时 Git 项目。真实项目测试时，可把 `$demoRoot` 替换为项目根目录，但必须确认你有权限读取其 Git 状态并在需要时执行验证命令。

```powershell
$runtime = "tools/mapflow.mjs" # 在 mapflow 仓库执行；实际项目改为用户级 runtime 的绝对路径
$demoRoot = Join-Path $env:TEMP ("orderpulse-api-baseline-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force $demoRoot | Out-Null
git -C $demoRoot init
"# OrderPulse API`n`n这是一个用于 Mapflow 基准测试的最小项目。" | Set-Content (Join-Path $demoRoot "README.md")
git -C $demoRoot add README.md
git -C $demoRoot -c user.name="Mapflow Demo" -c user.email="mapflow-demo@example.invalid" commit --quiet -m "initialize OrderPulse baseline project"

$enabled = node $runtime enable --root $demoRoot --json | ConvertFrom-Json
$enabled.paths
node $runtime board --root $demoRoot --port 4185
```

打开 `http://127.0.0.1:4185`，记录第一次截图或人工观察作为起始证据。此时不能执行 `init`，因为还没有 Blueprint；看板应显示两枚无连线迷雾候选和唯一始发勘探问题。

### 起始验收

通过以下检查才进入下一阶段：

1. `enable` 报告的 `sidecar` 不在 `$demoRoot` 内。
2. `$demoRoot` 的 `git status --short` 没有被 Mapflow 写入的文件。
3. 看板正式节点/边为零，草稿候选为两个；Intent 未收敛，Destination 仍是迷雾。
4. `examples/order-query-timeout/` 没有被复制到 sidecar。

## 4. 阶段一：现场信息勘探

这一阶段只回答“当前在哪里”，不回答“应该怎么改”。让新会话读取目标项目的约定、目录、入口代码、Git 分支和可用运行证据，并将每项事实分为：

- `true`：有可引用证据支持；
- `false`：有证据否定；
- `unknown`：尚未确认，形成迷雾；
- `conflict`：证据互相矛盾。

推荐对新会话说：

> 启用 mapflow。现在只做现场信息勘探，不创建 Blueprint。请读取当前 OrderPulse 工作区的项目约定、Git 状态、订单查询入口和已有超时证据，输出带来源的起始事实、未知项、冲突项和会改变目的地的开放问题；等我确认后再进入目的地定形。

勘探结果至少应记录：

- 仓库/工作区确实存在，以及当前分支或 tag；
- 订单查询入口和可执行的本地检查；
- 超时样本、日志、指标或复现条件；
- 当前没有证明的事实，例如“根因已知”“重试契约已确认”“发布已授权”；
- 不应被本次工作影响的范围。

此时不要凭空添加正式节点或 `origin → destination` 直连边。回答初始始发问题后，应更新 sidecar 的 `wayfinding.yaml`，用现场事实替换通用起点，并把下一问题直接指向 `destination`；两枚节点仍是虚线候选，不计入正式拓扑。

## 5. 阶段二：把 Intent 收敛为 Destination

通过 grilling 或真实讨论，确认下面四类内容：

1. 最终必须成立的目标 Predicate，例如 `normal-query-healthy`、`timeout-retry-correct`、`fallback-safe`、`production-observed`。
2. 每个 Predicate 的可回读验收证据，例如正常请求矩阵、超时重试回读、持续失败回退回读和发布后只读观察。
3. 全程不允许破坏的不变量，例如读取重试不能产生重复读取副作用。
4. 范围、非目标、时间/成本、授权人和不可逆外部动作。

Destination 只有在 Intent 为 `shaped` 且开放问题为空时才能批准。人类确认要明确回答：

```text
目的地：修复订单查询偶发超时，并证明正常、重试、回退和发布后观察均符合契约。
验收：每个目标 Predicate 都有 Evidence Contract。
非目标：不重写订单存储、不扩展无关接口、不用缓存掩盖根因。
授权：恢复契约由业务 Owner 确认，生产发布由值班 Owner 确认。
```

完成这次确认后仍停留在 Wayfinding 候选层，开始反向目标回归。此时不得在 `$enabled.paths.map` 创建第一版 Blueprint；只有候选里程碑和工作边逐项确认、整条候选链闭合后，才把它们连同独立 Task Brief 一次写成正式定义。

## 6. 阶段三：在候选层完成反向目标回归

`enable` 时两枚迷雾候选已经可见。目的地确认后，Wayfinding 草稿先把已确认语义继续保留为：

- 一个始发 Fog Node：仓库存在，但超时根因未知；
- 一个目的地候选节点：目标已定义，但所有目标 Predicate 仍未被实际观察；
- 两者之间暂时没有虚构的直连边；目的地确认问题直接绑定目的地节点。

节点是阶段性状态，不是 Git 的每个小改动。Git commit/tag 只能作为某个阶段的 `realization_ref` 或 Evidence；迷雾节点和尚未实施的节点不应伪造 Git 凭据。

此时正式 Blueprint、Task Brief、state 和 events 仍不存在，正式拓扑仍为 `0/0`。不运行 `validate`、`prove` 或 `init`；这些命令只在候选链闭合后执行。看板应在候选层显示反向回归正在建立的目标侧后缀、当前事实前缀和未接通的桥，而不能把候选冒充为正式节点。

## 7. 阶段四：人工参与的反向目标回归

从 Destination 向始发节点逐层反问：

> 哪一项独立工作能产生这个里程碑？执行它之前哪些 Predicate 必须已经成立？验收凭据是什么？如果失败，如何停止或回到哪一个最小子图？

对 OrderPulse，推荐逐步提出以下候选里程碑（名称不是强制 ID）：

```text
目的地：订单查询可靠性修复已安全发布
  ↑ 发布并回读生产观察
发布已获授权
  ↑ Owner 确认窗口与回滚方案
正常、重试、回退场景均通过
  ↑ 执行场景矩阵
修复实现完成并有可回滚版本
  ↑ 实现恢复契约
重试与失败回退契约已确认
  ↑ 复现超时并定位根因后，由人选择路线
超时路径已复现并定位
  ↑ 读取日志、运行复现和追踪
仓库存在，但超时原因未知
```

每次只提出当前最小候选集，等待人确认以下内容：

- 节点是否真的是独立、可观察的阶段性状态；
- 边的起点、终点和前置条件是否准确；
- 是否存在 AND 前置、真正的 OR 路线或 Decision Node；
- 边与边之间是否有隐藏耦合；若边 B 依赖边 A 的产出，必须插入中间 State Node；
- Task Brief 的范围、非目标、授权、出口条件、Evidence Contract 和失败分支；
- 该边是否涉及不可逆外部动作，以及谁有权批准。

反向推理产生的内容先放在 `wayfinding.yaml` 的待确认清单中，不进入正式拓扑。每个候选节点和工作边都要有独立问题、人的明确回答和 Evidence Ref；只有全部逐项确认且候选链闭合后，才生成独立 Task Brief 和第一版 Blueprint：

```powershell
node $runtime validate --root $demoRoot
node $runtime prove --root $demoRoot --json
node $runtime init --root $demoRoot
```

首次登记前必须由 `validate/prove` 证明结构完整且逻辑可达；`init` 只登记定义与初始运行投影，不批准路线、不激活工作边。后续正式地图发生局部变化时，才用精确的 `replan --scope ... --changes ...` 登记；实际 `--changes` 必须与 Blueprint 相对上一版本的变更引用完全一致。`replan` 不会覆盖已经验证的 Evidence，也不会替人批准候选节点。后文命令假设采用了上面的推荐语义 ID；若人确认时使用其他 ID，应同步替换命令参数。

## 8. 每条边的文档合同

正式地图中的每条 Work Edge 都必须有一个独立、语义化命名的 Task Brief，例如：

```text
current/briefs/reproduce-timeout.md
current/briefs/confirm-recovery-contract.md
current/briefs/implement-recovery.md
current/briefs/verify-query-matrix.md
current/briefs/authorize-release.md
current/briefs/release-and-observe.md
```

Brief 的 frontmatter `edge` 必须绑定 Blueprint 中的边 ID。正文至少写清：

- `from → to`、前置条件和预期效果；
- In scope / Out of scope；
- 责任人、允许写入、外部动作和授权；
- 可观察的出口条件与 Evidence 到 Predicate 的映射；
- 失败后的 `replan`、`branch` 或 `stop`，以及可回滚边界。

这保证同一节点发出的多条边只共享起始状态，不共享未声明的产出或执行顺序。

## 9. 阶段五：正向可达性证明和反例修图

每次确认一批节点/边后运行：

```powershell
node $runtime validate --root $demoRoot
node $runtime prove --root $demoRoot --json
node $runtime status --root $demoRoot
```

检查四类结果：

| 结果 | 含义 | 下一步 |
| --- | --- | --- |
| `structural: complete` | 引用、节点、边、Brief 和合同合法 | 继续看 reachability |
| `reachability: logical` | 当前起始 Fact 存在到达目的地的路线 | 可以进入批准门，但仍未实施 |
| `reachability: conditional` | 路线依赖 unknown、假设或授权 | 补探针、确认或保留条件 |
| `reachability: unreachable` | 当前模型没有完整路线 | 按 proof gap 只修最小子图 |

proof gap 必须结构化记录 `type`、`at_edge`、`missing`、`caused_by` 和 `repair_scope`。例如发现生产发布没有授权边时，只添加授权子图；不要重画已通过的复现和实现路径。修改后再次 `validate → replan → prove`。

只有位于 Destination-reaching 路线上的 `proven_edges` 才能进入批准路线，后续施工授权也只能指向其中当前 ready 的边。看板的“目标回归”镜头应同时显示：目标侧 Suffix Proof、当前事实 Prefix Reachability，以及两者之间的 Bridge Status。

## 10. 阶段六：批准、执行和验收

当 Intent、Destination、Brief 和 Proof 都满足停止条件后，Agent 先创建路线批准问题并展示证明，然后停止。人通过后续独立消息批准完整路线；候选结构确认不能复用为批准，批准时也不得同时选择或激活工作边：

```powershell
node $runtime request-route-approval --root $demoRoot --question "是否批准当前已证明的完整诊断路线？"
node $runtime approve --root $demoRoot --request <route-approval-request-id> --answer "确认按这条完整路线推进" --actor "human:owner"
```

Agent 再针对一条 ready/proven 边创建施工授权问题。人通过后续独立消息回答，才激活该边的一次 Run：

```powershell
node $runtime request-authorization --root $demoRoot --edge reproduce-timeout --question "是否授权执行工作边 reproduce-timeout？"
node $runtime authorize --root $demoRoot --request <authorization-request-id> --answer "批准执行该工作边" --actor "human:owner"
node $runtime gate --root $demoRoot
```

真实执行可能来自人、Agent、命令、文档、会议或外部系统。执行完成后用 `verify` 登记观察结果；CLI 记录证据和回读，不替你执行任意业务命令：

```powershell
node $runtime verify --root $demoRoot `
  --edge reproduce-timeout `
  --evidence "复现记录和追踪结果已保存" `
  --command "本地复现命令或测试报告" `
  --observed "超时路径可稳定复现，根因定位记录可回读" `
  --result pass `
  --proves incident-reproduced,timeout-cause-understood `
  --outcome-ref "document:notes/timeout-reproduction.md" `
  --executor "human:owner"
```

对本地虚构项目可以使用 `--simulated` 标记测试性质，但不得把模拟结果写成生产到达。失败时使用 `--result fail`，不要声明 effects；根据边的 `on_failure` 回到 `replan`、停止，或提出明确的备用边。备用边必须重新请求人工授权，不能自动启动。所有失败 Evidence 都保留。

看板此时应动态刷新事实、Edge Run、Evidence、Acceptance 和 stale 状态；刷新不是确认动作。Git tag 只在实现边完成并确有对应仓库凭据时出现。

## 11. 阶段七：到达审计

当所有必要边已通过且没有 active Edge Run，Agent 先预检并创建最终审计请求：

```powershell
node $runtime request-arrival-audit --root $demoRoot `
  --question "是否确认目标 Predicate、全部验收、非目标和遗留风险均已逐项审计？"
```

该命令应保持 `implementation / not-audited`，展示冻结的 Acceptance ID，并结束当前 Agent 回合。人在后续消息中明确回答这个请求后，才执行：

```powershell
node $runtime arrive --root $demoRoot `
  --request <arrival-audit-request-id> `
  --answer "确认目标、验收、非目标和遗留风险已逐项审计" `
  --actor "human:owner" `
  --non-goals "不重写订单存储,不修改无关接口" `
  --risks "生产观察窗口仍需持续关注"
```

`request-arrival-audit` 与 `arrive` 都必须检查：

1. 所有 Destination Predicate 已由实际 Fact 证明；
2. 每项 Acceptance 都能回指通过的 Edge Evidence；
3. 不变量和非目标边界仍成立；
4. 未验证项、外部动作和遗留风险已明确；
5. 若使用子地图，其 Map Receipt 的 Blueprint digest 和事件 revision 仍有效。

请求后的地图、Route Approval、Evidence、Acceptance 或 runtime revision 变化都会使它 stale；`replan` 也会显式失效请求。到达审计通过后，看板显示 `arrived`。这只证明本次地图的目标和合同，不自动证明产品价值、生产安全或用户满意度。

## 12. 可选：大目标和子地图

若“安全发布”本身过大，可以把发布前准备拆成独立 child map。父边只绑定 child map 的 `map_id`、digest、等待 `arrival` 的策略，以及 child Acceptance 到 parent effects 的映射。

测试时：

1. 在 child Sidecar 中重复本基准流程，从 child 的两个迷雾节点开始；
2. child 通过自己的 `arrive` 后，父图执行 `verify-submap`；
3. 父级接纳不可变 Map Receipt，再把父边视为通过；
4. 看板把收缩的 child 显示成带状态、Acceptance、receipt 和 stale 摘要的单个可解释节点，展开时原位读取子图；
5. child 之后发生漂移时，旧 receipt 变 stale，不能静默覆盖父级证据。

这只是分辨率扩展，不改变空白建图的人工确认和证据规则。

## 13. 基准测试通过标准

新会话完成后，必须能拿出以下证据：

- 起始截图或记录证明看板从两个无连线迷雾候选开始，且正式节点、正式边均为零；
- 勘探记录列出带来源的 true/false/unknown/conflict Fact；
- 人工确认的 Intent/Destination 和非目标、授权、不变量；
- 从两个迷雾节点逐步增加的正式节点和独立 Work Edge；
- 每条正式边对应的 Task Brief，以及精确的 `replan` 事件；
- 至少一次 `prove` 输出，包含结构完整性、可达性和 proof gap/修复过程；
- 至少一条通过和一条失败或阻塞分支的 Edge Run/Evidence 记录；
- 看板刷新前后状态、证据和 stale 行为的记录；
- `arrive` 的验收清单、风险和实际到达结论；
- 目标 Git 工作区没有被写入 Mapflow runtime 文件，sidecar 路径在仓库外。

收尾回报使用固定格式：

```text
完成：目的地是否实际达到
改动：新增/确认的 State Node、Work Edge、Brief 和产物
证明：结构、逻辑/条件可达性、Evidence Record 和到达审计
决策：本轮人类确认的路线取舍
遗留：proof gaps、未验证项、风险或下一张地图
```

## 14. 维护者验证

修改本基准文档或相关实现后，在仓库根目录执行：

```powershell
npm test
git diff --check
```

测试文档本身不能替代真实项目的命令、审查、部署、发布和业务验收；它只规定一条可重复、可追溯的 Mapflow 建模与验收路径。
