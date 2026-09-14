---
edge: confirm-core-journey
title: 确认核心用户旅程
contract:
  scope:
    in: [确认新增、搜索、借出、归还这一条核心旅程]
    out: [设计全部未来功能]
  authorization:
    required: [Owner 对旅程边界的回答]
    allowed_actions: [记录决定]
  handoff:
    from_roles: [产品或任务所有者]
    to_roles: [前端, 后端, 测试]
    inputs: [已确认的 Destination Contract, 当前未知的核心旅程]
    outputs: [可回指的核心旅程决定, 明确非目标]
    decision_rights: [产品或任务所有者决定 MVP 核心旅程]
  context:
    focus: 只固定 MVP 的一条核心用户旅程及非目标
    load_first: [本 Task Brief, Destination Contract, 当前起始 Fact]
    load_on_demand:
      - { when: 岗位对旅程边界理解冲突时, refs: [需求原文, 决策记录] }
    budget: { max_files: 5, max_chars: 24000 }
  evidence:
    proves: [core-journey-known]
    exit_conditions: [核心旅程及非目标可回读]
  verification:
    commands:
      - { id: confirm-core-journey-check, program: node, args: [-e, "const fs=require('fs');if(!fs.existsSync('.mapflow-demo/confirm-core-journey.ok'))process.exit(1)"], cwd: workspace, timeout_seconds: 30, success_exit_codes: [0], proves: [core-journey-known] }
  failure:
    action: replan
    rollback: [保留问题并继续定形]
---

# 确认核心旅程

这条边只固定 MVP 的第一条端到端旅程，不实施功能。
