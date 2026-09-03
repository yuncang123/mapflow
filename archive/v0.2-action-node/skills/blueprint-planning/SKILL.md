---
name: blueprint-planning
description: "把目的地契约和仓库勘探报告收敛成可解释、可验证、可回滚的节点路线；当需要跨文件、跨会话或存在路线取舍时使用。"
---

# blueprint-planning：绘制路线地图

把当前状态到目的地的路径写成一张可以逐节点执行和重算的 Blueprint Map。地图是决策和转移的模型，不是实施代码，也不是把所有未来可能性预先设计完。

## 输入

- 已批准或待批准的 Destination Contract。
- `repository-recon` 产出的事实、影响面、未知项和探针结果。
- 项目约定的地图位置；没有约定时，本仓库可用 `templates/map.md` 或 `templates/blueprint.yaml`，安装目标仓库使用 `.mapflow/templates/map.md` 或 `.mapflow/templates/blueprint.yaml`。

缺少目的地或关键现状证据时，先回到上游 Skill；不要在地图中猜测关键前提。

## 产出

写出 Blueprint Map，至少为每个节点记录：

```yaml
kind: blueprint
schema_version: 1
destination_ref: "目的地契约"
status: draft
nodes:
  - id: N1
    from: "当前状态"
    action: "一次可执行动作"
    to: "预期状态"
    writes: ["声明写入范围"]
    preconditions: ["前置条件"]
    verification: ["验证命令或可观察结果"]
    rollback: "回退或替代分支"
    on_failure: replan
transitions:
  - from: N1
    to: N2
    when: "出口条件"
```

## 步骤

1. **建模现状**：从 Recon Report 的已验证事实出发，列出目的地所需但当前尚未具备的状态；把 assumptions 和 unknowns 显式放进地图。
2. **切节点**：每个节点只做一次能产生可观察状态变化的动作，优先选择最小可验证切片。为节点声明输入、写入面、前置条件、验收、回滚和失败分支。
3. **连转移**：说明节点完成后何时进入下一个节点，何时回到探针、决策或 `replan`。路线必须能解释“为什么下一步成立”，不能只列任务名称。
4. **处理取舍**：路线涉及产品选择、既有架构取舍、现成方案或实验时，分别按需加载 `grilling`、`domain-modeling`、`prior-art`、`research` 或 `prototype`；把结论和证据回填地图。
5. **批准边界**：地图保持 `draft` 直到用户确认目的地、范围和第一条路线。用户批准后只锁定当前节点，不把未来节点当作已授权写集。

## 完成条件

- 地图同时包含当前状态、目的地、范围、非目标和会改变路线的未知项；
- 至少有一个节点具有明确的 `from`、`action`、`to`、`writes`、前置条件和验证；
- 每个节点都有失败后重规划、回退或替代分支；
- 转移条件可观察，能说明从一个节点为何进入下一个节点；
- 用户批准前没有代码、配置或生成物写入；批准后仍只授权当前节点。

## 边界

- 不替用户批准目的地，不把 `draft` 地图当施工许可。
- 不把节点拆成没有独立状态变化的待办清单；需要施工边界时交给 `node-slicing`。
- 不实施代码、不运行发布或外部写入动作。
- 新证据改变目标、范围、依赖或验收时保留已验证节点，标记旧路线并重新规划，不强行沿用。
