---
edge: build-admin-browser-interface
title: 构建管理员浏览器界面
status: ready
map: ../blueprint.yaml
created: 2026-09-07
updated: 2026-09-07
contract:
  scope:
    in:
      - 在 GET / 提供单管理员浏览器管理页面
      - 提供图书登记、读者登记、借书、还书和有效借阅查询工作流
      - 使用原生 HTML、CSS 和浏览器 JavaScript 调用已验证 API
    out:
      - 改变已确认 API 与持久化合同
      - 多人权限、预约、推荐、收费和外部发布
  authorization:
    required:
      - 当前工作边的独立人工施工授权
    allowed_actions:
      - 修改 Shelfwise 仓库内的静态页面资源、服务入口和相关测试
      - 在本机浏览器和临时服务进程中验证交互
  evidence:
    proves:
      - admin-browser-workflows-ready
    exit_conditions:
      - 根页面在常用桌面和窄屏视口可操作
      - 五条管理员工作流均能通过页面完成并得到 API 回读
      - 加载、空状态、成功和错误反馈不互相遮挡
  failure:
    action: replan
    rollback:
      - 停止临时服务并保留已通过的 API 实现与证据
---

# State transition

- From：`library-api-ready`
- To：`admin-app-ready`
- Preconditions：`persistent-library-api-ready=true`
- Expected effects：`admin-browser-workflows-ready=true`

# Scope

## In scope

- 设计安静、紧凑、适合管理员重复操作的本地工作台。
- 将登记、借阅、查询和归还组织成清晰且可恢复的交互。
- 保证文本、表单、状态反馈在桌面与移动宽度下不重叠。

## Out of scope

- 新增用户账户、角色、预约、费用、通知或推荐。
- 重写或扩张服务端领域边界。

# Execution boundary

- 执行器或责任人：当前获授权的 Codex Edge Run。
- 允许写入或外部动作：仓库内前端资源、必要的本地静态服务接线与测试；本机浏览器操作。
- 所需授权：该边的新鲜施工授权。
- 与同源其他边共享的只有起始状态；不存在未建模的产出依赖。

# Evidence contract

| Evidence | Proves predicate | Observable exit condition |
| --- | --- | --- |
| 本机浏览器逐项操作记录与 API readback | `admin-browser-workflows-ready` | 管理员可从 `/` 完成五条核心工作流 |

# Failure and rollback

- 失败分支：`replan`
- 可回滚边界：仅回退本边未通过的界面改动，保留已验证后端状态。
- 触发 proof gap 的条件：既有 API 无法支撑已确认页面闭环，或界面在目标视口不可操作。
