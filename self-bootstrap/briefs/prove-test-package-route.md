---
edge: prove-test-package-route
title: 在测试包中走通完整演化路线
status: ready
map: blueprint.yaml
created: 2026-09-13
updated: 2026-09-14
contract:
  scope:
    in: [图书系统演化 fixture、真实 CLI 状态推进、Evidence 和 Arrival]
    out: [真实用户采用、生产发布和市场价值]
  authorization:
    required: []
    allowed_actions: [在系统临时目录运行演化测试]
  handoff:
    from_roles: [Mapflow 维护者, 测试]
    to_roles: [产品目标所有者]
    inputs: [已通过的完整回归, 演化 fixture 的 Destination Contract]
    outputs: [测试包 audited Arrival, 五层证据边界说明]
    decision_rights: [测试包只判定产品链路, 目标所有者判断是否接受最终审计]
  context:
    focus: 只验证测试包能从目的地建图并沿可信边抵达
    load_first: [本 Task Brief, tools/evolution-demo.mjs, examples/library-system-evolution/blueprint.yaml, 演化 Brief 摘要]
    load_on_demand:
      - { when: 演化路线失败时, refs: [失败事件, 当前 state, 对应 verifier 输出] }
    budget: { max_files: 10, max_chars: 60000 }
  evidence:
    proves: [test-package-route-passes]
    exit_conditions: [演化 demo 退出码为零并报告 audited Arrival]
  verification:
    commands:
      - id: evolution-route-check
        program: node
        args: [tools/evolution-demo.mjs, --no-serve]
        cwd: workspace
        timeout_seconds: 180
        success_exit_codes: [0]
        proves: [test-package-route-passes]
  failure:
    action: replan
    rollback: [保留完整测试证据并只修复演化链失败点]
---

# State transition

从完整回归通过推进到测试包中的整张地图实际到达。
