---
edge: obtain-owner-approval
title: 取得 Owner 发布批准
status: ready
map: ../blueprint.yaml
contract:
  scope:
    in: [请求并记录 Owner 对当前候选稿的批准]
    out: [修改候选稿或执行发布]
  authorization:
    required: [允许向 Owner 发起批准请求]
    allowed_actions: [发送批准请求并读取回执]
  handoff:
    from_roles: [内容执行者]
    to_roles: [任务所有者]
    inputs: [候选稿版本, 敏感内容检查记录]
    outputs: [绑定候选版本的批准或拒绝回执]
    decision_rights: [任务所有者决定是否允许进入发布边]
  context:
    focus: 只取得当前候选版本的明确决定
    load_first: [本 Task Brief, 当前边及相邻节点, 候选稿版本, 敏感内容检查记录]
    load_on_demand:
      - { when: 决定附带修改条件时, refs: [修改意见, 原验收合同] }
    budget: { max_files: 6, max_chars: 30000 }
  evidence:
    proves: [owner-approved]
    exit_conditions: [批准回执明确绑定当前候选稿版本]
  verification:
    commands:
      - { id: owner-approval-readback, program: node, args: [-e, "const fs=require('fs');if(!fs.existsSync('notes/owner-approval.md'))process.exit(1)"], cwd: workspace, timeout_seconds: 30, success_exit_codes: [0], proves: [owner-approved] }
  failure:
    action: stop
    rollback: [保留未批准状态且不执行发布]
---

# State transition

- From：候选稿与敏感检查均完成
- To：候选稿已批准
- Preconditions：候选稿和敏感检查记录存在
- Expected effects：`owner-approved`

# Scope and boundary

- 只请求并记录 Owner 对当前候选稿的明确批准，不代表 Owner 作决定。
- 非目标：修改候选稿或执行发布。
- 授权：允许发起批准请求，不允许替代 Owner 批准。
- 这是外部授权动作；没有可回读回执时不得继续发布。
- 与同源其他工作边之间不存在产出依赖。

# Evidence contract

| Evidence | Proves predicate | Observable exit condition |
| --- | --- | --- |
| 可回指候选稿版本的批准回执 | `owner-approved` | Owner 明确批准当前版本公开发布 |

# Failure

- 未批准、超时或回执版本不符时停止。
