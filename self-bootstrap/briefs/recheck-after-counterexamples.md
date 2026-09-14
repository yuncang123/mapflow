---
edge: recheck-after-counterexamples
title: 在终态反例修复后重新验证当前工作树
status: ready
map: blueprint.yaml
created: 2026-09-14
updated: 2026-09-14
contract:
  scope:
    in: [历史证书跨 replan 保留、终态因果与运行证据投影、全部正式 tests]
    out: [发布、生产和真人采用结论]
  authorization:
    required: []
    allowed_actions: [运行本地测试]
  handoff:
    from_roles: [Mapflow 维护者]
    to_roles: [测试, 产品目标所有者]
    inputs: [两条终态反例及修复, 冻结测试入口]
    outputs: [当前工作树完整回归退出码, 可进入 Arrival Audit 的证据]
    decision_rights: [测试结果决定是否创建到达审计请求]
  context:
    focus: 只验证终态反例修复后的当前工作树
    load_first: [本 Task Brief, tests/test_mapflow.mjs, tests/test_proof.mjs, tools/mapflow.mjs, tools/mapflow-core.mjs]
    load_on_demand:
      - { when: 完整回归失败时, refs: [失败测试, 直接被测源码, 相关 fixture] }
    budget: { max_files: 12, max_chars: 70000 }
  evidence:
    proves: [current-worktree-regression-passes]
    exit_conditions: [正式 tests 目录完整回归退出码为零]
  verification:
    commands:
      - id: final-worktree-regression-check
        program: node
        args: [--test, tests/*.mjs]
        cwd: workspace
        timeout_seconds: 180
        success_exit_codes: [0]
        proves: [current-worktree-regression-passes]
  failure:
    action: replan
    rollback: [按失败测试定位最小受影响子图]
---

# State transition

从三条原始主链边已有证据但终态反例刚完成修复，推进到当前工作树重新通过完整确定性回归。
