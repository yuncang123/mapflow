---
name: repository-recon
description: "为仓库型任务勘探起始事实、调用关系、共享契约、生成物和回归面；当仓库事实会改变路线且关键 Fact 仍是 unknown/conflict 时使用。"
---

# repository-recon：起始状态勘探

把起始地固定为可引用的四值 Fact 集，而不是一段仓库概述。

## 步骤

1. **入口事实**：读取项目约定、README、构建/测试入口、配置和 Git 状态。完成条件：仓库、目标范围和验证入口可从文件或命令回指。
2. **事实分级**：每项 Fact 只取 `true`、`false`、`unknown`、`conflict`；`true/false` 带证据，`conflict` 保留相互冲突的来源。完成条件：unknown 没有被补成 false 或模型推测。
3. **影响面**：沿实际调用或数据流检查 callers、callees、shared contracts、generated artifacts 和 regression surfaces。完成条件：每个候选写入面有来源或明确标成候选。
4. **迷雾探针**：只为会改变路线的 unknown/conflict 写 probe 和停止条件。完成条件：关键未知已解决、已有可执行探针，或明确阻塞规划。

5. **始发候选投影**：`enable` 已建立通用始发 Fog Node、目的地 Fog Node 和始发勘探问题。第一组事实成立后，在 Mapflow sidecar 的 `current/wayfinding.yaml` 中用现场语义与四值证据替换通用始发候选，不另建平行起点。每个待问问题必须绑定 `target.kind`、`target.id`、`target.label` 和 `target.purpose`，并在提问前说明它准备建立的节点或边。完成条件：看板始终能显示始发候选、目的地迷雾和问题目标；没有把候选写入正式 Blueprint。

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

wayfinding:
  origin:
    id: origin-fog
    kind: fog
    label: 当前起始状态
  questions:
    - id: scope-choice
      prompt: 待用户确认的路线取舍
      target: { kind: destination, id: destination-fog, label: 目的地尚未定形, purpose: 收敛目标合同 }
      status: pending
      answer_updates: [wayfinding.intent.status, wayfinding.intent.open_questions, wayfinding.destination.status]
```

勘探只产生事实与探针，不选择产品路线，也不实施 Work Edge。
