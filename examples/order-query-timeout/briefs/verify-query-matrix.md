---
title: 验收订单查询场景矩阵
edge: verify-query-matrix
contract:
  scope:
    in: [执行正常、下游超时重试和持续失败回退三组可重复检查]
    out: [生产发布、修改验收阈值、忽略失败结果]
  authorization:
    required: [允许使用隔离测试数据和模拟下游]
    allowed_actions: [运行测试、读取结果、记录回读证据]
  evidence:
    proves: [normal-query-healthy, timeout-retry-correct, fallback-safe, scenario-matrix-passed]
    exit_conditions: [三组场景均有通过结果且幂等断言成立]
  failure:
    action: replan
    rollback: [保留失败报告，不将 expected effect 写入事实]
---

# 验收订单查询场景矩阵

三组场景必须分别可解释；总体通过不能掩盖任一失败分支。
