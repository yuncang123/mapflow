# Mapflow 工作流

本文是 Mapflow 行为唯一真源。README 只负责导航，Skills 只负责把当前状态路由到本文的一小段行为。

## 1. 唯一主线

Mapflow 只服务一个目标：

> 从 Destination 反向演化出逻辑可推导的地图，从当前 Fact 正向证明可达，再让人或 Agent 沿可信 Work Edge 推进；Evidence 更新 Fact，最终形成可审计 Arrival。

Mapflow 是单人电脑上的仓库外 sidecar，不是团队协作空间。人、Agent、前端、后端、产品、测试、技术支持、领导和外部系统都可以提供事实、执行工作或审计结果，但 Mapflow 不接管他们的系统。

每增加一个默认步骤，都必须指出它防止的具体失败模式。不能强化上述主线的功能、阶段或文档，不进入默认产品面。

## 2. 真相、投影与边界

Sidecar 保存：

```text
workspace.json
current/
  wayfinding.yaml
  wayfinding-events.jsonl
  blueprint.yaml
  briefs/
  events.jsonl
  state.json
```

- Blueprint 定义 Destination、Predicate、Fact 初值、State Node、Work Edge、Invariant、Loop 和 Submap Binding。
- Task Brief 定义一条边的执行、证据、岗位交接与上下文合同。
- events 是不可变运行历史；state 是可重建投影；Board 是只读视图。
- Git、Issue、PR、CI、测试、发布、监控和工单系统继续拥有各自事实。Mapflow 只保存稳定引用、digest、readback 或 receipt。
- 旧 schema/state 可以兼容读取，但不会把旧 Activity、固定 SDLC 或 Route Approval 重新带回当前行为。

静态代码、模型推演、本地测试、外部 readback、生产结果和业务验收是不同证据层，不能相互冒充。

## 3. 从目的地反向建图

### 3.1 起始 Fact

启用后先从权威来源记录当前事实。每项 Fact 只能是 `true`、`false`、`unknown` 或 `conflict`；`true/false` 必须带来源，未知不能被补成 false，冲突必须保留双方证据。

全新 sidecar 只有相互分离的始发迷雾与目的地迷雾，不创建虚构的 `origin → destination` 边。

### 3.2 Destination Contract

Destination 不是一句愿望，而是：

- 必须成立的目标 Predicate；
- 全程不能破坏的 Invariant；
- 每项验收证明哪些 Predicate；
- in/out scope 与外部动作授权边界。

用户首次描述只能形成候选合同。Mapflow 展示完整候选后，必须由后续独立回答明确确认 Destination，并通过指向 destination 的 `wayfinding-answer` 保存原话和来源。修改候选的同一条消息只用于修订；泛化的“继续”不确认未被引用的合同。

这个唯一的人类确认门防止“模型把自己总结的目标当成用户已经同意”。它不证明目标已经实现。

### 3.3 Goal Regression

Destination 确认后，从每个目标 Predicate 反问：

1. 哪条独立 Work Edge 能产生它；
2. 这条边执行前哪些 Predicate 必须成立；
3. 哪个 State Node 准确表达这些条件；
4. 哪种 witness 能证明结论实际发生。

AND 由多 Predicate State/Join 表达，OR 由多条替代边表达，未知事实使用 Fog，真实路线取舍才使用 Decision。若边 B 依赖边 A 的 effect，必须插入中间状态；同源边不能隐藏临时产物依赖。

反向结果先作为完整候选链投影给人审阅。节点和边无需逐对象审批；正式登记前必须同时满足：Destination 已确认、候选链闭合、每条边合同完整、`validate` 通过、`prove` 给出正向结论。这样保留人的路线审阅权，同时避免 O(n) 的确认仪式。

## 4. 因果成立的条件

schema 3 的每条 Destination 相关 Work Edge 必须声明：

```yaml
causal_contract:
  rule_id: implement-contract-v1
  premises: [source-state, precondition, applicable-invariant]
  conclusions: [observable-effect]
  proof_mode: executed-verifier
  rule_basis: { kind: verifier, ref: contract-test }
  required_witnesses: [contract-test-evidence]
  non_interference: [scope-preserved]
```

