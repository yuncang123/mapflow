---
edge: design-domain-model
title: 形成领域模型设计
contract:
  scope:
    in: [为图书、读者、借阅和归还建立领域模型文档]
    out: [API 路径、前端实现、借还代码、跨切片集成]
  authorization:
    required: []
    allowed_actions: [读取需求, 编写领域模型文档, 记录待决假设]
  handoff:
    from_roles: [产品]
    to_roles: [后端, 前端, 测试]
    inputs: [核心用户旅程决定, 业务术语与不变量]
    outputs: [领域模型文档引用, 未决假设清单]
    decision_rights: [产品决定业务语义, 技术负责人决定技术表达]
  context:
    focus: 只形成可供接口和实现消费的领域模型
    load_first: [本 Task Brief, 核心旅程决定, 业务术语入口]
    load_on_demand:
      - { when: 状态变化或业务不变量存在冲突时, refs: [需求原文, 既有模型, 冲突记录] }
    budget: { max_files: 7, max_chars: 36000 }
  evidence:
    proves: [domain-model-ready]
    exit_conditions: [实体、关系、状态变化和关键不变量均有可回读文档]
  verification:
    commands:
      - { id: design-domain-model-check, program: node, args: [-e, "const fs=require('fs');if(!fs.existsSync('.mapflow-demo/design-domain-model.ok'))process.exit(1)"], cwd: workspace, timeout_seconds: 30, success_exit_codes: [0], proves: [domain-model-ready] }
  failure:
    action: replan
    rollback: [保留设计讨论和失败假设，不进入编码]
---

# 形成领域模型设计

明确 Book、Reader、Loan 及归还后的状态变化，记录唯一性、借阅状态和持久化需要保持的不变量。该边只产生领域模型文档，不决定 API 形状，也不实现代码。
