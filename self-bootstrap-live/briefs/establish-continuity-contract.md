---
title: 固定连续导航合同
edge: establish-continuity-contract
contract:
  scope:
    in: [Blueprint continuity schema, Arrival Checkpoint schema, 兼容迁移, 领域文档]
    out: [Board 视觉实现, 发布和部署]
  authorization:
    required: []
    allowed_actions: [编辑当前仓库, 运行本地测试]
  evidence:
    proves: [continuity-contract-established]
    exit_conditions: [旧 Arrival 可迁移成不可变 checkpoint, continuity 与前驱 receipt 可被确定性校验]
  verification:
    commands:
      - id: continuity-contract-check
        program: node
        args: [--test, tests/test_core_contract.mjs, tests/test_mapflow.mjs]
        cwd: workspace
        timeout_seconds: 120
        success_exit_codes: [0]
        proves: [continuity-contract-established]
  failure:
    action: replan
    rollback: [保留失败测试和前驱 Arrival，不改写历史]
---

# 固定连续导航合同

定义 Arrival Checkpoint、Successor Binding 和 Origin Snapshot 的最小稳定合同，并先以反例测试锁定不可变边界。
