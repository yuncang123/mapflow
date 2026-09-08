---
edge: build-persistent-library-api
title: 构建持久化图书借阅 API
status: ready
map: ../blueprint.yaml
created: 2026-09-07
updated: 2026-09-07
contract:
  scope:
    in:
      - 建立 package.json 与 npm start 入口
      - 使用 Node.js 内置模块实现领域规则、SQLite 文件存储和指定 HTTP API
      - 使用临时数据文件验证错误原子性与重启恢复
    out:
      - 浏览器管理界面
      - 会员收费、电子书、推荐、预约和多人权限
  authorization:
    required:
      - 当前工作边的独立人工施工授权
    allowed_actions:
      - 修改 Shelfwise 仓库内的服务端源码、package.json 和自动化测试
      - 在本机以临时 PORT 和 LIBRARY_DATA_FILE 运行测试与服务
  evidence:
    proves:
      - persistent-library-api-ready
    exit_conditions:
      - 五个指定 API 均可由集成测试调用
      - 借阅与归还保持引用和单册状态一致性
      - 同一临时数据文件重启后回读一致
      - 当前 Node.js 可加载 node:sqlite 并打开数据库
      - package.json 没有第三方生产依赖
  failure:
    action: replan
    rollback:
      - 只清理本边创建的临时进程、端口和临时测试数据
---

# State transition

- From：`shelfwise-empty-repository`
- To：`library-api-ready`
- Preconditions：Git 仓库、Node.js 运行时和已确认目的地合同均存在
- Expected effects：`persistent-library-api-ready=true`

# Scope

## In scope

- 定义单册图书、读者和借阅记录的 SQLite schema、约束与稳定 ID。
- 使用事务完成借阅和归还，使失败请求不改变已确认数据。
- 实现 `POST /api/books`、`POST /api/readers`、`POST /api/loans`、`POST /api/returns` 与 `GET /api/loans?status=active`。
- 使用 Node.js 内置测试运行器覆盖正常路径、非法引用、重复借还与重启回读。

## Out of scope

- 根页面的操作体验与视觉设计。
- 任何外部部署或网络服务写入。

# Execution boundary

- 执行器或责任人：当前获授权的 Codex Edge Run。
- 允许写入或外部动作：仅仓库源码与本机临时验证资源。
- 所需授权：该边的新鲜施工授权。
- 与同源其他边共享的只有起始状态；不存在未建模的产出依赖。

# Evidence contract

| Evidence | Proves predicate | Observable exit condition |
| --- | --- | --- |
| `node:sqlite` 探针、Node 内置集成测试与重启回读记录 | `persistent-library-api-ready` | 内置 SQLite、API、领域规则、事务回滚和文件持久化均通过 |

# Failure and rollback

- 失败分支：`replan`
- 可回滚边界：停止本机进程并删除本边创建的临时测试数据，不触碰用户既有数据。
- 触发 proof gap 的条件：当前 Node.js 无法稳定加载 `node:sqlite`、内置模块无法满足已确认 HTTP 或持久化合同，或实现需要第三方生产依赖。
