---
edge: build-circulation-slice
title: 构建借还生命周期切片
contract:
  scope:
    in: [实现本地借出与归还并运行该切片的独立检查]
    out: [新增搜索, 跨切片集成, 多用户权限, 生产部署]
  authorization:
    required: []
    allowed_actions: [修改演示工作区的借还切片, 运行本地借还检查]
  handoff:
    from_roles: [产品, 技术负责人]
    to_roles: [前端, 后端, 测试]
    inputs: [冻结的领域模型, API 合同, 借还验收口径]
    outputs: [借还切片实现引用, 独立测试结果]
    decision_rights: [实现责任人决定切片内部实现, 测试决定切片检查是否通过]
  context:
    focus: 只交付不依赖目录实现输出的借出与归还切片
    load_first: [本 Task Brief, 冻结设计回执, 借还相关实现入口, 借还测试入口]
    load_on_demand:
      - { when: 状态机或接口约束无法满足时, refs: [API 合同, 领域模型, 失败输出] }
    budget: { max_files: 8, max_chars: 44000 }
  evidence:
    proves: [circulation-slice-ready]
    exit_conditions: [借出与归还在不消费目录切片实现输出时通过检查]
  verification:
    commands:
      - { id: build-circulation-slice-check, program: node, args: [-e, "const fs=require('fs');if(!fs.existsSync('.mapflow-demo/build-circulation-slice.ok'))process.exit(1)"], cwd: workspace, timeout_seconds: 30, success_exit_codes: [0], proves: [circulation-slice-ready] }
  failure:
    action: replan
    rollback: [只撤销未通过检查的借还切片改动]
---

# 构建借还生命周期切片

施工输入：`engineering-design-reviewed` 必须已经由设计评审边的实际证据建立。该边与目录切片共享的只有已经冻结的设计输入，不消费目录切片的实现产物。
