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
  evidence:
    proves: [article-drafted, sensitive-content-checked]
    exit_conditions: [候选稿与检查记录均可读取且版本对应]
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
