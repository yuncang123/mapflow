---
edge: build-catalog-slice
title: 构建目录与搜索切片
contract:
  scope:
    in: [实现本地新增与搜索并运行该切片的独立检查]
    out: [借出归还, 跨切片集成, 多用户权限, 生产部署]
  authorization:
    required: []
    allowed_actions: [修改演示工作区的目录切片, 运行本地目录检查]
  handoff:
    from_roles: [产品, 技术负责人]
    to_roles: [前端, 后端, 测试]
    inputs: [冻结的领域模型, API 合同, 目录验收口径]
    outputs: [目录切片实现引用, 独立测试结果]
    decision_rights: [实现责任人决定切片内部实现, 测试决定切片检查是否通过]
  context:
    focus: 只交付不依赖借还实现输出的目录与搜索切片
    load_first: [本 Task Brief, 冻结设计回执, 目录相关实现入口, 目录测试入口]
    load_on_demand:
      - { when: 接口或领域约束无法满足时, refs: [API 合同, 领域模型, 失败输出] }
    budget: { max_files: 8, max_chars: 44000 }
  evidence:
    proves: [catalog-slice-ready]
    exit_conditions: [新增与搜索在不依赖借还切片时通过检查]
  verification:
    commands:
      - { id: build-catalog-slice-check, program: node, args: [-e, "const fs=require('fs');if(!fs.existsSync('.mapflow-demo/build-catalog-slice.ok'))process.exit(1)"], cwd: workspace, timeout_seconds: 30, success_exit_codes: [0], proves: [catalog-slice-ready] }
  failure:
    action: replan
    rollback: [只撤销未通过检查的目录切片改动]
---

# 构建目录与搜索切片

施工输入：`engineering-design-reviewed` 必须已经由设计评审边的实际证据建立。该边不消费借还切片的输出，也不承担跨切片集成；它只把冻结的领域/API 约定落实为目录与搜索切片。
