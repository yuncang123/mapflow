---
edge: confirm-core-journey
contract:
  scope:
    in: [确认新增、搜索、借出、归还这一条核心旅程]
    out: [设计全部未来功能]
  authorization:
    required: [Owner 对旅程边界的回答]
    allowed_actions: [记录决定]
  evidence:
    proves: [core-journey-known]
    exit_conditions: [核心旅程及非目标可回读]
  failure:
    action: replan
    rollback: [保留问题并继续定形]
---

# 确认核心旅程

这条边只固定 MVP 的第一条端到端旅程，不实施功能。
