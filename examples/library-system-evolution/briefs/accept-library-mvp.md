---
edge: accept-library-mvp
title: 验收图书管理 MVP
contract:
  scope:
    in: [按核心旅程演示并记录 Owner 回读]
    out: [把演示等同于生产验收]
  authorization:
    required: [Owner 的演示授权与回答]
    allowed_actions: [运行本地演示, 记录回读]
  handoff:
    from_roles: [前端, 后端, 测试]
    to_roles: [产品或任务所有者, 技术支持, 领导]
    inputs: [集成构建引用, 自动检查结果, 已知限制]
    outputs: [核心旅程验收回执, 非目标与剩余风险]
    decision_rights: [产品或任务所有者决定 MVP 演示是否通过]
  context:
    focus: 只按核心旅程验收本地 MVP，不外推生产或市场结论
    load_first: [本 Task Brief, 核心旅程, 集成构建, 自动检查摘要, 已知限制]
    load_on_demand:
      - { when: 演示结果与自动检查冲突时, refs: [失败输出, 相关实现, 证据历史] }
    budget: { max_files: 9, max_chars: 48000 }
  evidence:
    proves: [demo-accepted]
    exit_conditions: [Owner 可回读新增、搜索、借出、归还结果]
  verification:
    commands:
      - { id: accept-library-mvp-check, program: node, args: [-e, "const fs=require('fs');if(!fs.existsSync('.mapflow-demo/accept-library-mvp.ok'))process.exit(1)"], cwd: workspace, timeout_seconds: 30, success_exit_codes: [0], proves: [demo-accepted] }
  failure:
    action: replan
    rollback: [保留失败观察并局部修图]
---

# 验收图书管理 MVP

这条边证明演示目标，不证明部署、市场或长期使用价值。
