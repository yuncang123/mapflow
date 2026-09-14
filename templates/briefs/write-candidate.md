---
edge: write-candidate
title: 撰写并检查候选文章
status: ready
map: ../blueprint.yaml
contract:
  scope:
    in: [撰写候选稿并完成敏感内容检查]
    out: [申请批准和公开发布]
  authorization:
    required: []
    allowed_actions: [修改候选稿和本地检查记录]
  handoff:
    from_roles: [产品或任务所有者]
    to_roles: [内容执行者, 审阅者]
    inputs: [受众决策记录, 素材引用]
    outputs: [候选稿引用, 敏感内容检查记录]
    decision_rights: [审阅者决定检查是否充分]
  context:
    focus: 产出与目标受众一致且完成敏感检查的候选稿
    load_first: [本 Task Brief, 当前边及相邻节点, 受众决策记录, 素材索引]
    load_on_demand:
      - { when: 出现敏感性或事实冲突时, refs: [原始来源, 检查规则] }
    budget: { max_files: 8, max_chars: 50000 }
  evidence:
    proves: [article-drafted, sensitive-content-checked]
    exit_conditions: [候选稿与检查记录均可读取且版本对应]
  verification:
    commands:
      - { id: candidate-review-check, program: node, args: [-e, "const fs=require('fs');if(!fs.existsSync('drafts/article.md')||!fs.existsSync('notes/sensitive-review.md'))process.exit(1)"], cwd: workspace, timeout_seconds: 30, success_exit_codes: [0], proves: [article-drafted, sensitive-content-checked] }
  failure:
    action: replan
    rollback: [保留原始素材并撤销未完成候选稿]
---

# State transition

- From：素材和读者已明确
- To：候选稿与敏感检查均完成
- Preconditions：素材和读者已明确
- Expected effects：`article-drafted`、`sensitive-content-checked`

# Scope and boundary

- 只形成候选稿并留下敏感内容检查记录，不申请批准、不发布。
- 非目标：申请批准和公开发布。
- 授权：仅修改候选稿和本地检查记录。
- 执行器可以修改候选稿及检查记录。
- 与同源其他工作边之间不存在产出依赖。

# Evidence contract

| Evidence | Proves predicates | Observable exit condition |
| --- | --- | --- |
| 候选稿和可回指该稿的检查记录 | `article-drafted`, `sensitive-content-checked` | 两份产物均可读取且版本对应 |

# Failure

- 素材不足或检查无法完成时停止并 replan。
