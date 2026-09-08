---
edge: implement-library-mvp
contract:
  scope:
    in: [实现本地新增、搜索、借出、归还并运行自动检查]
    out: [多用户权限, 云同步, 生产部署]
  authorization:
    required: [Owner 对本地实施的单次授权]
    allowed_actions: [修改演示工作区, 运行本地检查]
  evidence:
    proves: [mvp-built, tests-pass]
    exit_conditions: [四个核心动作通过自动检查]
  failure:
    action: replan
    rollback: [撤销未通过检查的演示改动]
---

# 实现图书管理 MVP

实现面严格限制在已经确认的核心旅程。
