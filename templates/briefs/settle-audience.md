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
  handoff:
    from_roles: [产品或任务所有者]
    to_roles: [内容执行者]
    inputs: [素材引用, 待确认受众问题]
    outputs: [受众决策记录]
    decision_rights: [任务所有者决定目标受众]
  context:
    focus: 只建立可回指的目标受众 Fact
    load_first: [本 Task Brief, 当前边及相邻节点, 素材索引]
    load_on_demand:
      - { when: 受众定义发生冲突时, refs: [访谈记录, 历史受众决定] }
    budget: { max_files: 6, max_chars: 30000 }
  evidence:
    proves: [audience-known]
    exit_conditions: [读者决策记录明确目标读者且无待决定项]
  verification:
    commands:
      - { id: audience-record-check, program: node, args: [-e, "const fs=require('fs');if(!fs.existsSync('notes/audience-decision.md'))process.exit(1)"], cwd: workspace, timeout_seconds: 30, success_exit_codes: [0], proves: [audience-known] }
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
