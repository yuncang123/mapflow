---
edge: semantic-work-edge
title: 工作边标题
status: ready
map: docs/wayfinding/semantic-map/blueprint.yaml
created: YYYY-MM-DD
updated: YYYY-MM-DD
contract:
  scope:
    in: [待填写]
    out: [待填写]
  authorization:
    required: []
    allowed_actions: [待填写]
  # 仅在这条边跨角色时保留 handoff。
  handoff:
    from_roles: [任务所有者]
    to_roles: [执行责任人]
    inputs: [本边所需的已接受产物或事实]
    outputs: [交给下一岗位的可观察产物或回执]
    decision_rights: [由谁在什么条件下作出哪项决定]
  # 仅在默认 Focus 不足或材料容易超载时保留 context。
  context:
    focus: 只推进当前 Work Edge 并证明其 effects
    load_first: [本 Task Brief, 当前 Blueprint 中本边及相邻节点]
    load_on_demand:
      - when: verifier、外部合同或失败分支需要追溯时
        refs: [相关实现文件、证据或历史帧]
    budget: { max_files: 8, max_chars: 50000 }
  evidence:
    proves: [effect-predicate]
    exit_conditions: [待填写]
  verification:
    commands:
      - id: observable-exit-check
        program: node
        args: [path/to/workspace-owned-verifier.mjs]
        cwd: workspace
        timeout_seconds: 120
        success_exit_codes: [0]
        proves: [effect-predicate]
  failure:
    action: replan
    rollback: [待填写]
---

# State transition

- From：
- To：
- Preconditions：
- Expected effects：

# Causal contract

- Rule ID：`edge-id-v1`
- Premises：必须逐项对应 Blueprint 中 source node、preconditions 和适用 invariant 的 Predicate。
- Conclusions：必须与该边 `effects` 完全一致，不能只写“可能完成”。
- Proof mode：`executed-verifier` / `external-readback` / `submap-receipt`
- Required witnesses：使用 Evidence Contract 的稳定 ID；执行记录必须把它们绑定到实际 verifier、产物或回执。
- Non-interference：声明本边不得破坏的 Predicate；与 conclusions 重叠会被拒绝。

# Scope

## In scope

- 待填写

## Out of scope

- 待填写

# Execution boundary

- 执行器或责任人：
- 允许写入或外部动作：
- 所需授权：
- 与同源其他边共享的只有起始状态；不存在未建模的产出依赖。

# Evidence contract

| Evidence | Proves predicate | Observable exit condition |
| --- | --- | --- |
| 待填写 | 待填写 | 待填写 |

验证命令在 Work Edge 启动时已经由 Blueprint/Brief digest 冻结，不接受执行器在运行中改写。没有可执行检查的工作边使用人工或外部 readback adapter；模型自报只能形成 Proposal，不能更新 Fact。

# Role handoff

- 单一责任人且没有交接时省略本节和 frontmatter 中的 `handoff`。
- 这不是协作空间：Mapflow 只保存当前边与真实岗位之间的输入、输出和决策权接口。
- 默认只把 handoff 摘要交给相关岗位；具体实现和历史按 Context disclosure 条件加载。

# Context disclosure

- 简单边可省略本节和 frontmatter 中的 `context`；需要限制加载范围时再声明。
- Focus：一句话限定当前注意力。
- Load first：最多 5 个当前边必读入口。
- Load on demand：每组引用都声明触发条件；未触发时不加载。
- Budget：达到文件数或字符数上限就先摘要、分层或建立子地图，不继续堆入上下文。

# Failure and rollback

- 失败分支：replan / branch / stop
- 可回滚边界：
- 触发 proof gap 的条件：
