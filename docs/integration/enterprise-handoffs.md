# 企业岗位交接与上下文披露

仅在设计、执行或审查一条跨岗位 Work Edge 时加载本文。Mapflow 是个人 sidecar；这里定义对接合同，不建立团队协作空间，也不复制外部系统内容。

## 交接合同

Task Brief 可用一个紧凑合同把当前边接到真实岗位：

```yaml
contract:
  handoff:
    from_roles: [产品]
    to_roles: [后端, 前端, 测试]
    inputs: [已确认验收口径, 原型引用, 接口约束引用]
    outputs: [API 合同引用, 可测试构建引用, 风险回执]
    decision_rights:
      - 产品决定业务验收口径
      - 技术负责人决定跨服务合同
      - 测试负责人决定缺陷是否阻塞验收
```

五个字段都描述接口，不描述岗位日常工作。只有可引用、可观察且会影响本边前置或效果的内容才进入合同。

## 常见岗位接口

| 岗位 | 常作为输入 | 常作为输出 | 常见决策权 |
| --- | --- | --- | --- |
| 产品 | 用户问题、范围、验收口径 | 已确认需求、取舍记录 | 业务范围与验收语义 |
| 前端 | 交互合同、API 合同、状态模型 | 可测试界面、兼容性回执 | 客户端实现边界 |
| 后端 | 领域合同、数据/安全约束 | API、迁移与运行回执 | 服务与数据一致性方案 |
| 测试 | 验收合同、构建引用、风险清单 | 测试证据、缺陷引用、放行意见 | 测试充分性与阻塞判定 |
| 技术支持 | 工单、日志、现场环境事实 | 可复现证据、影响范围、回访结果 | 现场事实是否充分 |
| 领导/负责人 | 目标、成本、风险与外部依赖 | 优先级、预算或风险接受回执 | 资源、优先级与风险接受 |

岗位名称只是当前组织的标签。真正影响 Mapflow 的是 input、output、decision right 和 Evidence strength。

## 外部系统所有权

| 真相 | 拥有者 | Mapflow 保存 |
| --- | --- | --- |
| 需求/任务状态 | 企业 Issue 系统 | 稳定 ID、URL、必要字段摘要与 readback |
| 代码与 Review | Git/PR 平台 | commit/ref、path、review receipt |
| 构建与测试 | CI/测试平台 | run ID、结果、digest、覆盖的 Predicate |
| 发布与运行 | 发布/监控平台 | deployment ID、版本、健康 readback |
| 客户现场 | 工单/支持系统 | ticket ID、脱敏证据、确认人 |
| 资源或风险决定 | 正式审批/会议记录 | 决定引用、actor、适用范围 |

引用失效、权限不足或 readback 不一致时，对应 Fact 是 `unknown/conflict`；不得把 Task Brief 中的文字缓存当外部真相。

## Context Contract

```yaml
contract:
  context:
    focus: 只推进 API 合同达到前后端和测试可共同消费的状态
    load_first:
      - 本 Task Brief
      - Blueprint 中当前边及相邻节点
      - 已确认需求引用
    load_on_demand:
      - when: 出现接口兼容冲突
        refs: [旧版 OpenAPI, 调用方清单]
      - when: verifier 失败
        refs: [失败日志, 相关实现文件, 最近一次证据]
    budget: { max_files: 8, max_chars: 50000 }
```

- `focus` 只容纳一个当前注意力目标。
- `load_first` 最多五个入口；优先写索引或稳定引用，不复制正文。
- `load_on_demand` 的每组引用都必须有可判断的 `when`；未触发就不加载。
- `max_files/max_chars` 是当前 Work Edge 的上下文上限，不是项目总文档额度。

默认先运行 `mapflow context --layer focus`。只有需要执行面时加载 `work`，需要判断证据时加载 `evidence`，需要追责或重建因果链时加载有限 `history`。

## 超预算处理

预算将要超限时按顺序处理：

1. 把已读内容压成带来源的事实摘要；
2. 移除与当前 effects 无关的材料；
3. 把独立工作切成另一条 Work Edge；
4. 多步复杂工作建立 child map，只向父边导出 Acceptance 和 Predicate。

不要通过新增“产品版、前端版、测试版”重复文档解决超限；同一合同保持一个真源，不同岗位通过 handoff 字段读取自己的接口。
