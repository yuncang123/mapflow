---
edge: run-deterministic-regression
title: 运行完整确定性回归
status: ready
map: blueprint.yaml
created: 2026-09-13
updated: 2026-09-14
contract:
  scope:
    in: [全部 Node 测试]
    out: [发布、生产和真人采用结论]
  authorization:
    required: []
    allowed_actions: [运行本地测试]
  handoff:
    from_roles: [Mapflow 维护者]
    to_roles: [测试]
    inputs: [已对齐的默认产品表面, 冻结测试入口]
    outputs: [完整回归退出码, 失败测试与最小修图范围]
    decision_rights: [测试结果决定是否进入测试包路线验证]
  context:
    focus: 只运行完整确定性回归并定位失败面
    load_first: [本 Task Brief, package.json, tests/]
    load_on_demand:
      - { when: 某个测试失败时, refs: [失败测试, 直接被测源码, 相关 fixture] }
    budget: { max_files: 16, max_chars: 90000 }
  evidence:
    proves: [full-regression-passes]
    exit_conditions: [node test runner 退出码为零]
  verification:
    commands:
      - id: full-regression-check
        program: node
        args: [--test, tests/*.mjs]
        cwd: workspace
        timeout_seconds: 180
        success_exit_codes: [0]
        proves: [full-regression-passes]
  failure:
    action: replan
    rollback: [按失败测试定位最小受影响子图]
---

# State transition

从核心表面对齐推进到完整确定性回归通过。
