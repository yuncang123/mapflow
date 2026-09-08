# mapflow

一套为“尚未拥有明确地图的目的地”建模的轻量工作流，适用于编码、调研、写作、采购、会议、发布和运营：

```text
反向目标回归 → 正向可达性证明 → 反例驱动修图
```

Mapflow 使用四值 Fact、Predicate 派生的 State Node、独立 Work Edge、Task Brief 和 Evidence Record，把人脑中的工作路线以及人与 Agent、工具、文档、Git、会议、外部系统的流式协作落成可证明的地图。v0.6 把完整运行时安装在用户级目录，按本地工作区建立仓库外 sidecar，并可从真实空白状态回放地图演化；Mapflow 是本地仓库的助手，不成为仓库内容或 Git 真相的一部分。完整行为只在 [docs/workflow.md](docs/workflow.md) 定义。

## 开始

首次使用只需安装一次用户级入口：

```bash
node tools/install.mjs --global
```

之后在任意工作目录对 Agent 说“启用 mapflow”，入口 Skill 会先自动执行幂等 `enable`，创建或恢复该工作区的仓库外 sidecar。首次启用立即出现横向分离、没有连线的“始发地仍在迷雾中”和“目的地仍在迷雾中”；它们只是 Wayfinding 候选，正式拓扑仍为 `0/0`。没有已安装的用户级入口时，自然语言无法凭空发现 Mapflow，因此首次全局安装仍是唯一 bootstrap。

在本维护仓库中可直接检查启用结果：

```bash
node tools/mapflow.mjs enable --root D:/path/to/workspace --json
```

勘探或目的地定形时，回答已持久化的问题并让看板刷新当前建模焦点：

```bash
node tools/mapflow.mjs wayfinding-answer --root D:/path/to/workspace \
  --question <question-id> --answer "<human answer>" --evidence-ref note:<source>
```

Windows 默认把 Mapflow 数据放到 `%LOCALAPPDATA%/Mapflow/workspaces/<workspace-id>/`；Linux/macOS 使用 `$XDG_STATE_HOME/mapflow` 或 `~/.local/state/mapflow`。可用绝对且位于工作区之外的 `MAPFLOW_HOME` 覆盖。Blueprint、Brief、Wayfinding/runtime events、state 和看板运行数据均不写入目标仓库。

```text
<mapflow-home>/workspaces/<workspace-id>/
├─ workspace.json
└─ current/
   ├─ wayfinding.yaml
   ├─ wayfinding-events.jsonl
   ├─ blueprint.yaml
   ├─ briefs/
   ├─ events.jsonl
   └─ state.json
```

运行仓库自带的“发布一篇文章”示例：

```bash
node tools/mapflow.mjs validate --map templates/blueprint.yaml
node tools/mapflow.mjs prove --map templates/blueprint.yaml
```

