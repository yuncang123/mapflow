---
edge: publish-article
title: 发布并回读文章
status: ready
map: ../blueprint.yaml
contract:
  scope:
    in: [发布已批准的候选稿并回读公开页面]
    out: [修改候选稿、扩大受众或改变批准内容]
  authorization:
    required: [Owner 批准回执与候选版本一致]
    allowed_actions: [公开发布并读取发布结果]
  handoff:
    from_roles: [任务所有者]
    to_roles: [发布执行者, 技术支持]
    inputs: [候选稿版本, Owner 批准回执]
    outputs: [公开 URL, 发布 readback, 失败回执]
    decision_rights: [任务所有者决定发布授权, 发布执行者决定技术回滚]
  context:
    focus: 发布已批准版本并取得可审计 readback
    load_first: [本 Task Brief, 当前边及相邻节点, 候选稿版本, Owner 批准回执]
    load_on_demand:
      - { when: 发布或回读失败时, refs: [发布日志, 回滚说明, 运行状态] }
    budget: { max_files: 8, max_chars: 50000 }
  evidence:
    proves: [article-published, public-url-exists]
    exit_conditions: [公开 URL 可访问且正文与批准版本一致]
  verification:
    commands:
      - { id: publication-readback, program: node, args: [-e, "const fs=require('fs');const p='receipts/publication.json';if(!fs.existsSync(p)||!JSON.parse(fs.readFileSync(p,'utf8')).url)process.exit(1)"], cwd: workspace, timeout_seconds: 30, success_exit_codes: [0], proves: [article-published, public-url-exists] }
  failure:
    action: replan
    rollback: [保留失败回执并撤下不一致页面]
---

# State transition

- From：候选稿已批准
- To：文章已发布
- Preconditions：候选稿、敏感检查和 Owner 批准均成立
- Expected effects：`article-published`、`public-url-exists`

# Scope and boundary

- 只发布已经批准的候选稿，并回读公开页面。
- 非目标：修改候选稿、扩大受众或改变批准内容。
- 授权：仅在 Owner 批准回执与候选版本一致时允许公开发布。
- 公开发布是外部写入，执行前必须通过授权不变量。
- 与同源其他工作边之间不存在产出依赖。

# Evidence contract

| Evidence | Proves predicates | Observable exit condition |
| --- | --- | --- |
| 公开 URL 的发布回执和正文回读 | `article-published`, `public-url-exists` | URL 可访问且正文与批准版本一致 |

# Failure

- 发布或回读失败时停止并 replan；不得仅凭提交成功声明到达。
