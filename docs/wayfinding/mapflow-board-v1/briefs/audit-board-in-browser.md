---
edge: audit-board-in-browser
title: 浏览器质量审计
status: ready
map: ../blueprint.yaml
contract:
  scope:
    in: [桌面与窄屏布局、点击、搜索、筛选、刷新、stale 和可访问性基线]
    out: [真实用户研究、远程浏览器矩阵和市场效果]
  authorization:
    required: []
    allowed_actions: [运行本地服务和只读浏览器验收]
  evidence:
    proves: [board-automated-checks-pass, board-browser-accepted]
    exit_conditions: [自动测试通过且浏览器核心旅程无阻断问题]
  failure:
    action: replan
    rollback: [保留失败截图并返回受影响子图修复]
---

# State transition

在真实浏览器中验证地图能被理解和操作，修复阻断问题后重跑。结论只证明本地核心旅程，不冒充真实用户研究。

# Evidence contract

- 保存桌面与窄屏截图，验证节点/边 Inspector、筛选、搜索和动态刷新。
