---
title: 实现后继航段运行时
edge: implement-successor-runtime
contract:
  scope:
    in: [continue 命令, 同 map identity 追加式迁移, Fact 漂移重算, next-actions]
    out: [自动选择新目的地, 自动改写正式拓扑, 外部动作]
  authorization:
    required: []
    allowed_actions: [编辑当前仓库, 运行本地测试, 更新外部自举 Sidecar]
  evidence:
    proves: [successor-runtime-operational]
    exit_conditions: [audited Arrival 可显式承接为新起点, 旧边和证据摘要不变, 事实更新自动刷新路线状态]
  verification:
    commands:
      - id: successor-runtime-check
        program: node
        args: [--test, tests/test_mapflow.mjs]
        cwd: workspace
        timeout_seconds: 120
        success_exit_codes: [0]
        proves: [successor-runtime-operational]
  failure:
    action: replan
    rollback: [撤销未验证运行时代码，保留 checkpoint 测试证据]
---

# 实现后继航段运行时

只通过显式 `continue` 消费已审计 Arrival；可信 Fact 仍经 Proposal/确认或执行验证进入运行态。
