---
edge: design-api-contract
contract:
  scope:
    in: [为图书管理 MVP 建立 API 与持久化契约文档]
    out: [领域模型取舍、Node.js 实现、前端实现、跨切片集成]
  authorization:
    required: [Owner 对 API / 持久化设计边的单次授权]
    allowed_actions: [编写 API 路径与 payload 文档, 编写持久化边界文档, 标记兼容约束]
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
