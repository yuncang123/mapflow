# Mapflow 工作流

完整数据合同和推理规则见 [map-model.md](blueprint/map-model.md)。本文件是行为唯一真源；README 只导航，Skills 只路由当前动作。

## 1. 承诺与边界

Mapflow 为尚未拥有明确地图的目的地建模，适用于编码、调研、写作、采购、会议、发布和运营。它把人的意图、Agent 对话、工具输出和外部回执转成候选变化；只有被确认的 Fact、Blueprint 修改和实际 Evidence Record 才改变正式地图。

Mapflow 维护四层边界：

```text
Definition（Blueprint） → Run（active edge） → Evidence（observed facts） → Projection（看板/图）
```
Projection 可以动态刷新，但不反向宣布事实。逻辑可达只表示模型内存在路线，不表示现实已经到达。

## 2. 阶段与入口语句

```text
wayfinding      固定起始事实、目的地、反向闭包、正向证明和修图
implementation  执行已批准的一条 Work Edge，并以证据更新事实
arrived         目标 Predicate 和逐项验收已经完成实际审计
```

| 用户语句 | 行为 |
| --- | --- |
| `进入地图优先模式` | 建立或恢复 Blueprint，只勘探和证明 |
| `地图已批准，执行工作边 <edge>` | 批准目的地并激活一条 ready edge |
| `执行工作边 <edge>` | 只执行已批准地图中的指定边 |
| `发现偏差，重新规划` | 保留事实与证据，回到 wayfinding 并局部修图 |
| `进行到达审计` | 检查实际目标事实、验收证据、不变量和遗留风险 |

“继续”“开始做吧”“按计划来”不改变阶段。没有批准的 Destination、唯一 `active_edge` 和通过的 gate 时，不产生业务写入。

## 3. 五步建模循环

### 3.1 勘探起始状态

读取工作环境的权威来源，把起始地固定为 Fact 集。每项 Fact 只取：

- `true`：有证据支持；
- `false`：有证据否定；
- `unknown`：尚未确认，形成迷雾；
- `conflict`：证据相互矛盾。

`unknown` 既不是 `false`，也不能被模型补成 `true`。完成条件：会改变路线的事实均有值、来源，或拥有可执行探针与停止条件。

### 3.2 定形 Destination

Destination 包含目标 Predicate、适用不变量、范围/授权边界，以及 `acceptance → proves predicates` 映射。完成条件：每项目标 Predicate 至少被一项验收覆盖；成本、时间、外部动作和不可逆边界的所有者明确。

### 3.3 反向目标回归

从每个目标 Predicate 反问：什么独立 Work Edge 能产生它？执行前哪些 Predicate 必须成立？

- AND：使用包含多个 Predicate 的 State/Join Node；
- OR：使用多条替代 Work Edge；只有真实路线取舍才建立 Decision Node；
- 迷雾：建立 Fog Node 和 probe edge；
- 边 B 依赖边 A 的 effect：插入中间 State Node，禁止同源边隐藏耦合。

每条边必须关联语义化 Task Brief、preconditions、expected effects、invariants、certainty、Evidence Contract 和失败分支。完成条件：每个目标有产生边或已在起始事实成立，每个 effect 都被 required evidence 覆盖。

### 3.4 正向可达性证明

从实际起始 Fact 出发搜索可达的事实世界，逐边检查 source state、preconditions、授权/资源、不变量和 effects。每个世界中的同一 Fact 始终只有一个值；边的 effect 会在该世界中替换这个值，不会把相反 Predicate 累加成伪状态。多个生产边按 OR 处理，只要存在一条完整路线即可。搜索直到没有新的事实世界。使用：

```bash
node tools/mapflow.mjs prove --map path/to/blueprint.yaml
```

结论同时包含：

- `structural: complete/incomplete`；
- `reachability: logical/conditional/unreachable`；
- `candidate_edges`：反向目标回归得到的全部候选边；
- `proven_edges`：至少位于一条 Destination-reaching 事实世界路径上的边。

