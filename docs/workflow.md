# Mapflow 工作流

完整数据合同和推理规则见 [map-model.md](blueprint/map-model.md)。本文件是行为唯一真源；README 只导航，Skills 只路由当前动作。

## 1. 承诺与边界

Mapflow 为尚未拥有明确地图的目的地建模，适用于编码、调研、写作、采购、会议、发布和运营。它把人的意图、Agent 对话、工具输出和外部回执转成候选变化；只有被确认的 Fact、Blueprint 修改和实际 Evidence Record 才改变正式地图。

Mapflow 维护五层边界：

```text
Definition（Blueprint） → Event（append-only） → Run/Evidence → Fact → Projection（state/看板）
```
Workspace Sidecar 内的 `events.jsonl` 是运行事件真相，`state.json` 是可重建的当前投影。Projection 可以动态刷新，但不反向宣布事实。逻辑可达只表示模型内存在路线，不表示现实已经到达。

Mapflow 采用两层所有权：用户级安装包拥有入口 Skill、runtime、看板、模板和引用文档；每个本地工作区拥有一个由 Workspace Identity 绑定的仓库外 sidecar，其中保存当前 Blueprint、Brief、events 和 state。Git worktree 以 canonical worktree root 区分，普通目录以自身路径区分；remote URL 和共享 Git common dir 不参与身份，避免 fork 或多个 worktree 串图。Mapflow 可以读取目标工作区并把 Git 状态作为 realization/evidence，但不得把自身文件写入目标工作区或加入其 Git。

用户级入口只需 bootstrap 安装一次。此后用户明确说“启用 mapflow”时，入口第一步必须执行幂等 `enable --root <当前工作目录> --json`：不存在则建立 sidecar，并在尚无 Blueprint/State/Wayfinding 时创建包含“始发地仍在迷雾中”“目的地仍在迷雾中”和一个始发勘探问题的初始 `wayfinding.yaml`；已存在则恢复同一路径且不覆盖任何草稿。两枚迷雾节点是仓库外候选真相，不是占位 Blueprint，不计入正式拓扑，也不表示存在连接路径。`enable` 不把遗留 `.mapflow` 自动迁移成新真相。默认 state home 遵循本机用户状态目录，`MAPFLOW_HOME` 仅接受位于工作区之外的绝对路径覆盖；解析结果落入工作区时必须拒绝。

## 2. 阶段与入口语句

```text
wayfinding      固定起始事实、目的地、反向闭包、正向证明和修图
implementation  执行已批准的一条 Work Edge，并以证据更新事实
arrived         目标 Predicate 和逐项验收已经完成实际审计
```

| 用户语句 | 行为 |
| --- | --- |
| `启用 mapflow` / `进入地图优先模式` | 自动创建或恢复仓库外 sidecar；没有 Blueprint 时先显示两枚迷雾候选，从始发事实勘探开始 |
| `我确认按这条完整路线推进` | 回答证明完成后新建的路线批准问题；登记 Route Approval，但不激活工作边 |
| `我批准你刚才请求的工作边 <edge>` | 回答路线批准后新建的施工授权问题，并只激活该边的一次 Run |
| `发现偏差，重新规划` | 保留事实与证据，回到 wayfinding 并局部修图 |
| `记录候选事实 <proposal>` | 把对话、工具或观察写成待确认 Proposal，不改变 Fact |
| `确认候选事实 <proposal>` | 通过唯一确认门接纳 Fact，并重新派生地图 |
| `等待/阻塞/恢复/取消工作边` | 改变本次 Edge Run，而不改写 Work Edge 定义 |
| `验收子地图 <edge>` | 回读 child arrival、Acceptance 和 digest，生成父级 Map Receipt |
| `进行到达审计` | 预检实际目标事实与验收证据，创建 Arrival Audit Request 并停止；后续人工回答才登记到达 |

“继续”“开始做吧”“按计划来”不改变阶段。没有批准的 Destination、绑定当前路线的新鲜人工施工授权、唯一 `active_edge` 和通过的 gate 时，不产生业务写入。

## 3. 五步建模循环

### 3.1 勘探起始状态

读取工作环境的权威来源，把起始地固定为 Fact 集。每项 Fact 只取：

- `true`：有证据支持；
- `false`：有证据否定；
- `unknown`：尚未确认，形成迷雾；
- `conflict`：证据相互矛盾。

