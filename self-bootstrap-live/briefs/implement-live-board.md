---
title: 实现实时活地图
edge: implement-live-board
contract:
  scope:
    in: [Board 投影, 历史 Arrival 与当前漂移, 完整路线默认镜头, SSE 通知与轮询回退]
    out: [可写 Board, 新图引擎, 远程消息基础设施]
  authorization:
    required: []
    allowed_actions: [编辑当前仓库, 启动本地只读 Board, 运行本地测试]
  evidence:
    proves: [live-board-operational]
    exit_conditions: [SSE 触发真实文件回读, 断流时低频轮询, 当前目的地和历史 Arrival 一目了然, 所有路线可见]
  verification:
    commands:
      - id: live-board-check
        program: node
        args: [--test, tests/test_board.mjs]
        cwd: workspace
        timeout_seconds: 120
        success_exit_codes: [0]
        proves: [live-board-operational]
  failure:
    action: replan
    rollback: [恢复低频轮询且保持 Board 只读]
---

# 实现实时活地图

SSE 只发送“真相版本变化”通知，前端收到后仍从只读 API 回读最新投影；文件系统通知丢失时由低频轮询兜底。