确定性校验保证：

- premises 覆盖 source node、preconditions 与适用 invariant；
- conclusions 与 edge effects 完全一致；
- required witnesses 存在并覆盖每个 conclusion；
- non-interference 不与 conclusions 冲突；
- rule basis 指向明确 verifier、外部合同或子地图回执。

这证明“声明的推导规则自洽”，不是证明现实世界天然服从该规则。现实成立还需要实际运行 witness。

### 4.1 正向证明

`prove` 从有来源的初始 Fact 出发，在隔离的事实世界中前向应用规则。每个世界里同一 Fact 只有一个值；OR 路线完整保留，AND 必须全部满足；Loop 受 progress/exit Predicate 和迭代预算约束。

证明同时输出：

- `candidate_edges`：反向闭包相关边；
- `proven_edges`：至少位于一条 Destination-reaching 路线上的边；
- 完整 derivation graph、primary proof 与稳定 SHA-256 digest；
- 只位于当前可达 frontier 的 causal/proof gaps 和最小 repair scope。

不报告已经经过、但后来 Fact 变化导致的陈旧 premise；未来尚未到达的 premise 也不冒充当前阻塞。

### 4.2 五层证据边界

1. `structural_soundness`：Schema、引用、拓扑、Evidence 与 Causal Contract 完整。
2. `declared_model_derivability`：在声明模型和显式假设下逻辑/条件可达。
3. `runtime_readiness`：当前 observed Fact 满足一条 destination-reaching 边的前置。
4. `executed_derivation`：冻结 verifier、外部 readback 或 receipt 已实际证明边效果。
5. `audited_arrival`：Destination、Acceptance、Invariant、非目标和风险已由指定 auditor 审计。

前一层不能替代后一层。“可实现”最多是模型层候选，不是 Work Edge 已打通。

## 5. Task Brief：施工、岗位交接与注意力

一条 Work Edge 对应一个语义化 Task Brief。最小合同包括 scope、authorization、evidence、verification 和 failure。软件工程边还可声明：

- `handoff`：`from_roles`、`to_roles`、`inputs`、`outputs`、`decision_rights`；
- `context`：一句 `focus`、最多五个 `load_first`、带触发条件的 `load_on_demand`、`max_files/max_chars` 预算。

它们是接口，不是团队文档副本。具体岗位范式和外部系统边界只在需要设计或审查交接时加载 [enterprise-handoffs.md](integration/enterprise-handoffs.md)。

`mapflow context` 分四层披露：

- `focus`：默认；目的地、当前边、effects、handoff 摘要、加载入口与预算。
- `work`：当前边、相邻节点、不变量和完整 Brief。
- `evidence`：当前边 Evidence、Acceptance 与 pending Proposal。
- `history`：限定条数的相关事件。

调用者从 `focus` 开始，只有触发条件成立才加载更深层。预算将要超限时，先摘要、切边或建立子地图。

## 6. 沿边执行

每轮先运行 `next-actions --json`。只能处理返回的 active edge、ready edges、人工门或 proof gap；多条 ready edges 原样展示，由人选择。个人版同一时刻只有一个 active Run。

- 无授权要求的 proven/ready 边：`start --edge <id>`。
- Task Brief 明确声明授权要求的边：`request-authorization`，待指定 `human:*` 或 `agent:*` 回答后 `authorize`。
- 普通边拒绝额外授权请求，避免人为制造审批仪式。

启动后 `gate` 只检查：Destination 已确认、当前边仍在 proven/ready frontier、Run active、Blueprint/Brief 未漂移、Loop 仍有预算。

### 6.1 执行证据

Task Brief 的 verifier 在 Run 开始前冻结。`issue-action` 生成绑定 map/brief/edge/run/verifier 的一次性能力；`verify-executed` 实际运行检查并记录退出码、输出摘要和 digest。