`unknown` 既不是 `false`，也不能被模型补成 `true`。完成条件：会改变路线的事实均有值、来源，或拥有可执行探针与停止条件。

`enable` 已在 sidecar 写入人可读的 `current/wayfinding.yaml` 初始草稿，先把始发和目的地都明确显示为迷雾，并把唯一问题绑定到始发候选。勘探获得第一组可引用事实后，用现场语义和四值证据替换通用始发候选，再创建指向目的地的下一问题。完整草稿通过 `wayfinding-write --draft-file <candidate>` 校验并原子生成规范 YAML；人的回答通过 `wayfinding-answer` 留痕。直接字符串拼接或局部替换 YAML 不能作为默认写入路径。草稿至少包含始发候选节点及四值事实、当前 Intent、`destination.requires/invariants/acceptance`、`boundaries` 和每个开放问题的建模目标。它不是 Blueprint、不会改变正式 Fact，也不允许批准或执行工作边；但看板会用独立的虚线候选层投影它，让人能看到“当前在哪里”“要去哪里”和“这个问题准备建立什么”。

每个收敛问题都必须声明：`target.kind`（`node`、`edge`、`predicate` 或 `destination`）、`target.id`、可读的 `target.label` 和 `target.purpose`，并列出 `answer_updates`（答案影响的草稿字段）。提问前先说明本轮要收敛的对象、缺失的条件和回答后的处理字段；回答后至少更新问题状态、答案和证据引用。`wayfinding-answer` 只自动推进问题游标并清除明确引用的开放问题，不会凭自由文本自动确认 Intent、Fact、节点或边；其余 `answer_updates` 必须由人或 Agent 按答案重新编辑并确认。没有建模目标的问题只能留在普通讨论中，不能推进地图。

`wayfinding.yaml` 同时最多只能有一个 `pending` 问题；未写 `status` 的问题也视为 `pending`。未来可能需要确认的节点和边只留在 `nodes`、`edges` 候选清单及其 `question_refs` 规划中，不能提前建立多个待答问题。当前问题收到人的回答、通过 `wayfinding-answer` 留痕并更新受影响草稿后，才创建下一个 `pending` 问题。历史 `answered`、`confirmed`、`rejected` 或 `deferred` 问题保留用于解释建图过程。该门槛防止看板只展示一个焦点、真相中却暗藏多个待决对象。

### 3.2 从 Intent 定形 Destination

先把模糊诉求保存为 Intent，记录 statement、`draft/shaped` 和开放问题。Grilling、调研或讨论只能把候选结论带回 Intent；只有取舍已收敛、开放问题不再改变路线时才标为 `shaped`。Destination 包含目标 Predicate、适用不变量、范围/授权边界，以及 `acceptance → proves predicates` 映射。完成条件：Intent 已 shaped 且没有开放问题；每项目标 Predicate至少被一项验收覆盖；成本、时间、外部动作和不可逆边界的所有者明确。未收敛 Intent 可以 validate/prove，但不能 approve。

首轮启用消息以及其中附带的详细需求只能作为定形输入，不能确认一个当时尚未展示的 Mapflow 候选对象。无论需求多完整，Mapflow 都要先展示 Destination Contract，再等待一条后续、独立、明确引用该候选合同的人工确认消息。确认前必须保持 `intent.status: draft` 与 `destination.status: pending`，不得进入反向回归，不得创建正式 Blueprint、Task Brief 或业务实现。模型自己判断“信息足够”，以及用户只说“继续”“开始做吧”“按计划来”，均不能越过此门。

有效确认要通过一个指向 `destination` 的 wayfinding question 留痕，保存人的原话和会话来源 Evidence Ref。人只补充事实、约束或修改意见时，本轮只能修订候选并重新展示完整合同，再建立新的确认问题；修改候选的消息不能同时确认尚未展示的修订版。`wayfinding-write` 从 pending 升级到 confirmed 时，会要求 canonical 草稿中已经存在由 `wayfinding-answer` 留下的、带来源且包含明确确认语义的回答，纯事实补充会 fail closed。这个记录证明的是“谁在何处确认了哪个候选合同”，不是目标已经实现；后续每个回归节点、工作边和整条正式路线仍分别等待人确认。

### 3.3 反向目标回归

从每个目标 Predicate 反问：什么独立 Work Edge 能产生它？执行前哪些 Predicate 必须成立？

