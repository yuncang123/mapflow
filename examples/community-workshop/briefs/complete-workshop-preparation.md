---
title: 完成工作坊准备
edge: complete-workshop-preparation
contract:
  scope:
    in: [通过独立子地图准备并验收场地和议程]
    out: [实际举办工作坊]
  authorization:
    required: [只接受已到达子地图的回执]
    allowed_actions: [读取本地子地图和接纳回执]
  evidence:
    proves: [workshop-ready]
    exit_conditions: [子地图到达回执通过父子 export 合同]
  failure:
    action: replan
    rollback: [保留子地图证据并修正绑定]
---

# 完成工作坊准备

父边不重复执行子图工作，只验证子图到达回执并接纳导出的事实。
