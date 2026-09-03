# mapflow

一套为“尚未拥有明确地图的目的地”建模的轻量工作流，适用于编码、调研、写作、采购、会议、发布和运营：

```text
反向目标回归 → 正向可达性证明 → 反例驱动修图
```

Mapflow 使用四值 Fact、Predicate 派生的 State Node、独立 Work Edge、Task Brief 和 Evidence Record，把人脑中的工作路线以及人与 Agent、工具、文档、Git、会议、外部系统的流式协作落成可证明的地图。完整行为只在 [docs/workflow.md](docs/workflow.md) 定义。

## 开始

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

浏览器打开 `http://127.0.0.1:4173`。看板每秒检查一次 Blueprint、Task Brief 和运行状态；内容未变时由 ETag 返回 `304`，状态变化不会打乱视口，只有节点或边的拓扑变化才重新布图。有运行状态时使用：

```bash
node tools/mapflow.mjs --state .mapflow/state.json board
```

## 导航

- [行为真源](docs/workflow.md)：阶段、建模循环、门槛、证据和到达审计。
- [地图模型](docs/blueprint/map-model.md)：Blueprint、AND/OR、四值事实和推理合同。
- [领域词汇](CONTEXT.md)：Fact、State Node、Work Edge、Proof Gap 等术语。
- [Skill 路由](docs/skill-routing.md)：按当前地图阶段加载能力。
- [示例 Blueprint](templates/blueprint.yaml) 与 [Task Brief](templates/task-brief.md)：可运行起点。
- [架构决定](docs/adr/0001-state-nodes-and-work-edges.md)：为何从动作节点切换为状态节点与工作边。

## 安装

个人长期使用可安装全局入口包：

```bash
node tools/install.mjs --global
```

需要仓库级版本隔离时安装到目标仓库：

```bash
node tools/install.mjs --target D:/path/to/your-repo --profile core
```

安装器不会自动修改目标仓库的 `AGENTS.md`。多人协作、任务账本和团队门禁继续由目标项目自己的协作流程负责，不是 Mapflow 默认依赖。

v0.2 动作节点模型已退出活动路径，历史材料见 [archive/v0.2-action-node](archive/v0.2-action-node/README.md)。动态看板是本地 Map Projection，不是状态真源，也不提供业务写入入口。
