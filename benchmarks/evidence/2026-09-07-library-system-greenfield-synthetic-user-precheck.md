# Synthetic user precheck: library-system-greenfield 1.3.7

> 这是合成用户预检，不是真实用户研究，也不证明留存、付费、无障碍、生产可靠性或市场需求。

## 测试合同

- 问题：一个不了解 Mapflow 内部模型的人，能否只按业务对话完成空白建图、人工确认、逐边施工和独立到达审计？
- 目标用户：会描述业务但不了解 Mapflow 内部模型的个人开发者。
- 核心工作：从空仓库交付一个本机社区图书管理系统。
- 关键旅程：`启用 -> 目的地定形 -> 候选回归 -> 路线证明/批准 -> 逐边授权/验收 -> 到达审计`。
- 可观察接缝：Codex 回答、目标 Git、仓库外 Sidecar、事件链、隐藏功能 verifier 和 run report。
- 首次价值：第二轮结束前能指出目的地、当前迷雾和下一项确认对象。
- 预算：最多 14 轮、120 分钟。
- 决策人：当前 Mapflow 维护者。
- 允许写入：隔离目标仓库中的产品代码、仓库外 Sidecar、本仓库中的基准实现与本证据。
- 人类限定未知：真实长期使用意愿、跨项目收益、无障碍体验和市场需求。

## 面板与隔离

三个新评审分别采用低耐心、怀疑型和中性交互审计视角。每条有效旅程都使用全新随机 target、Sidecar 和 Codex session，并由 `agent-turn` 强制 `--disable memories --disable multi_agent`。默认 `workspace-write` 均因 Windows `CreateProcessWithLogonW failed: 1385` 失败，已分别保存为 `infrastructure-failed / incomplete`，随后用全新 run 从首轮统一降级为 `danger-full-access`。

一条额外 run `library-system-greenfield-20260907102943-a1dd51` 因 PowerShell 把逐对象确认截断成“我确认”而标记为 `operator-deviation`，不进入产品结论。

## 运行结果

| Run | 结果 | 完成位置 | 轮次 / 耗时 | 中位分 | Continue |
| --- | --- | --- | --- | ---: | ---: |
| `library-system-greenfield-20260907102542-259f5f` | `mapflow-failed / repair-and-retest` | 路线已批准，最终验证边仍 active | 12 / 7191 秒 | 14/15 | 7/12 |
| `library-system-greenfield-20260907102634-b4a0e9` | `budget-exhausted` | verifier 通过且有 pending Arrival Audit，但 Oracle 假失败 | 12 / 7560 秒 | 13/15 | 1/12 |
| `library-system-greenfield-20260907105939-fa6a3e` | `budget-exhausted` | 已验证 3/4 边，最后一边仅待授权 | 14 / 7209 秒 | 14/15 | 11/14 |

三条旅程均通过 `prepared`、`enabled-empty`、`destination-shaped`、`regression-proposed`、`route-proven` 和 `route-approved`。目的地确认、逐对象候选确认、正式路线证明、Route Approval 和施工授权没有混成一步；目标仓库均无 `.mapflow`。但三条都未完成 `arrived`，因此不能证明最终人工审计回答会在真实完整旅程中直接消费原 pending request。

首次价值分别出现在 485、601 和 650 秒。30 秒心跳已持续输出脱敏的 tool step、文件变化和 Agent 更新计数，解决了完全无反馈的问题；它没有降低总耗时。

## Findings

### P1: 关键旅程未在 120 分钟内闭环

三条有效旅程都没有完成 `arrived`。一条在 7191 秒时仍有活动验证边；两条分别达到 7560 秒和 7209 秒并触发预算失败。最长单轮达到 3652 秒。流程控制大体正确，但真实个人使用中很可能在得到最终价值前离开。

### Evaluator: 未跟踪文件被漏算

一条 run 的隐藏产品 verifier、3 条边和 A1-A6 Evidence 均通过，且已创建 pending Arrival Audit Request；产品文件全部为 untracked 时，旧观察器只运行 `git diff --name-only <baseline>`，错误得到 `repo.changed_paths=[]`。这是假阴性，不是产品实现失败。

修复后 `changed_paths` 合并 tracked diff 与 `git ls-files --others --exclude-standard`，并新增回归测试。

### Isolation: Git 基线提交泄露评测语义

`prepare` 曾把作者写成 `Mapflow Benchmark`，提交主题包含 `fixture: library-system-greenfield@1.3.7`。一名被测 Codex 通过正常 `git log` 看到该信息；它没有读取 Oracle、operator、rubric、评测目录或 Mapflow 源仓库，但严格盲测 framing 已受污染。因此全部 1.3.7 run 只能作为 development synthetic user precheck，不能作为发布候选证据。

修复后目标 Git 只显示中性的 `Local Developer <local-developer@example.invalid>` 和 `Initial project state`。suite 升到 1.4.4；greenfield 升到 1.3.8，其他六个案例因可见 Git 现场改变同步提升补丁版本。

## Gate

`repair-and-retest`。没有确认 P0；确认 1 个跨三条旅程复现的产品 P1：关键旅程无法在预算内闭环。另有一个 Oracle 假阴性和一个隔离缺口，均已确定性修复。

本次已经达到两轮产品修复/复测上限，不继续调 prompt 或重复运行同一合成路径。Mapflow 不能宣称发布就绪。下一轮应先减少默认旅程的回合与总延迟，再从中性 Git 基线运行全新的 greenfield 1.3.8；只有完整通过 `implementation-verified` 和 `arrived` 才能进入小规模真人测试。

## Human-only unknowns

真实项目中的长期收益、真实用户是否愿意持续等待、多类型任务的一致性、无障碍体验、留存、付费和市场需求仍需要真人证据。
