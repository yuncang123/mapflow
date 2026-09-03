# Mapflow v0.2 动作节点模型归档

本目录保存 2026-09-03 重设计开始时仍在使用的核心行为文档、Blueprint、模板、Skills、状态 CLI，以及依赖该语义的历史可视化和探路记录。

v0.2 的核心模型是：节点同时承载动作、写入范围、验证和完成状态，转移只记录 `from/to/when`，运行状态使用 `current_node/completed_nodes`。活动版本已改为状态节点、独立工作边和证据派生状态。

归档用于理解历史决策，不再作为安装、运行或 Agent 行为入口。完整提交历史仍以 Git 为准；归档中的 `skills/mapflow/agents/openai.yaml` 包含重设计开始前工作树已有的入口提示修订。
