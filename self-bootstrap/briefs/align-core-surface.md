---
edge: align-core-surface
title: 收敛默认产品到唯一主链
status: ready
map: blueprint.yaml
created: 2026-09-13
updated: 2026-09-14
contract:
  scope:
    in: [runtime、看板、模板、Skills、行为文档、安装清单、岗位交接合同、渐进式上下文]
    out: [发布、推送、全局安装、删除旧状态兼容读取]
  authorization:
    required: []
    allowed_actions: [编辑仓库文件, 运行本地检查]
  handoff:
    from_roles: [产品目标所有者]
    to_roles: [Mapflow 维护者, 测试]
    inputs: [已确认的唯一主线, 当前仓库与旧语义失败面]
    outputs: [对齐后的运行时与文档引用, 核心合同测试结果]
    decision_rights: [目标所有者决定产品边界, 维护者决定仓库内实现]
  context:
    focus: 只清除默认产品旧岔路并补齐岗位与上下文合同
    load_first: [本 Task Brief, self-bootstrap/blueprint.yaml, README.md, docs/workflow.md, tests/test_core_contract.mjs]
    load_on_demand:
      - { when: 某个旧语义仍被测试或调用方引用时, refs: [对应源码, 对应测试, 历史兼容边界] }
    budget: { max_files: 12, max_chars: 70000 }
  evidence:
    proves: [default-product-core-only, enterprise-handoffs-usable, context-loading-bounded]
    exit_conditions: [核心表面、岗位交接和上下文预算契约测试通过]
  verification:
    commands:
      - id: core-surface-check
        program: node
        args: [--test, tests/test_core_contract.mjs]
        cwd: workspace
        timeout_seconds: 120
        success_exit_codes: [0]
        proves: [default-product-core-only, enterprise-handoffs-usable, context-loading-bounded]
  failure:
    action: replan
    rollback: [保留已完成的证明内核并只修订受影响表面]
---

# State transition

从因果内核已存在但产品仍有旧岔路，推进到默认产品只表达目的地反推闭环，并可用小型交接合同接入企业岗位、按需加载上下文。

# Evidence contract

`core-surface-check` 必须检查默认分发面，不把归档或旧状态兼容字段误判为活动产品能力。