- AND：使用包含多个 Predicate 的 State/Join Node；
- OR：使用多条替代 Work Edge；只有真实路线取舍才建立 Decision Node；
- 迷雾：建立 Fog Node 和 probe edge；
- 边 B 依赖边 A 的 effect：插入中间 State Node，禁止同源边隐藏耦合。

每条边必须关联语义化 Task Brief、preconditions、expected effects、invariants、certainty、Evidence Contract 和失败分支。完成条件：每个目标有产生边或已在起始事实成立，每个 effect 都被 required evidence 覆盖。

目的地尚未确认时，始发 Fog Node 和目的地 Fog Node 只作为两个候选状态显示，不能创建任何候选工作边，更不能创建 `origin → destination` 的虚构直连边。首次问题指向始发候选以固定现场；完成起始勘探后，收敛问题再直接指向 `destination`。反向回归的每个里程碑和工作边都先是候选，必须由人确认其语义、顺序、范围、非目标、授权和验收合同。`wayfinding-write` 只有在当前草稿已存在指向该对象、带来源且含明确确认语义的 `wayfinding-answer` 记录时，才允许把节点或边升级为 `confirmed`；候选文件不能自造确认。进入 `regression` 后，看板会把候选链从目的地向始发地反向投影：紫色箭头表示推理方向，节点的 `suffix_proof` 与 `prefix_reachability` 分开显示，未接通的桥不会被渲染成已到达。候选链闭合且逐项确认后才生成独立 Task Brief 与 Blueprint；先执行 `validate/prove`，空白 Sidecar 用 `init` 首次登记，已有正式地图的受影响子图才用带精确 change set 的 `replan`。看板不得把模型自动推演或对话中的候选直接画成正式节点。未确认候选可作为 `regression_proposals` 留在 sidecar 的待确认清单中，但不改变 Fact、Evidence、Proof 或拓扑。

回归确认按单个节点或单条边串行推进：先将完整候选链作为 proposal 投影，再只为当前最靠近已确认后缀的一个候选创建 `pending` 问题。人的回答可以确认、修订、拒绝或延后该对象；草稿据此更新后才移动到下一个候选。不得用一个问题捆绑多个节点或多条边，也不得在只展示一个问题时预先登记其余对象的问题。

### 3.4 正向可达性证明

从实际起始 Fact 出发搜索可达的事实世界，逐边检查 source state、preconditions、授权/资源、不变量和 effects。每个世界中的同一 Fact 始终只有一个值；边的 effect 会在该世界中替换这个值，不会把相反 Predicate 累加成伪状态。多个生产边按 OR 处理，只要存在一条完整路线即可。搜索直到没有新的事实世界。使用：

```bash
node <runtime> prove --map path/to/blueprint.yaml
```

结论同时包含：

- `structural: complete/incomplete`；
- `reachability: logical/conditional/unreachable`；
- `candidate_edges`：反向目标回归得到的全部候选边；
- `proven_edges`：至少位于一条 Destination-reaching 事实世界路径上的边。

完整路线通过证明后，Agent 必须先用 `request-route-approval` 创建 pending 问题并展示证明结论，然后停止。只有后续独立人工回答才能用 `approve` 登记 Route Approval；候选节点/边确认不能被复用为路线批准。路线批准不选择或激活工作边；后续施工授权请求只能指向 `proven_edges` 中当前 ready 的边。因此局部 ready、但最终通往死路的候选边不能进入实施。

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

批准语义是：“在当前事实、约束和显式假设下，该路线通过正向可达性证明。”它不是成功保证，也不是任一工作边的施工许可。批准完成时 `active_edge`、`active_run`、Edge Run 和 Decision Record 都为空；代码或业务产物仍未变化。

## 5. Proposal、Edge Run 与证据

### 5.1 流式输入的确认门

对话、Agent 输出、工具发现、会议或外部消息先形成 Work Event，再创建 typed Proposal。`propose` 只追加事件和待确认项；Fact 保持不变。`confirm` 要求 Proposal 仍基于最新 event revision，确认后才追加来源 Evidence Ref、更新 Fact 并重新派生 State Node。中间出现其他事件时 Proposal 变为 `stale`，必须重新提出；`reject` 只记录拒绝理由。

Evidence strength 使用 `asserted/observed/corroborated`，用于解释来源可信度，不把 unknown 自动提升为 true。规则自动确认必须显式记录 rule actor；模型推断默认只能提出 Proposal。

### 5.2 Edge Run 生命周期

