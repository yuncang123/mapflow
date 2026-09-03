---
edge: build-interactive-board
title: 构建动态测绘台
status: ready
map: ../blueprint.yaml
contract:
  scope:
    in: [本地只读服务、ETag 轮询、Cytoscape 图、筛选、搜索、Inspector 和时间线]
    out: [业务写入、远程服务和账号系统]
  authorization:
    required: []
    allowed_actions: [vendor MIT 浏览器 bundle、新增本地静态资源和服务测试]
  evidence:
    proves: [board-live-refreshes, board-explorable]
    exit_conditions: [状态增量刷新不重排、拓扑变化重排、所有对象可下钻]
  failure:
    action: replan
    rollback: [移除 board 静态资源和服务入口]
---

# State transition

提供只绑定 `127.0.0.1` 的动态 HTML/Cytoscape 看板。所有工作内容以文本节点渲染，并提供键盘可达的元素列表。

# Evidence contract

- API、ETag、CSP、资源路由、过滤和 DOM 交互均有自动检查。
