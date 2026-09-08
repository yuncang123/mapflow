---
title: 授权订单查询修复发布
edge: authorize-release
contract:
  scope:
    in: [审阅场景矩阵、发布窗口和回滚方案并记录 Owner 授权]
    out: [替 Owner 做发布决定、直接执行生产发布]
  authorization:
    required: [值班 Owner 明确批准发布窗口]
    allowed_actions: [记录授权、核对回滚准备]
  evidence:
    proves: [release-authorized]
    exit_conditions: [授权记录包含版本、窗口、观察指标和回滚触发条件]
  failure:
    action: stop
    rollback: [不启动生产发布]
---

# 授权订单查询修复发布

这条边只产生授权事实，不把授权等同于发布成功。