Blueprint 是定义；一条 Work Edge 可以有多次 Edge Run。运行状态使用：

```text
active_run        当前唯一 active 的执行实例
edge_runs         每次执行尝试及 active/waiting/blocked/passed/failed/cancelled
route_approvals    完整路线批准的 digest、证明、reason、actor 和时间
route_approval_requests  正向证明后针对完整路线新建的问题、人的后续回答和状态
authorization_requests  路线批准后针对一条 ready edge 新建的问题、回答和状态
arrival_audit_requests  最终证据完成后针对整张地图新建的审计问题、冻结 revision、人的后续回答和状态
decisions         人批准本次施工后选择边的 alternatives、reason、actor 和授权请求
verified_edges    已由通过证据支持的历史边
facts             实际观察的四值事实
satisfied_nodes   每次从 facts 和 node predicates 派生
loop_iterations   每个 loop 已实际执行的循环边次数
```

`request-route-approval --question ...` 固定当前 Blueprint digest、正向证明和 `proven_edges`，只生成 pending Route Approval Request。三类人工门请求都保存 `decision_owner`；可用 `--decision-owner human:<identity>` 指定，个人工作区未指定时默认为 `human:owner`，看板将其显示为“你”。旧状态中的 pending 请求若缺少该字段，唯一下一步改为 `assign-decision-owner --request ... --decision-owner human:<identity>`；该命令只补登责任归属，不消费人工门。三类请求的批准、拒绝或审计回答都必须由同一 `decision_owner` 身份提交。路线批准请求必须在候选结构确认、正式入图和证明之后调用，并结束当前 Agent 回合。只有后续人工回答，才用 `approve --request ... --answer ... --actor human:<identity>` 把请求标为 granted、登记 Route Approval 并进入空闲 implementation；`decline-route-approval` 保存拒绝并留在 wayfinding。`approve` 拒绝缺少 pending request 的直接调用，也拒绝 `--edge`。

Agent 随后用 `request-authorization --edge ... --question ...` 建立一个新的 pending 施工请求，并把问题展示给人；该动作不生成 Decision 或 Run。只有收到后续人工回答，才用 `authorize --request ... --answer ... --actor human:<identity>` 把该请求标为 granted，同时生成 Decision Record 和 active Edge Run。同一请求只能回答一次，每条后续边和失败分支都需要新请求；`select` 不再是激活捷径。`decline-authorization` 保存拒绝而不启动工作。

`active_edge` 作为兼容投影保留，但 gate 以 active Edge Run 为准。waiting/blocked 会释放 active slot，因此可以为另一条 ready 且 proven 的独立 Work Edge 请求授权；`resume --run ...` 仅在没有待回答授权、没有其他 active run，且原授权仍属于当前 Route Approval、Fact、digest 和 readiness 仍成立时恢复。replan 会让 pending 请求 stale、清空当前 Route Approval；新路线获批后，旧 Run 不能凭旧授权恢复。取消一个 dormant run 不得把另一条 active run 误标为空闲。

实施顺序：

1. 确认完整路线已批准；为当前 ready edge 新建施工授权问题，收到人的独立回答后再激活一次 Run。
2. 用用户级包的 `templates/task-brief.md` 作为可选起点，在 sidecar 的 `briefs/` 中固定当前边的执行面、非目标、授权和 Evidence Contract；`brief_ref` 必须指向以 Blueprint 文件为基准、真实存在且 frontmatter `edge` 正确绑定的独立相对文件。Task Brief 是路线批准时冻结的定义合同，实际执行记录写入 runtime Evidence Record，不回写 Brief。
3. 运行 `gate`，确认 Blueprint 与绑定 Task Brief 的联合 digest 未变化，source、preconditions 和 invariants 在实际事实中成立。
4. 只执行当前边；新事实改变路线时停止并 replan。
5. 运行真实检查，用 `verify --edge ... --result pass|fail --proves ... --executor kind:identity` 留下 Evidence Record。`pass` 必须显式声明；CLI 只登记检查和回读，不执行任意命令。人工、Agent、工具或外部系统都可作为 executor；Agent executor 另需成对记录 `--model` 与 `--reasoning`。
6. 只有 `pass` 且没有 `unverified` 限制时，才把已证明 Predicate 应用到 Fact，并重新派生 State Node。
7. 先向人报告本边结果和检查记录，再刷新当前 proof。若实际目的地 Predicate、逐项 Acceptance 证据和当前子地图 receipt 已成立，执行 `request-arrival-audit`，展示冻结的验收项和问题并结束本回合；不得在创建请求的同一回答执行 `arrive`。若尚未满足到达预检且恰有一条 ready/proven 后续边，在同一回答结束前为它创建新的 pending 授权请求并展示问题；若有多条，展示差异并先请人选择。结束响应时必须存在 pending 到达审计、replan 缺口、选择问题或施工授权问题之一，不能把“下一步由用户自己猜”作为空闲状态。