批准或选择只能指向 `proven_edges`。因此局部 ready、但最终通往死路的候选边不能进入实施。

运行投影另行报告 `actual_arrival: audited/not-audited`；它只能由到达审计改变，不能由逻辑推演推出。

使用 accepted assumption 或 `certainty: conditional` 的路线只能标为 `conditional`。Expected effect 只进入推演，不能更新运行 Fact。

### 3.5 反例驱动修图

证明失败时生成结构化 proof gap：`type`、`at_edge`、`missing`、`caused_by`、`repair_scope`。常见类型包括：

- `unproduced-goal`、`unsatisfied-precondition`；
- `blocking-fog`、`conflicting-fact`、`unsupported-assumption`；
- `hidden-edge-coupling`、`invariant-conflict`；
- `missing-authorization`、`missing-evidence-contract`；
- `incompatible-world-state`、`insufficient-edge-effect`；
- `loop-without-progress-contract`、`loop-progress-not-produced`、`loop-exit-not-produced`、`loop-budget-exhausted`。

不可达时只报告最接近 Destination 的最佳 OR 分支上的首个缺口；不会把已经走过但后来状态变化的边重新报成阻塞。只替换 `repair_scope` 指向的最小子图；Blueprint 修改后必须用 `replan --scope ... --changes ...` 接纳精确 diff，无修改也显式写 `--changes none`。后续 `prove/approve` 遇到未登记变化会阻塞。已到达地图不再刷新状态证明，需开启新地图。已验证 Fact 和 Evidence Record 只追加、不覆盖；已验证 Work Edge 的 source/target Node、引用 Predicate、适用 Invariant、所属 loop 和绑定 Brief 合同不得删除或重定义。修图后重新执行反向闭包与正向证明。

## 4. 地图可批准的停止条件

同时满足以下条件才允许进入 implementation：

1. 每个目标 Predicate 已在起始状态成立，或至少有一条产生边。
2. 每个 AND 前置均可达；OR 备选中至少存在一条完整路线，不可达的未选备选不拖垮可行路线。
3. 决策、迷雾、授权、外部依赖和假设均已显式化。
4. 同源边不存在隐藏产出依赖。
5. 每条边拥有独立 Task Brief、出口条件和 Evidence Contract。
6. 每项验收能追溯到目标 Predicate 和产生它的边。
7. 每个循环都有 progress predicate、exit predicate 和最大预算。
8. 剩余未知不阻塞首条路线；否则结论只能是 conditional。

批准语义是：“在当前事实、约束和显式假设下，该路线通过正向可达性证明。”它不是成功保证。

## 5. Work Edge 执行与证据

Blueprint 是定义，`.mapflow/state.json` 是运行投影。运行状态使用：

```text
active_edge       当前唯一允许执行的工作边
verified_edges    已由通过证据支持的历史边
facts             实际观察的四值事实
satisfied_nodes   每次从 facts 和 node predicates 派生
loop_iterations   每个 loop 已实际执行的循环边次数
```

实施顺序：

1. 用 `templates/task-brief.md` 固定当前边的执行面、非目标、授权和 Evidence Contract；`brief_ref` 必须指向以 Blueprint 文件为基准、真实存在且 frontmatter `edge` 正确绑定的独立相对文件。Task Brief 是批准时冻结的定义合同，实际执行记录写入 runtime Evidence Record，不回写 Brief。
2. 运行 `gate`，确认 Blueprint 与绑定 Task Brief 的联合 digest 未变化，source、preconditions 和 invariants 在实际事实中成立。
3. 只执行当前边；新事实改变路线时停止并 replan。
4. 运行真实检查，用 `verify --edge ... --proves ... --executor kind:identity` 留下 Evidence Record。人工、Agent、工具或外部系统都可作为 executor；Agent executor 另需成对记录 `--model` 与 `--reasoning`。
5. 只有 `pass` 且没有 `unverified` 限制时，才把已证明 Predicate 应用到 Fact，并重新派生 State Node。