需要建立运行状态、执行工作边或做到达审计时，继续阅读 [CLI 最小路径](docs/workflow.md#8-cli-最小路径)。

需要用图理解当前地图时，启动只读动态看板：

```bash
node tools/mapflow.mjs board --map templates/blueprint.yaml
```

浏览器打开 `http://127.0.0.1:4173`。看板每秒检查一次 Blueprint、Task Brief 和运行状态；内容未变时由 ETag 返回 `304`。底部“地图演化镜头”可从真实空白帧开始，逐步回放勘探、目的地定形、反向目标回归、正式建图、路线/施工人工门、Evidence 和到达审计；历史态只读，当前真相更新时只提示，不会强制跳回。当前工作区已经启用并建图后，直接启动运行态看板：

```bash
node tools/mapflow.mjs board
```

看板只读显示 Intent、Fact 可信度、Proposal、Decision、Edge Run、Evidence、Acceptance 和 stale；勘探阶段还会显示 `wayfinding.yaml` 中的始发候选、完整目的地合同、候选工作边和每个问题的建模目标，但这些对象不计入正式拓扑。问题回答和草稿更新后会动态刷新并追加可信演化帧；“目标回归”镜头从目的地按里程碑向始发地展开，并分别显示目标侧后缀证明、当前事实前缀和尚未接通的桥。父边绑定子地图时，实时态收缩为一个可点击摘要节点，展开后同一节点成为原图内的 compound container；历史父帧不会混入子地图当前态。每个回归节点和工作边都必须有带来源的独立人工确认；候选链闭合后写入 Blueprint，首次用 `init` 登记并桥接 Wayfinding journal，已有正式地图的局部修订才用 `replan`。完整行为和兼容边界见 [工作流](docs/workflow.md)。

要直接验收一条从空白到到达审计的软件项目演化链，运行：

```bash
npm run demo:evolution
```

它会在系统临时目录创建一个空 Git 工作区，通过真实 CLI 建立“个人图书管理系统 MVP”地图并启动本地看板。演示中的人工身份和检查是确定性 fixture，只证明 Mapflow 产品链路，不代表真实项目交付。细节见 [图书管理系统演化演示](examples/library-system-evolution/README.md)。

查看一套已经完成父子回执的非编码 fixture：

```bash
node tools/mapflow.mjs --state examples/community-workshop/.mapflow/state.json board --port 4180
```

## 修改 Mapflow 后

先生成与当前改动匹配的最小回归计划；该命令只给计划，不执行测试，也不会自动进入完整 Release 旅程：

```bash
npm run benchmark:plan
# 只评估指定文件
node tools/benchmark.mjs regression-plan --paths docs/workflow.md
```

输出会列出已命中的规则、依赖闭包后的回归层、预计分钟数、具体命令和证据边界。完整协议与案例矩阵见 [产品体验持续回归矩阵](benchmarks/README.md)。

## 导航

- [行为真源](docs/workflow.md)：阶段、建模循环、门槛、证据和到达审计。
- [地图模型](docs/blueprint/map-model.md)：Blueprint、AND/OR、四值事实和推理合同。
- [领域词汇](CONTEXT.md)：Fact、State Node、Work Edge、Proof Gap 等术语。
- [Skill 路由](docs/skill-routing.md)：按当前地图阶段加载能力。
- [示例 Blueprint](templates/blueprint.yaml) 与 [Task Brief](templates/task-brief.md)：可运行起点。
- [架构决定](docs/adr/0001-state-nodes-and-work-edges.md)：为何从动作节点切换为状态节点与工作边。
- [用户级运行时与 Workspace Sidecar](docs/adr/0004-user-runtime-and-workspace-sidecar.md)：安装和状态所有权边界。
- [v0.5 Workspace Sidecar 验收](docs/wayfinding/mapflow-v0-5-workspace-sidecar/acceptance.md)：自动启用、分发完整性与 Git 零写入证据。
- [v0.4 完整版设计与验收](docs/wayfinding/mapflow-v0-4-complete/README.md)：Intent、事件、运行生命周期、父子地图和多分辨率看板。
- [社区工作坊示例](examples/community-workshop/README.md)：不依赖编码/Git 的父子地图与到达回执。
- [OrderPulse 空白起点演示](examples/order-query-timeout-starter/README.md)：从没有 Blueprint 的 Sidecar 开始，通过真实勘探、目的地定形和人工确认逐步生成地图。
- [Mapflow v0.5 空白建图基准测试](docs/wayfinding/mapflow-v0-5-baseline-test/README.md)：交给新会话重复执行的空白起点、人工回归、证明、施工和到达审计流程。
- [产品体验持续回归矩阵](benchmarks/README.md)：七条黑盒旅程、隐藏结果 Oracle、过程硬门、人工评分和运行证据；图书系统是端到端主线，OrderPulse 是诊断专项。
- [OrderPulse 完成态参考](examples/order-query-timeout/README.md)：用于对照目标回归、证明、验收和安全发布的最终形态，不是演示起点。

## 安装边界

安装器只支持 `--global`。旧的 `--target` 路径已拒绝，避免把 runtime、Skills 或状态目录复制到目标项目。`enable` 只在仓库外创建 sidecar，不修改目标仓库的 `AGENTS.md`；多人协作、任务账本和团队门禁继续由目标项目自己的协作流程负责，不是 Mapflow 默认依赖。

历史版本已经退出活动路径：v0.2 动作节点模型见 [archive/v0.2-action-node](archive/v0.2-action-node/README.md)，v0.3 单图运行与平面看板设计见 [archive/v0.3-single-map](archive/v0.3-single-map/README.md)。动态看板是本地 Map Projection，不是运行事件真源，也不提供业务写入入口。