失败检查不能声明 effects，Edge Run 转为 failed，并执行 `on_failure`：`replan` 回到 wayfinding，`stop` 将 runtime 标为 stopped，`branch` 只把指定备用 Work Edge 记录为待授权建议。备用边仍必须属于当前批准路线、处于 ready/proven，且经过新的 `request-authorization → 人工回答 → authorize` 才能启动；否则保持空闲并报告阻塞原因。失败 Evidence 不被删除。

### 5.3 追加事件与重建

每个 runtime transition 使用 CloudEvents 风格的 `id/source/type/time/subject/data` envelope，并加连续 `seq`、`base_revision`、`previous_digest`、actor 和事件摘要。保存顺序是先追加 event，再原子替换 state；若中断导致二者不一致，普通命令和看板拒绝继续。校验同时覆盖 envelope、map/stream identity、seq、source/id 唯一性、base revision、hash chain，以及 state 内容是否等于最新事件携带的 projection。`rebuild --events ...` 只从通过这些检查的事件恢复 state。没有 `--force` 时拒绝从被截短的 stream 回滚已有投影。

state 还冻结 `brief_snapshots`，使看板在冷启动后遇到 Blueprint 或 Task Brief 的未登记改动时，仍能显示批准时的 Brief 原文；当前文件只能作为 stale 提示，不能替换冻结合同。旧 schema 2 state 缺少该字段时按空快照兼容读取。

Loop 中的每条边都必须产出 progress predicate；从循环节点出发还必须存在能产出 exit predicate 的退出边。每完成一条 loop edge，`loop_iterations` 增加一次；同一边可以在预算内重复选择，达到 `max_iterations` 后 gate 阻塞。正向证明使用同一预算语义，不能靠无限展开证明可达。

Git 只是 realization/evidence adapter 之一。编码工作可以引用 repository、commit 和 paths；非编码工作可以引用文档、会议记录、决策、日历或外部回执。引用不改变所有权：Mapflow 的 Blueprint、Brief、events、state 和浏览器会话仍只属于仓库外 sidecar。

### 5.4 父边与子地图

大目标通过父 Blueprint 的 `submaps[]` 把一条 Work Edge 单向绑定到独立 child Blueprint/state。binding 固定 child map ID/digest、`await: arrival`、父级关闭策略和 `child acceptance/predicates → parent effects` export。child 不反向保存 parent，避免双重真相。

`verify-submap` 重新读取 child，必须同时确认：map ID/digest 匹配、runtime 未 stale、phase 为 arrived、每项导出 Predicate 已观察、对应 Acceptance 有通过 Evidence。成功后追加不可变 Map Receipt，并以 `corroborated` receipt Evidence 应用父 effects。Receipt 绑定 child event revision；child 后续变化只把旧 receipt 标为 stale，不能覆盖旧回执。父图 arrive 会再次 readback，stale 或 invalidated receipt 阻塞到达。

Receipt 一旦被父级接纳，child Blueprint digest 与 arrival state revision 就成为本次 Work Episode 的不可变证据对象。此后漂移属于完整性损坏，不是普通 proof gap：恢复时还原被固定的 child Blueprint/state；如果工作本身已经演进，则建立 successor parent map，在新 Work Episode 中绑定并验收新 child 版本。已验证父边不能在原图中重绑、降级 Fact 或覆盖历史 Evidence；`on_parent_close: invalidate` 若会作废已接纳 Receipt，原地 replan 必须在写入前拒绝。

## 6. 到达审计

到达采用独立的两阶段人工门：

