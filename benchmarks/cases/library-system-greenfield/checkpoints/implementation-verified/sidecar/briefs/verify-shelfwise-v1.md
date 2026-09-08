---
edge: verify-shelfwise-v1
title: 验证 Shelfwise v1 完整合同
status: ready
map: ../blueprint.yaml
created: 2026-09-07
updated: 2026-09-07
contract:
  scope:
    in:
      - 运行自动化测试并用真实 npm start 进程执行 HTTP readback
      - 在本机浏览器逐项验证管理员核心工作流与响应式布局
      - 检查重启持久化、生产依赖和外部发布边界
      - 仅修复阻塞既定验收且不改变目的地合同的问题
    out:
      - 增加新的产品能力或 API
      - 外部部署、发布和外部系统写入
  authorization:
    required:
      - 当前工作边的独立人工施工授权
    allowed_actions:
      - 运行仓库测试与本机临时服务
      - 使用临时数据文件执行 API 和浏览器验收
      - 修改仓库内仅与既定验收阻塞直接相关的代码、测试和说明
  evidence:
    proves:
      - startup-and-page-verified
      - registration-workflows-verified
      - loan-lifecycle-verified
      - restart-persistence-verified
      - required-api-contract-verified
      - production-dependency-policy-verified
    exit_conditions:
      - A1 至 A6 均有通过记录并能回指实际命令或浏览器观察
      - 临时数据文件重启 readback 一致
      - package.json 的生产 dependencies 为空
      - 未发生外部发布、部署或外部写入
  failure:
    action: replan
    rollback:
      - 停止临时服务并删除仅用于验收的临时数据
---

# State transition

- From：`admin-app-ready`
- To：`shelfwise-v1`
- Preconditions：`persistent-library-api-ready=true` 且 `admin-browser-workflows-ready=true`
- Expected effects：六项 Shelfwise v1 目的地验收 Predicate 均由实际证据证明

# Scope

## In scope

- A1：以临时环境变量启动服务并读取 `/`。
- A2：通过页面和 API 登记单册图书及读者。
- A3/A4：借阅、有效借阅查询、归还和非法重复操作。
- A5：停止并使用同一数据文件重启后的完整回读。
- A6：指定 HTTP 合同、自动化测试和零第三方生产依赖检查。

## Out of scope

- 对验收合同之外的功能做顺手扩展。
- 任何外部发布、生产部署或外部系统写入。

# Execution boundary

- 执行器或责任人：当前获授权的 Codex Edge Run。
- 允许写入或外部动作：本仓库内的验收阻塞修复、本机临时端口、临时数据文件和浏览器。
- 所需授权：该边的新鲜施工授权。
- 与同源其他边共享的只有起始状态；不存在未建模的产出依赖。

# Evidence contract

| Evidence | Proves predicate | Observable exit condition |
| --- | --- | --- |
| `npm test` 与真实 `npm start` HTTP readback | 启动、登记、借阅、重启、API 和依赖策略 Predicate | A1-A6 自动化检查全部通过 |
| 本机浏览器桌面与窄屏操作记录 | 页面、登记和借阅生命周期 Predicate | 页面可见、可操作、无重叠且状态回读正确 |

# Failure and rollback

- 失败分支：`replan`
- 可回滚边界：停止验收进程并删除临时验收数据；保留历史证据，不把失败包装成通过。
- 触发 proof gap 的条件：任一 A1-A6 缺少真实通过证据，或修复需要改变已确认目的地。
