---
edge: settle-audience
title: 明确文章读者
status: ready
map: ../blueprint.yaml
contract:
  scope:
    in: [收敛并记录目标读者]
    out: [撰写、批准或发布文章]
  authorization:
    required: []
    allowed_actions: [只读素材并访谈 Owner]
  evidence:
    proves: [audience-known]
    exit_conditions: [读者决策记录明确目标读者且无待决定项]
  failure:
    action: replan
    rollback: [保留读者为 unknown]
---

# State transition

- From：素材存在，读者未知
- To：素材和读者已明确
- Preconditions：素材存在，读者仍为 unknown
- Expected effects：`audience-known`

# Scope and boundary

- 只收敛并记录目标读者，不代替 Owner 自动选择受众。
- 非目标：撰写、批准或发布文章。
- 授权：只读素材并访谈 Owner，不包含外部写入授权。
- 执行器可以读取素材和访谈 Owner；不得发布文章。
- 与同源其他工作边之间不存在产出依赖。

# Evidence contract

| Evidence | Proves predicate | Observable exit condition |
| --- | --- | --- |
| 可回读的读者决策记录 | `audience-known` | 记录明确目标读者且无待决定项 |

# Failure

- 无法收敛读者时停止并 replan，不把 `unknown` 推定为已知。
