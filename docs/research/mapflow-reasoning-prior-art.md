# Mapflow 推理模型 Prior Art

日期：2026-09-03

## 要解决的类别

Mapflow 需要的是开放世界中的工作建模与可达性审计：事实、目标、工作边和证据合同会在工作过程中被发现和修正。它不是一个预先拥有完整动作库后自动执行计划的传统规划器。

## 检索来源

- 本仓库：现有节点状态机、Blueprint schema、Skill 和测试。
- 论文元数据：Crossref 对 STRIPS、Partial-order planning、CEGAR DOI 的记录。
- 官方项目说明：University of Maryland 的 SHOP/HTN 项目说明。
- npm：`mahler@4.1.5`、`rafcode@5.8.1`、`js-yaml@5.4.1`、`yaml@2.9.0` 的包元数据与 README。

## 候选与裁决

### 整体采用

- `mahler@4.1.5`：提供 HTN、condition/effect、运行时观察、并行计划和失败后重规划；但它要求领域专家先定义 task/method，且以自主 Agent 执行为中心。Mapflow 需要在人、Agent、工具和外部事件之间逐步发现事实、边和证据，需求重合不足以整体采用。
- `rafcode@5.8.1`：面向编码 Agent 的任务规划与执行，包体和运行依赖更重，也会把 Mapflow 再次绑定到编码工具。拒绝。
- SHOP/SHOP2：官方说明确认它通过预定义 method 递归分解非原子任务。该假设适合稳定领域，不适合作为 Mapflow 的事实真源或运行时。

### 采用组件

- `js-yaml@5.4.1`：MIT，浏览器 ESM 构建约 79 KB、无捆绑依赖。采用其自包含构建解析 `blueprint.yaml`，随项目级 runtime 一起分发，避免要求目标仓库安装 npm 依赖。
- `yaml@2.9.0`：ISC，模块化包更小，但不是单文件分发形状。当前不采用。

### 借鉴设计

- [STRIPS](https://doi.org/10.1016/0004-3702%2871%2990010-5)：借鉴状态、动作前置条件和效果；不采用闭世界假设。
- [SHOP/HTN](https://www.cs.umd.edu/projects/shop/description.html)：借鉴从目标回归到独立工作的递归分解；不要求预先具备完整 method 库。
- [Partial-order planning](https://doi.org/10.1016/0004-3702%2894%2990012-4)：借鉴因果依赖和最少排序，用显式中间状态消除边间隐藏耦合。
- [CEGAR](https://doi.org/10.1007/10722167_15)：借鉴反例驱动的局部细化；证明失败只修受影响子图，保留已验证事实和证据。

## 最终裁决

落在“采用组件 + 借鉴设计”：采用自包含 YAML 解析器；Mapflow 自己实现小而确定的 schema 校验、反向闭包检查、有限事实世界搜索、证明缺口和证据门槛。第一版不引入通用搜索求解器、任务 runner、领域方法库、远程服务或多人协作层。
