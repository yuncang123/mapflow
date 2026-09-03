---
name: repository-recon
description: "在目的地确定后勘探起始事实、调用关系、共享契约、生成物和回归面；当关键 Fact 仍是 unknown/conflict 或影响范围不清楚时使用。"
---

# repository-recon：起始状态勘探

把起始地固定为可引用的四值 Fact 集，而不是一段仓库概述。

## 步骤

1. **入口事实**：读取项目约定、README、构建/测试入口、配置和 Git 状态。完成条件：仓库、目标范围和验证入口可从文件或命令回指。
2. **事实分级**：每项 Fact 只取 `true`、`false`、`unknown`、`conflict`；`true/false` 带证据，`conflict` 保留相互冲突的来源。完成条件：unknown 没有被补成 false 或模型推测。
3. **影响面**：沿实际调用或数据流检查 callers、callees、shared contracts、generated artifacts 和 regression surfaces。完成条件：每个候选写入面有来源或明确标成候选。
4. **迷雾探针**：只为会改变路线的 unknown/conflict 写 probe 和停止条件。完成条件：关键未知已解决、已有可执行探针，或明确阻塞规划。

## 产出

```yaml
initial_state:
  facts:
    - id: source-exists
      value: "true"
      evidence: [{ kind: document, ref: notes/source.md }]
    - id: authorization-known
      value: unknown
      evidence: []
impact:
  callers: []
  callees: []
  shared_contracts: []
  generated_artifacts: []
  regression_surfaces: []
```

勘探只产生事实与探针，不选择产品路线，也不实施 Work Edge。
