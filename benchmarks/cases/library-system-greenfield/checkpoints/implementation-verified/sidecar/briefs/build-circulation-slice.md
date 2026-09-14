---
edge: build-circulation-slice
contract:
  scope:
    in: [实现本地借出与归还并运行该切片的独立检查]
    out: [新增搜索, 跨切片集成, 多用户权限, 生产部署]
  authorization:
    required: [Owner 对借还切片的单次授权]
    allowed_actions: [修改演示工作区的借还切片, 运行本地借还检查]
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