- pass 且覆盖 required witness：应用 effects，更新 Fact，完成 Run。
- fail：不应用 effects，按 `replan/branch/stop` 进入失败分支。
- `verify` 的 reported 结果：只保存观察，不改变 Fact 或 Acceptance。
- 无本地命令的边：使用外部 readback adapter；子地图边使用 `verify-submap` 的 Map Receipt。

对话、工具或流式输入先形成 Proposal；只有显式 `confirm` 后才改变 Fact。等待、阻塞、恢复和取消分别使用 `wait/block/resume/cancel`，每次变化都追加事件。

### 6.2 Replan

新事实改变路线时，只修改 proof gap 的最小 repair scope，并用 `replan --scope ... --changes ...` 登记精确 diff。已验证 Work Edge 的因果合同、Evidence 和 Fact 不得被重定义或覆盖；pending 授权与到达审计请求变 stale。

## 7. 子地图

当一条边本身仍是一张多步地图，用父 Blueprint 的单向 Submap Binding 固定 child map ID/digest、`await: arrival`、关闭策略与 `child acceptance/predicates → parent effects` export。

`verify-submap` 只接受已审计到达、digest/revision 一致且 Acceptance 完整的 child receipt。父图使用该 receipt 后，child 漂移使其 stale；不能把 child 当前态偷偷拼进父历史帧。

## 8. 到达审计

所有目标 Predicate 已被可信 Evidence 建立后：

1. `request-arrival-audit` 冻结 Blueprint/Brief digest、事件 revision、Evidence 摘要和 Acceptance，创建一次性请求并结束当前回答。
2. 后续独立回答由请求指定的 `human:*` 或 `agent:*` auditor 使用 `arrive --request ...` 消费。

到达必须同时满足：目标 Fact、逐项 Acceptance、Invariant、非目标/剩余风险、子地图 receipt 均可回指。pending 请求存在时不得先刷新 proof 或追加无关事件。

Arrival 只证明本地图合同已到达，不自动证明产品价值、生产安全、真实用户满意或发布成功。

## 9. CLI 最小路径

```bash
node <runtime> enable --root path/to/workspace --json
node <runtime> context --root path/to/workspace --layer focus --json
node <runtime> wayfinding-answer --root path/to/workspace --question <id> --answer <text> --evidence-ref conversation:<ref>
node <runtime> validate --root path/to/workspace
node <runtime> prove --root path/to/workspace --json
node <runtime> init --root path/to/workspace
node <runtime> next-actions --root path/to/workspace --json
node <runtime> start --root path/to/workspace --edge <unprotected-edge>
node <runtime> request-authorization --root path/to/workspace --edge <protected-edge> --question <text> --decision-owner human:owner
node <runtime> authorize --root path/to/workspace --request <id> --answer <text> --actor human:owner
node <runtime> gate --root path/to/workspace
node <runtime> issue-action --root path/to/workspace --edge <edge> --verifier <id> --json
node <runtime> verify-executed --root path/to/workspace --edge <edge> --verifier <id> --capability <token> --evidence <text> --outcome-ref command:<ref> --executor tool:mapflow
node <runtime> replan --root path/to/workspace --reason <text> --scope <repair-scope> --changes <exact-refs>
node <runtime> request-arrival-audit --root path/to/workspace --question <text> --decision-owner human:owner
node <runtime> arrive --root path/to/workspace --request <id> --answer <text> --actor human:owner --non-goals <text> --risks <text>
node <runtime> rebuild --root path/to/workspace
```

看板只读：

```bash
node <runtime> board --root path/to/workspace
node <runtime> board --map path/to/blueprint.yaml
```

`board --root` 投影 sidecar 的当前事实和历史；`board --map` 只看定义，不混入运行态。首屏只强调 Current Focus；因果证明、handoff、evidence 和 history 在选择对象后按需展开。

## 10. 收尾回报

```text
完成：目的地是否实际到达
改动：状态、工作边和产物变化
证明：五层证据分别到哪里
决策：本轮关键取舍；无则写“无”
遗留：proof gaps、未验证项或风险；无则写“无”
```
