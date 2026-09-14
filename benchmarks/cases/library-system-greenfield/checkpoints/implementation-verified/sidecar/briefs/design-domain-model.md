---
edge: design-domain-model
contract:
  scope:
    in: [为图书、读者、借阅和归还建立领域模型文档]
    out: [API 路径、前端实现、借还代码、跨切片集成]
  authorization:
    required: [Owner 对领域模型设计边的单次授权]
    allowed_actions: [读取需求, 编写领域模型文档, 记录待决假设]
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
