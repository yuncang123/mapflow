---
title: 验收可读议程
edge: publish-agenda
contract:
  scope:
    in: [通过独立子地图回读并验收工作坊议程]
    out: [实际开放报名]
  authorization:
    required: []
    allowed_actions: [读取本地子地图和接纳到达回执]
  evidence:
    proves: [agenda-readable]
    exit_conditions: [议程子地图到达回执通过 export 合同]
  failure:
    action: replan
    rollback: [保留候选议程并修图]
---

# 验收可读议程

父边不重复执行议程检查，只回读孙图的到达、验收与证据并接纳导出事实；报名和活动效果仍在范围外。
