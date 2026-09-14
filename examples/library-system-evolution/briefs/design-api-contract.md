---
edge: design-api-contract
title: 形成 API 与持久化契约
contract:
  scope:
    in: [为图书管理 MVP 建立 API 与持久化契约文档]
    out: [领域模型取舍、Node.js 实现、前端实现、跨切片集成]
  authorization:
    required: []
    allowed_actions: [编写 API 路径与 payload 文档, 编写持久化边界文档, 标记兼容约束]
  handoff:
    from_roles: [产品, 后端]
    to_roles: [前端, 后端, 测试, 技术支持]
    inputs: [核心旅程决定, 已有接口与存储约束]
    outputs: [API 合同引用, 持久化合同引用, 错误语义]
    decision_rights: [后端负责人决定服务合同, 产品决定业务验收语义]
  context:
    focus: 只冻结跨岗位需要共同遵守的 API 与持久化合同
    load_first: [本 Task Brief, 核心旅程决定, 现有接口入口, 存储入口]
    load_on_demand:
      - { when: 兼容性或错误语义发生冲突时, refs: [调用方清单, 历史接口合同, 故障案例] }
    budget: { max_files: 8, max_chars: 42000 }
  evidence:
    proves: [api-contract-ready]
    exit_conditions: [请求响应、错误语义、重启持久化和环境变量边界均有可回读文档]
  verification:
    commands:
      - { id: design-api-contract-check, program: node, args: [-e, "const fs=require('fs');if(!fs.existsSync('.mapflow-demo/design-api-contract.ok'))process.exit(1)"], cwd: workspace, timeout_seconds: 30, success_exit_codes: [0], proves: [api-contract-ready] }
  failure:
    action: replan
    rollback: [保留契约冲突并阻止编码分支开放]
---

# 形成 API 与持久化契约

明确页面入口、书籍/读者/借阅/归还接口、查询参数、错误响应、数据文件和重启后的保留语义。该边只产生接口与持久化契约，不消费领域模型边的未声明输出，也不实现代码。
