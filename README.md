# mapflow

一套面向个人开发者的地图优先 Agent 辅助工作流。

它解决的问题很简单：先确定要到哪里，再从现状出发逐步走图；每一步都有验证，路线遇到新事实时可以重算。

它不是固定的项目管理制度，也不是多人协作框架。默认只保留四件事：目的地清楚、路线有据、改动可控、结果可验证。

## 使用方式

把 [docs/workflow.md](docs/workflow.md) 作为工作流真源，所有任务先形成蓝图，再按任务规模选择蓝图分辨率：

| 路径 | 适用任务 | 必要产物 |
| --- | --- | --- |
| 小蓝图 | 目标清楚、范围局部、可立即验证的修改 | 当前对话中的目标、路径与验收 |
| 任务蓝图 | 行为变化、跨文件、需要一次取舍或后续复用 | 地图文件和工作项简报 |
| 路线地图 | 架构、数据、安全、迁移、外部系统或跨会话工作 | 持久地图、决策记录、检查点 |

日常入口只有一句话：

> 说“启用 mapflow”或“进入地图优先模式”，告诉 Agent 想达到的结果、约束和已知上下文；在“地图已批准，进入施工”之前，Agent 只勘探和收敛蓝图。

## 目录

```text
README.md                 入口和范围
AGENTS.md                 本仓库的 Agent 维护约定
docs/workflow.md          单人开发工作流唯一行为真源
docs/skill-routing.md     可选能力的触发条件
docs/blueprint/vibe-coding.md
                          阶段契约、Skill 矩阵、能力状态和蓝图表达形式
docs/blueprint/vibe-coding.workflow.json
                          Archify 可编辑的可视化投影输入
docs/blueprint/vibe-coding.workflow.html
                          Archify 生成的交互式阅读投影
docs/wayfinding/skill-architecture-v0-2/README.md
                          核心 Skill 拆分与落地跟进地图
skills/mapflow/SKILL.md    地图优先入口 skill
skills/*/SKILL.md         目的地、勘探、成图、切片和节点施工能力
tools/mapflow.mjs         阶段状态与写入门槛工具
tools/install.mjs         安装到任意目标仓库的 Node.js 安装器
templates/map.md          目的地与路线地图模板
templates/work-item.md    标准/深度任务简报模板
templates/decision.md     需要长期保留的取舍模板
templates/checkpoint.md   跨会话暂停或交接模板
templates/blueprint.yaml  动态蓝图语义模板
templates/blueprint.schema.json
                          蓝图结构校验模板
```

## 最小使用示例

```text
目标：给登录接口增加设备验证码。
约束：不能改变现有客户端协议；先只支持已有短信 provider。
验收：新增失败场景测试，现有认证测试全部通过。
```

## 阶段切换示例

用户可以直接使用固定语句控制阶段：

```text
进入地图优先模式
地图已批准，进入施工
执行地图节点 N1
发现偏差，重新规划
进行到达审计
```

Agent 使用状态工具时，可以在目标仓库根目录执行：

```bash
node tools/mapflow.mjs init --destination "一句话描述目的地" --nodes N1,N2
node tools/mapflow.mjs status
node tools/mapflow.mjs approve --node N1
node tools/mapflow.mjs gate
node tools/mapflow.mjs verify --node N1 --evidence "定向测试通过" --command "npm test" --observed "实际输出摘要"
node tools/mapflow.mjs arrive --confirm "最终验收和 diff 检查通过" --acceptance A1,A2
```

`gate` 只在目的地已批准且存在当前地图节点时通过。它是轻量写入门槛，不是沙箱；实际测试、审查和用户授权仍然有效。

## 安装到目标仓库

在 mapflow 仓库根目录执行：

```bash
node tools/install.mjs --target D:/path/to/your-repo --profile core
```

安装器会写入目标仓库的 `.mapflow/` 运行时文件和 `.agents/skills/` 核心 Skill。已有文件不会被覆盖；确认后可追加 `--force`。目标仓库的 `AGENTS.md` 不会被自动修改，建议片段会写入 `.mapflow/AGENTS.snippet.md` 供人工合并。

Agent 应先读目标仓库自己的 `AGENTS.md`、README、构建脚本和相关代码，再判断使用小蓝图、任务蓝图还是路线地图。项目自身约定优先于本工作流。

## 与 CoAgentWorkflow 的关系

`mapflow` 只负责个人开发时的思考、实施和验证节奏。需要多人协作、任务账本、写集声明、Flow 门禁或正式交接时，再进入目标仓库已有的 CoAgentWorkflow 或其他团队流程；这些机制不在本包内默认启动。`aigineer` 命令和旧目录名仅作为迁移兼容入口保留。
