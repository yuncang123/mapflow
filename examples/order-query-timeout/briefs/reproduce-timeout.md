---
title: 复现并定位订单查询超时
edge: reproduce-timeout
contract:
  scope:
    in: [读取仓库、日志和可控测试环境，复现一次超时并定位责任边界]
    out: [修改业务代码、调整生产流量、改变超时预算]
  authorization:
    required: [允许读取本地仓库和脱敏观测记录]
    allowed_actions: [本地复现、只读日志分析、记录定位证据]
  evidence:
    proves: [incident-reproduced, timeout-cause-understood]
    exit_conditions: [复现步骤可重复且责任边界有可回读证据]
  failure:
    action: replan
    rollback: [删除临时复现数据，不修改生产配置]
---

# 复现并定位订单查询超时

完成这条边只建立问题事实，不提前选择重试或回退方案。
