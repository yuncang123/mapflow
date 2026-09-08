# Mapflow v0.3 重设计勘探报告

## 目的地

把 Mapflow 从“工作节点 + 条件转移 + 手动完成节点”替换为“状态节点 + 独立工作边 + 证据派生状态”，并实现反向目标回归、正向可达性证明和反例驱动修图所需的最小运行时。

## 已验证事实

- `templates/blueprint.yaml` 把写入、前置条件、预期状态和验证放在节点上；`transitions` 只有 `from/to/when`。
- `tools/mapflow.mjs` 以 `current_node`、`completed_nodes` 作为运行核心，`verify` 直接宣布节点完成。
- `docs/workflow.md`、五个核心 Skill、Markdown 模板和 `docs/blueprint/` 都复述了工作节点模型。
- `tools/install.mjs` 分发整个模板目录和 CLI；用户未提交的全局安装能力与领域模型正交，应继续保留。
- 当前工作树已有用户修改：`README.md`、`skills/mapflow/agents/openai.yaml`、`tests/test_mapflow.mjs`、`tools/install.mjs`。
- 仓库没有活动 `.mapflow/state.json`，不存在需要迁移的本地运行实例。

## 影响面

- 调用入口：`README.md`、`skills/mapflow/SKILL.md`、`skills/mapflow/agents/openai.yaml`。
- 行为真源：`docs/workflow.md`、`docs/skill-routing.md`、`docs/blueprint/`。
- 共享合同：`templates/blueprint.yaml`、`templates/blueprint.schema.json`、`templates/map.md`、`templates/work-item.md`、`templates/checkpoint.md`。
- 运行时：`tools/mapflow.mjs`、`tools/vendor/`、`.mapflow/state.json` schema。
- 分发：`tools/install.mjs` 的项目级与全局安装布局。
- 回归面：`tests/test_mapflow.mjs`、README 链接、安装后路径、`npm test` 和 `git diff --check`。
- 历史生成物：旧 Archify workflow HTML/JSON 以及旧 wayfinding 文档只描述动作节点模型，应归档而不再作为入口。

## 已解决的未知项

- 蓝图保持 YAML 语义真源；采用随 runtime 分发的 `js-yaml` 单文件构建，目标项目不另装依赖。
- v0.2 核心模型保存到 `archive/v0.2-action-node/`；活动入口只指向 v0.3，不增加兼容分支。
- 运行时执行对象改为 edge；state 保存 `active_edge`、`verified_edges` 和事实，`satisfied_nodes` 每次从事实派生。
- OR 由多个候选工作边表达，AND 由包含多个谓词的状态/汇合节点表达；同源边之间若存在产出—前置依赖，校验生成 `hidden_edge_coupling`。

## 非目标

- 本轮不实现浏览器动态看板、自动执行器、多人协作、远程服务或传统规划搜索器。
- 不迁移外部仓库中可能存在的 v0.2 state；v0.3 对旧 state 明确报不兼容。
