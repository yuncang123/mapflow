---
edge: review-engineering-design
contract:
  scope:
    in: [对领域模型文档与 API / 持久化契约进行一致性评审并冻结实施输入]
    out: [任何产品代码、前端实现、生产部署、范围扩张]
  authorization:
    required: [Owner 对设计评审边的单次授权]
    allowed_actions: [逐项核对文档, 记录冲突, 确认实施前置条件]
  evidence:
    proves: [engineering-design-reviewed]
    exit_conditions: [两份文档均存在、相互一致、范围和非目标明确，并留下评审记录]
  verification:
    commands:
      - { id: review-engineering-design-check, program: node, args: [-e, "const fs=require('fs');if(!fs.existsSync('.mapflow-demo/review-engineering-design.ok'))process.exit(1)"], cwd: workspace, timeout_seconds: 30, success_exit_codes: [0], proves: [engineering-design-reviewed] }
  failure:
    action: replan
    rollback: [保留冲突列表，暂停所有编码边]
---

# 评审并冻结工程设计文档

只有领域模型和 API / 持久化契约两条独立边都留下文档证据，才执行这条汇合边。评审记录必须指出冲突如何处理，以及实现切片共同遵守的输入；没有评审通过证据时，任何编码边都不应开放。
