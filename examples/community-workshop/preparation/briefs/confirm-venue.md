---
title: 确认工作坊场地
edge: confirm-venue
contract:
  scope:
    in: [取得可回读的场地确认]
    out: [支付真实场地费用]
  authorization:
    required: [Owner 确认示例回执]
    allowed_actions: [记录本地示例凭据]
  evidence:
    proves: [venue-confirmed]
    exit_conditions: [场地确认记录可读取]
  failure:
    action: stop
    rollback: [不使用未确认场地]
---

# 确认工作坊场地

只登记实际可读取的确认记录；期望地点不能当作已确认场地。