1. Agent 运行 `request-arrival-audit --question ...`。Runtime 先检查下面五项，再冻结当前 Blueprint/Brief digest、Route Approval、事件 revision、Evidence 摘要和完整 Acceptance ID；该命令只生成 pending Arrival Audit Request，保持 `phase: implementation`、`actual_arrival: not-audited`，并结束当前回答。
2. 人在后续消息中针对这个请求逐项审阅并明确回答。Agent 的第一项运行时动作必须是 `arrive --request ... --answer ... --actor human:<identity>`，请求一次性消费并与 `arrival_audited` 事件建立 causation；消费前不得运行 `prove`、`gate` 或任何会追加 runtime event 的命令。旧的 `arrive --confirm ... --acceptance ...` 直接入口拒绝执行。

pending Arrival Audit Request 存在时，`prove` 拒绝刷新并保持请求可消费，防止 Agent 用重复推演使自己的审计问题过期。Blueprint/Brief 漂移、Evidence/Acceptance 变化、Route Approval 变化、显式 `replan` 或其他 runtime 事件仍会使请求 stale，必须重新预检和提问。CLI 能证明请求、状态 revision 和回答事件的因果链；“回答来自后续独立的人类消息”由入口 Skill 的停止规则保证，不能仅凭 `actor` 字符串冒充聊天回合身份。

到达预检与 `arrive` 消费请求时都必须证明：

1. 所有 Destination Predicate 在实际 Fact 中成立；
2. 每项 acceptance 的全部 Predicate 可回指通过的 Work Edge Evidence Record；
3. 适用不变量未被破坏，非目标仍排除；
4. 剩余风险、未验证项和外部动作已明确回报。
5. 所有被使用的子地图回执仍与 child map digest 和 event revision 一致。

到达只证明本地图的目标与验收，不自动证明产品价值、生产安全或发布效果。

## 7. 蓝图分辨率

- 小蓝图：一次对话内仍使用状态—边—证据语义，可以不落盘；但执行前必须在对话中复述 Destination、当前 Fact、唯一 active edge、readiness、授权和 Evidence Contract，并明确给出与 CLI `gate` 等价的“通过/阻塞”结论。无法完整复述时升级为任务蓝图。
- 任务蓝图：跨文件、跨工具或需要复用，保存 Blueprint 与当前 Task Brief。
- 路线地图：架构、迁移、安全、外部系统或跨会话工作，额外保存决策和 Checkpoint。

新证据扩大风险时向上升级分辨率；不能通过降级隐藏约束。多人协作、任务账本和团队门禁属于目标项目的协作流程，不是 Mapflow 默认依赖。

## 8. CLI 最小路径

`<runtime>` 指用户级安装包中的 `mapflow/runtime/mapflow.mjs`；维护本仓库时可替换为 `tools/mapflow.mjs`。入口 Skill 必须先运行 `enable`，后续命令按 `--root` 自动解析同一个 sidecar，因此无需把 state 路径写进目标项目。勘探草稿固定在同一 sidecar 的 `current/wayfinding.yaml`，由看板只读读取：

```bash
node <runtime> enable --root path/to/workspace --json
node <runtime> wayfinding-answer --root path/to/workspace --question establish-starting-state --answer "当前事实和来源" --evidence-ref note:owner
node <runtime> validate --root path/to/workspace
node <runtime> prove --root path/to/workspace
node <runtime> init --root path/to/workspace
node <runtime> request-route-approval --root path/to/workspace --question "是否批准当前已证明的完整路线？" --decision-owner "human:owner"
node <runtime> assign-decision-owner --root path/to/workspace --request <pending-request-id> --decision-owner "human:owner"
node <runtime> approve --root path/to/workspace --request <route-approval-request-id> --answer "确认按这条完整路线推进" --actor "human:owner"
node <runtime> request-authorization --root path/to/workspace --edge settle-audience --question "是否授权执行工作边 settle-audience？" --decision-owner "human:owner"
node <runtime> authorize --root path/to/workspace --request <authorization-request-id> --answer "批准执行该工作边" --actor "human:owner"
node <runtime> gate --root path/to/workspace
node <runtime> verify --root path/to/workspace --edge settle-audience --evidence "决策记录存在" --command "读取记录" --observed "读者已明确" --result pass --proves audience-known --outcome-ref "document:notes/audience-decision.md" --executor "human:owner"
node <runtime> request-authorization --root path/to/workspace --edge write-candidate --question "是否授权执行工作边 write-candidate？"
node <runtime> authorize --root path/to/workspace --request <next-authorization-request-id> --answer "批准执行该工作边" --actor "human:owner"
node <runtime> wait --root path/to/workspace --reason "等待访谈"
node <runtime> resume --root path/to/workspace --run write-candidate-run-1 --reason "访谈已完成"
node <runtime> propose --root path/to/workspace --id audience-from-interview --fact audience-known --value true --source "conversation:owner" --summary "Owner 指定读者" --strength observed --outcome-ref "meeting:notes/audience.md"
node <runtime> confirm --root path/to/workspace --proposal audience-from-interview --by "human:owner"
node <runtime> verify-submap --root path/to/workspace --edge complete-workshop-preparation --executor "human:owner"
node <runtime> replan --root path/to/workspace --reason "新事实改变路线" --scope "subgraph:candidate-ready:article-live" --changes "edge:publish-article,node:article-live"
node <runtime> request-arrival-audit --root path/to/workspace --question "是否确认目标、验收、非目标和遗留风险均已逐项审计？" --decision-owner "human:owner"
node <runtime> arrive --root path/to/workspace --request <arrival-audit-request-id> --answer "确认逐项审计并接受当前遗留风险" --actor "human:owner" --non-goals "不自动选择读者" --risks "无新增风险"
node <runtime> rebuild --root path/to/workspace
```

