---
title: 汇合验证活导航场
edge: prove-living-navigation
contract:
  scope:
    in: [兼容测试, successor 自举演示, 完整回归, benchmark doctor, evolution demo, 文档和模板一致性]
    out: [发布、推送、生产部署、真实用户价值结论]
  authorization:
    required: []
    allowed_actions: [编辑当前仓库, 运行本地确定性验证, 更新外部自举 Sidecar]
  evidence:
    proves: [continuity-contract-established, living-navigation-proven]
    exit_conditions: [旧 v0.8 状态兼容, Arrival 后漂移不撤销历史, 后继航段可运行, Board SSE 和回退通过, 完整回归为零退出]
  verification:
    commands:
      - id: living-navigation-check
        program: node
        args: [--test, tests/*.mjs]
        cwd: workspace
        timeout_seconds: 300
        success_exit_codes: [0]
        proves: [continuity-contract-established, living-navigation-proven]
  failure:
    action: replan
    rollback: [保留已验证边，仅修复失败子图]
---

# 汇合验证活导航场

最终证据只证明本地源码、测试和自举 Sidecar；不外推为发布、生产可用或市场成功。
