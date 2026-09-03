---
edge: compile-board-model
title: 编译可信 BoardModel
status: ready
map: ../blueprint.yaml
contract:
  scope:
    in: [Blueprint、runtime state、Brief 和 Evidence 到只读 BoardModel 的映射]
    out: [浏览器视觉实现和业务写入]
  authorization:
    required: []
    allowed_actions: [新增纯编译模块、fixture 和单元测试]
  evidence:
    proves: [projection-truth-preserved, board-model-ready]
    exit_conditions: [四值事实、proof、节点、边、验收和证据均有确定投影]
  failure:
    action: replan
    rollback: [移除未接入的编译模块]
---

# State transition

把 v0.3 正式事实编译成稳定、无业务写能力的 BoardModel。状态缺失时投影 Blueprint 起始事实；注册 digest 不一致时使用冻结 snapshot 并标记 stale。

# Evidence contract

- 单元测试覆盖节点/边状态、candidate/proven、Brief、Evidence、Acceptance、Proof Gap 和 stale fallback。
