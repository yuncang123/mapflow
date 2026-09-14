---
edge: accept-library-mvp
contract:
  scope:
    in: [按核心旅程演示并记录 Owner 回读]
    out: [把演示等同于生产验收]
  authorization:
    required: [Owner 的演示授权与回答]
    allowed_actions: [运行本地演示, 记录回读]
  evidence:
    proves: [demo-accepted]
    exit_conditions: [Owner 可回读新增、搜索、借出、归还结果]
  verification:
    commands:
      - { id: accept-library-mvp-check, program: node, args: [-e, "const fs=require('fs');if(!fs.existsSync('.mapflow-demo/accept-library-mvp.ok'))process.exit(1)"], cwd: workspace, timeout_seconds: 30, success_exit_codes: [0], proves: [demo-accepted] }
  failure:
    action: replan
    rollback: [保留失败观察并局部修图]
---

# 验收图书管理 MVP

这条边证明演示目标，不证明部署、市场或长期使用价值。
