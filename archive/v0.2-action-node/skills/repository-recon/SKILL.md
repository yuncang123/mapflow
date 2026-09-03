---
name: repository-recon
description: "在目的地确定后勘探仓库事实、调用关系、共享契约、生成物和回归面；当改动影响范围或关键未知项尚未清楚时使用。"
---

# repository-recon：仓库勘探

把“我以为会影响这些地方”变成有证据的 Recon Report。该 Skill 同时承担影响面分析，因为调用方、被调用方和契约事实必须从同一次勘探中得出。它只观察和记录，不替用户定产品方向，也不实施代码。

## 输入

- 已定形的 Destination Contract。
- 目标仓库的文件系统、版本控制状态、项目约定和可运行命令。
- 与目标相关的现有代码、配置、测试、文档和生成物。

目的地缺失或明显过时，先回到 `destination-shaping`，不要用勘探报告补写目标。

## 产出

写出一份 Recon Report（可落盘为 Markdown/YAML），至少按以下类别组织：

```yaml
kind: recon
schema_version: 1
destination_ref: "目的地契约"
verified_facts:
  - claim: "来自仓库的事实"
    evidence: "文件、命令或测试输出"
impact:
  callers: []
  callees: []
  shared_contracts: []
  generated_artifacts: []
  regression_surfaces: []
assumptions: []
unknowns:
  - id: U1
    question: "会改变路线的未知"
    probe: "直接查证、research、prior-art 或 prototype"
```

## 步骤

1. **入口事实**：读取仓库根 `AGENTS.md`、README、包管理器脚本、构建/测试入口、相关配置和当前 Git 状态。记录来源，不凭目录名推断行为。
2. **定位热点**：围绕目的地找到候选入口、调用方和被调用方，并沿实际调用或数据流追踪至少一层上下游。关注共享接口、schema、配置、fixture、生成文件和导出边界。
3. **影响面**：把可能受影响的文件或系统归入 callers、callees、shared contracts、generated artifacts、regression surfaces；每项附事实来源或标记为候选。
4. **证据分级**：将代码、配置、测试输出和运行日志标为已验证；将文档或口头说法标为来源说明；将推测写入 assumptions；不能影响路线的未知不扩大报告。
5. **探针**：为每个会改变路线的 unknown 写一个最小探针和停止条件。需要查外部现成方案时可加载 `prior-art`，需要术语或架构背景时可加载 `domain-modeling`；探针结果回填报告。

## 完成条件

- 目的地引用明确，且报告中的关键事实都能追溯到文件、命令或输出；
- 候选写入面、调用关系、共享契约、生成物和回归面已列出，未知项与假设分开；
- 会改变路线的未知项已解决、被最小探针覆盖，或明确阻塞后续规划；
- 报告没有把推测写成事实，也没有通过扫描结果直接宣布目的地完成。

## 边界

- 不替用户选择产品价值、范围或优先级；发现冲突时回到 `destination-shaping`。
- 不输出施工代码、不修改业务文件；必要的报告文件属于本 Skill 的记录产物。
- 不为“可能以后需要”扩展 provider、适配器、插件钩子或兼容层。
- 不把一条测试绿灯等同于完整影响面已验证；测试只是报告中的一种证据。
