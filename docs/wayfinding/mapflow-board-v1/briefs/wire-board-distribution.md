---
edge: wire-board-distribution
title: 接入 CLI 与离线安装
status: ready
map: ../blueprint.yaml
contract:
  scope:
    in: [board CLI、项目安装器、README 和行为文档]
    out: [全局启动服务、发布 npm 包和修改目标仓库 AGENTS.md]
  authorization:
    required: []
    allowed_actions: [更新 CLI、安装清单、帮助文本和文档]
  evidence:
    proves: [board-distributable]
    exit_conditions: [安装后的目标仓库可离线启动相同看板]
  failure:
    action: replan
    rollback: [撤回未通过 smoke test 的安装入口]
---

# State transition

把 Board runtime、静态资源、Cytoscape 和许可证纳入项目级安装；全局 Skill 只提供入口，不持有项目运行状态。

# Evidence contract

- 临时目标项目安装后可启动 board API，并且不访问 CDN。
