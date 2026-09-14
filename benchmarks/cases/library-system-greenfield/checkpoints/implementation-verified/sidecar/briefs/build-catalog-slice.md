---
edge: build-catalog-slice
contract:
  scope:
    in: [实现本地新增与搜索并运行该切片的独立检查]
    out: [借出归还, 跨切片集成, 多用户权限, 生产部署]
  authorization:
    required: [Owner 对目录切片的单次授权]
    allowed_actions: [修改演示工作区的目录切片, 运行本地目录检查]
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