Loop 中的每条边都必须产出 progress predicate；从循环节点出发还必须存在能产出 exit predicate 的退出边。每完成一条 loop edge，`loop_iterations` 增加一次；同一边可以在预算内重复选择，达到 `max_iterations` 后 gate 阻塞。正向证明使用同一预算语义，不能靠无限展开证明可达。

Git 只是 realization/evidence adapter 之一。编码工作可以引用 repository、commit 和 paths；非编码工作可以引用文档、会议记录、决策、日历或外部回执。

## 6. 到达审计

`arrive` 必须同时证明：

1. 所有 Destination Predicate 在实际 Fact 中成立；
2. 每项 acceptance 的全部 Predicate 可回指通过的 Work Edge Evidence Record；
3. 适用不变量未被破坏，非目标仍排除；
4. 剩余风险、未验证项和外部动作已明确回报。

到达只证明本地图的目标与验收，不自动证明产品价值、生产安全或发布效果。

## 7. 蓝图分辨率

- 小蓝图：一次对话内仍使用状态—边—证据语义，可以不落盘；但执行前必须在对话中复述 Destination、当前 Fact、唯一 active edge、readiness、授权和 Evidence Contract，并明确给出与 CLI `gate` 等价的“通过/阻塞”结论。无法完整复述时升级为任务蓝图。
- 任务蓝图：跨文件、跨工具或需要复用，保存 Blueprint 与当前 Task Brief。
- 路线地图：架构、迁移、安全、外部系统或跨会话工作，额外保存决策和 Checkpoint。

新证据扩大风险时向上升级分辨率；不能通过降级隐藏约束。多人协作、任务账本和团队门禁属于目标项目的协作流程，不是 Mapflow 默认依赖。

## 8. CLI 最小路径

```bash
node tools/mapflow.mjs validate --map path/to/blueprint.yaml
node tools/mapflow.mjs init --map path/to/blueprint.yaml
node tools/mapflow.mjs prove
node tools/mapflow.mjs approve --edge settle-audience
node tools/mapflow.mjs gate
node tools/mapflow.mjs verify --edge settle-audience --evidence "决策记录存在" --command "读取记录" --observed "读者已明确" --proves audience-known --outcome-ref "document:notes/audience-decision.md" --executor "human:owner"
node tools/mapflow.mjs select --edge write-candidate
node tools/mapflow.mjs replan --reason "新事实改变路线" --scope "subgraph:candidate-ready:article-live" --changes "edge:publish-article,node:article-live"
node tools/mapflow.mjs arrive --confirm "目标、验收、非目标和风险已审计" --acceptance public-page-readable,sensitive-review-recorded
```

看板只读取正式地图，不能代替上述命令确认事实或登记证据：

```bash
# 只查看 Blueprint 的定义态
node tools/mapflow.mjs board --map path/to/blueprint.yaml

# 查看绑定 Blueprint、Evidence 和历史的当前运行态
node tools/mapflow.mjs --state .mapflow/state.json board
```

服务只绑定 `127.0.0.1`，默认端口为 `4173`，可用 `--port` 修改。浏览器通过 ETag 轮询：同一拓扑的 Fact、edge、evidence 与 acceptance 变化只更新样式和检查器，节点或边的增删与重连才触发重新布图。当前文件无效、半写入或与运行态登记 digest 不一致时，看板保留最近有效或 state 中冻结的 Blueprint，并明确标记 `stale`，不能把错误内容显示成新事实。

安装到目标仓库后把 `node tools/mapflow.mjs` 换成 `node .mapflow/mapflow.mjs`。

## 9. 收尾回报

```text
完成：目的地是否实际达到
改动：状态、工作边和产物变化
证明：结构与可达性结论、实际验证命令和 Evidence Record
决策：本轮关键取舍；无则写“无”
遗留：proof gaps、未验证项或风险；无则写“无”
```
