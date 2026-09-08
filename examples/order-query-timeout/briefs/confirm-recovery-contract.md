---
title: 确认重试与失败回退契约
edge: confirm-recovery-contract
contract:
  scope:
    in: [由人确认重试次数、超时预算、回退结果和幂等要求]
    out: [编写实现、发布生产、替业务 Owner 做路线取舍]
  authorization:
    required: [业务 Owner 明确确认恢复契约]
    allowed_actions: [记录决策、冻结验收场景和非目标]
  evidence:
    proves: [retry-policy-selected, fallback-policy-selected, idempotent-read, recovery-contract-approved]
    exit_conditions: [决策记录可回读且每项选择都有验收含义]
  failure:
    action: replan
    rollback: [撤销未批准的候选契约，不改变运行事实]
---

# 确认重试与失败回退契约

这是一条人工确认边。没有 Owner 决策记录时，预期效果不能当成已经确认的事实。
