---
edge: integrate-library-slices
title: 集成并验证两个切片
contract:
  scope:
    in: [在两个独立切片均完成后接线并运行跨切片检查]
    out: [修改已经通过的切片合同, 人工演示验收, 生产部署]
  authorization:
    required: []
    allowed_actions: [连接两个切片, 运行本地集成检查]
  handoff:
    from_roles: [前端, 后端]
    to_roles: [测试, 技术支持]
    inputs: [目录切片回执, 借还切片回执, 冻结接口合同]
    outputs: [集成构建引用, 跨切片测试结果, 已知限制]
    decision_rights: [测试决定集成检查是否通过, 技术负责人决定合同冲突处置]
  context:
    focus: 只连接两个已独立通过的切片并验证组合旅程
    load_first: [本 Task Brief, 两个切片回执, 集成入口, 集成测试入口]
    load_on_demand:
      - { when: 跨切片检查失败时, refs: [失败输出, 两个切片实现, 冻结接口合同] }
    budget: { max_files: 9, max_chars: 50000 }
  evidence:
    proves: [integration-tests-pass]
    exit_conditions: [新增搜索借出归还的组合路径通过自动检查]
  verification:
    commands:
      - { id: integrate-library-slices-check, program: node, args: [-e, "const fs=require('fs');if(!fs.existsSync('.mapflow-demo/integrate-library-slices.ok'))process.exit(1)"], cwd: workspace, timeout_seconds: 30, success_exit_codes: [0], proves: [integration-tests-pass] }
  failure:
    action: replan
    rollback: [撤销集成接线并保留两个切片的独立通过证据]
---

# 集成并自动验证两个切片

只有 Join Node 的两个切片 Predicate 都成为实际事实后，该边才会前置就绪；它保留并验证前置设计评审状态，不重新定义任何设计或实现边的合同。
