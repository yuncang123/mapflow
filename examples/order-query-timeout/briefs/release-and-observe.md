---
title: 发布并回读订单查询修复
edge: release-and-observe
contract:
  scope:
    in: [按已批准窗口发布阶段 tag 并执行只读健康检查和指标回读]
    out: [扩展发布范围、修改无关服务、宣称长期业务成功]
  authorization:
    required: [release-authorized 已确认且回滚路径可用]
    allowed_actions: [受控发布、只读探针、读取指标、触发已批准回滚]
  evidence:
    proves: [production-observed]
    exit_conditions: [生产回读覆盖正常、重试和回退路径，且观察窗口内无新冲突]
  failure:
    action: replan
    rollback: [按已批准方案回滚，保留发布和回读记录]
---

# 发布并回读订单查询修复

只有真实发布后的回读证据才能产生 `production-observed`；逻辑可达不等于已经到达。
