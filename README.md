# Mapflow

**Mapflow 为所有任务提供清晰可靠的导航图。**

任务可以是一件日常事务、一次写作或活动筹备，也可以是一项研究、故障诊断或软件交付。Mapflow 让人直接看见想完成的结果、现在的位置、完整路线、仍未弄清的区域、下一步及其理由，而不要求先理解它的内部模型。简单任务保持简单；只有真实存在分支、依赖、风险或未知时，地图才展开。

“清晰”意味着普通用户无需学习内部模型，就能读懂结果、当前位置、可选路线、未知、下一步和完成标准。“可靠”意味着地图中的事实有来源、所有参与者读取同一当前 revision，并且候选推演、实际证据和审计到达不会互相冒充。

一张有效的 Mapflow 导航图回答五个普通问题：

1. 这项任务完成后，什么结果必须真实成立；
2. 现在已经知道什么，哪些地方仍是未知或冲突；
3. 从当前位置到结果有哪些完整路线；
4. 下一步为什么现在可以做，完成后应留下什么证据；
5. 最终凭什么判断已经抵达，而不只是“计划看起来可行”。

Mapflow 不接管承载任务事实和协作的外部系统。日历、文档、消息、Issue、Git、CI、发布、监控或审批仍拥有各自真相；地图只保存必要的引用、证据和状态关系。

当前发布版本为 `0.10.1`。版本号只标识源码与用户级安装包，不代表已经部署或获得真实团队采用。

## 快速开始

安装用户级入口：

```bash
node tools/install.mjs --global
```

然后在任意任务目录中明确告诉 Codex“启用 Mapflow”。Mapflow 会在目标工作区之外创建或恢复 Sidecar；未显式启用时不介入任务。

维护本仓库或直接体验 CLI 时：

```bash
node tools/mapflow.mjs enable --root D:/path/to/workspace --json
node tools/mapflow.mjs snapshot --root D:/path/to/workspace --json
node tools/mapflow.mjs board --root D:/path/to/workspace
```

命令返回的 Workspace Head 是看板、CLI 和 Agent 共同读取的当前 revision。完整的建图、写入、证据和到达规则不在 README 重复，统一见行为真源。

## 阅读入口

- [文档地图与真源边界](docs/README.md)
- [行为真源](docs/workflow.md)
- [地图模型](docs/blueprint/map-model.md)
- [企业岗位交接与上下文披露](docs/integration/enterprise-handoffs.md)
- [Skill 路由](docs/skill-routing.md)
- [Community Workshop 示例](examples/community-workshop/README.md)
- [Library System 演化示例](examples/library-system-evolution/README.md)

## 验证

```bash
npm test
npm run benchmark:doctor
npm run demo:evolution
git diff --check
```

本地测试只证明当前代码、合同与 fixtures；不证明发布状态、生产行为、用户价值或企业采用。