看板只读取正式地图，不能代替上述命令确认事实或登记证据：

```bash
# 只查看 Blueprint 的定义态
node <runtime> board --map path/to/blueprint.yaml

# 查看当前工作区 sidecar 中绑定 Blueprint、Evidence 和历史的运行态
node <runtime> board --root path/to/workspace
```

工作区尚未执行 `enable` 时，`board --root` 才显示没有 sidecar 真相的空白投影。执行 `enable` 后，即使没有 Blueprint，`board --root` 也会从 `wayfinding.yaml` 显示横向分离、没有连线的始发迷雾和目的地迷雾，以及当前问题指向；计数同时明确“正式节点/边均为 0”和“待确认节点为 2”。勘探更新草稿后，两枚候选获得现场语义和证据；进入目标回归后，未确认的候选工作边可在“目标回归/全部候选”镜头中审阅，默认“当前路线”显示当前确认对象、与它相邻的候选边，以及人已确认但尚未登记的候选。所有草稿对象都不计入正式节点/边，也不能执行。目的地和回归候选逐项确认、候选链闭合后才生成 Task Brief 与 Blueprint；空白 Sidecar 通过 `validate/prove → init` 首次登记，已有正式地图的局部变化才通过 `replan` 登记。

看板首屏只投影一个当前动作门，明确显示“谁处理、处理什么、完成后发生什么”。`ready` 只表示工作边前置条件满足；路线未批准、施工授权未请求或未获人工回答时，界面不得把它称为“可执行”。旧状态若已经到达但缺少两阶段 Route Approval 记录，显示为“历史到达记录，当前批准 ID 不可用”，不能伪造批准，也不能显示成“尚未批准”。

服务只绑定 `127.0.0.1`，默认端口为 `4173`，可用 `--port` 修改。浏览器通过 ETag 轮询：同一拓扑的 Fact、run、proposal、edge、evidence 与 acceptance 变化只更新样式和检查器，节点或边的增删与重连才重新布图。绑定子地图的父边在收缩态由一个可点击摘要节点替代，节点用父边业务标题显示 child phase、Acceptance、receipt 和 stale，并可双击展开；展开后同一节点成为 namespaced Cytoscape compound container，按需请求 `/api/submaps/<binding-path>`，路径如 `preparation/venue-selection`，projection-only portal edge 保持父图方向。收缩和键盘操作均通过选中容器后的检查器按钮完成。展开/收缩和视口只存浏览器会话，不写 Blueprint、events 或 state。

只给 `board --map ...` 时进入定义态，不会意外混入当前工作区 sidecar 的 state；`board --root ...` 才按 Workspace Identity 读取运行事实。诊断或 fixture 可以显式传 `--state`，但这不是面向实际项目的默认入口。

当前文件无效、事件链不一致、半写入或与运行态登记 digest 不一致时，看板保留最近有效或 state 中冻结的 Blueprint，并明确标记 `stale`，不能把错误内容显示成新事实。

旧项目内 `.mapflow` 只作为待人工处理的遗留状态报告；runtime 不读取、不迁移，也不覆盖它。

## 9. 收尾回报

```text
完成：目的地是否实际达到
改动：状态、工作边和产物变化
证明：结构与可达性结论、实际验证命令和 Evidence Record
决策：本轮关键取舍；无则写“无”
遗留：proof gaps、未验证项或风险；无则写“无”
```
