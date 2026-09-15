---
name: mapflow
description: "为显式启用的任务建立并维护清晰可靠的导航图；仅在用户明确调用 Mapflow 时使用。"
---

# mapflow

Mapflow 的用户级入口路由。本仓库维护副本：`docs/workflow.md`；用户级安装包：`references/workflow.md`。

它是服务人的工作区外 sidecar，可以用于任意任务，但不会自动介入。只有用户显式输入 `$mapflow`、`启用 mapflow` 或 `进入地图优先模式` 后才运行本流程。

维护仓库使用 `../../tools/mapflow.mjs`；用户级安装包使用 `runtime/mapflow.mjs`。

## 入口动作

1. **恢复 Sidecar**：首次启用运行 `enable --root <当前工作目录> --json`；已启用回合不要用聊天记忆判断状态。完成条件：身份与路径可回指，目标工作区未新增 `.mapflow` 或其他 Mapflow 文件。
2. **加载唯一 Head**：首次 enable 后立即运行、以后每个 Mapflow 回合的第一项动作都运行 `snapshot --root <当前工作目录> --json`。只以这次返回的 `head.revision`、Focus、当前问题和下一动作作为本轮依据；runtime 不兼容时停止写入并报告版本/build digest。完成条件：Workspace Head、源文件摘要和 runtime identity 已验证。
3. **只加载 Focus**：运行 `context --root <当前工作目录> --layer focus --expected-revision <head.revision> --json`；没有正式地图时读取 snapshot 指向的当前 Wayfinding 问题。完成条件：能用普通任务语言说明想完成的结果、当前位置和唯一当前问题或下一步，不要求用户理解内部术语。
4. **定形和建图**：无 Blueprint 时读取 `destination-shaping`，从与任务相关的文档、现场观察、人员或外部系统固定四值起始 Fact；只有仓库事实会改变路线时才读取 `repository-recon`。展示完整 Destination Contract 并等待后续独立人工确认；只有这个对象需要建图前的强确认。确认后读取 `blueprint-planning`，把完整反向候选链一次投影给人审阅，再读取 `edge-slicing` 补齐各边合同。候选节点/边无需逐项审批。完成条件：Destination 已确认，候选链闭合，每条边有因果与 Evidence 合同；跨角色或上下文受限时再补 handoff/context，简单任务没有被强行展开。
5. **登记证明**：运行 `validate/prove`；新地图用 `init`，已有地图只对精确 diff 用 `replan`。完成条件：结构完整、推导图 digest 已产生，至少一条路线为 logical/conditional，或者得到带 repair scope 的明确缺口。
6. **确定性派发**：运行 `next-actions --expected-revision <head.revision> --json`。多条 ready edge 全部展示，由人选择；普通边执行 `start`，只有 Brief 声明授权要求时才创建 `request-authorization`。完成条件：最多一个 active Run，普通边没有被加上额外审批门。
7. **按需施工**：有 active edge 时才加载 `context --layer work --expected-revision <head.revision>` 并读取 `edge-delivery` 阶段参考；失败诊断、证据判定或追责分别加载 Evidence/History，不预读。维护仓库中的阶段说明位于 `../<name>/SKILL.md`；用户级安装包内含阶段参考位于 `references/skills/<name>.md`。完成条件：可信 witness 更新 Fact，reported 观察不更新 Fact，上下文未越过 Brief 预算。
8. **独立到达审计**：`next-actions` 指向到达时，创建 `request-arrival-audit`、展示冻结验收并结束当前回答。收到后续指定 `human:*` 或 `agent:*` auditor 回答时，先重新 snapshot，再使用该请求和新 revision 执行 `arrive`。完成条件：请求、回答和 arrival event 因果链完整，同一回答没有创建并消费请求。
9. **连续航段**：Arrival 后运行绑定 Head 的 `next-actions`；只有人给出新的完整 Destination 时才制作带 `continuity` 的追加式 Blueprint，并用 `continue` 绑定最新 checkpoint。完成条件：同一 map identity、旧节点/边/证据/checkpoint 未变、易漂移 Fact 已重新观测、Successor Binding 与新 ready/proof 状态可回读。

回答已登记的建模问题时使用 `wayfinding-answer --question <id> --answer <text> --evidence-ref kind:ref`，不要只留在聊天记录。

任何正式写入前都再次运行 `snapshot --root`，并把刚读到的 revision 作为 `--expected-revision`；即使上一条写回执已返回新 revision，也不跳过这一步。写后只接受 `write_receipt.readback=verified` 的新 revision。stale 或 runtime mismatch 时重新读取，不重试旧写入。

需要完整规则时按当前分支读取行为真源；入口 Skill 不复制状态模型和所有 CLI 细节。
