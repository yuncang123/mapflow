---
name: mapflow
description: "当用户明确说‘启用 mapflow’、‘进入地图优先模式’，或使用批准地图、执行工作边、重新规划、到达审计语句时，加载证据驱动的地图优先工作流。仅在这些入口语义明确时触发。"
---

# mapflow

Mapflow 的用户级入口路由。本仓库维护副本：`docs/workflow.md`；用户级安装包：`references/workflow.md`。

维护仓库使用 `../../tools/mapflow.mjs`；用户级安装包使用 `runtime/mapflow.mjs`。

## 入口动作

1. 以当前工作目录为 `--root`，执行 `node <runtime> enable --root <当前工作目录> --json`。这是幂等的自动启用步骤：创建或恢复仓库外 Workspace Sidecar，并返回 Blueprint、Wayfinding、Brief、events 和 state 的绝对路径。全新 sidecar 会自动包含“始发地仍在迷雾中”“目的地仍在迷雾中”和一个指向始发候选的勘探问题；它们不是正式 Blueprint，也不存在连接边。完成条件：命令成功，能够读取返回的 `workspace_root`、`sidecar`、`paths`、`formal_topology` 和 `wayfinding.current_question`。不得在目标工作区创建 `.mapflow`、复制 Skill、修改 `AGENTS.md` 或改动 Git。
2. 读取目标工作区自身的约定、行为真源，以及返回路径中已经存在的 Blueprint、events 和 state。完成条件：能够报告 Intent、目的地、四值事实、证明等级、活动 Edge Run、等待/阻塞项、子地图 receipt、满足的 State Node 和 proof gaps。仓库中的遗留 `.mapflow` 只报告，不自动导入、迁移或删除。
3. 没有 Blueprint 时，先从当前工作环境的权威来源固定起始 Fact；只有仓库型工作才加载 `repository-recon`。先回答并重写步骤 1 已创建的始发迷雾与勘探问题，不要另造第二套草稿。第一组事实确认后，把通用始发候选改为现场语义，并为当前唯一的收敛问题声明目标节点/边、目标 ID、目的和回答后更新的字段。`wayfinding.yaml` 同时最多有一个 `pending` 问题；未来节点和边只留在候选清单，当前问题经人回答、`wayfinding-answer` 留痕并更新草稿后，才建立下一个问题。然后加载 `destination-shaping`，把目标谓词、验收、不变量和 boundaries 写入候选目的地；目的地确认后再加载 `blueprint-planning` 逐项反推节点和边。每个候选先建立唯一目标问题，经带来源的明确人工回答后，`wayfinding-write` 才能升级为 `confirmed`。候选链闭合后用 `edge-slicing` 建立独立 Brief，再写入 Blueprint、执行 `validate/prove`；空白 Sidecar 用 `init` 首次登记，已有正式地图的局部修订用 `replan`。完成条件：看板能解释当前起点、完整目的地合同、唯一确认对象和候选链，正式地图通过结构校验并得到一次正向可达性结论。

勘探和目的地定形阶段不要创建 `origin → destination` 的占位工作边。初始问题指向始发候选；始发事实固定后，问题才直接指向 `destination`。只有目的地合同确认后，反向回归产生的具体里程碑和 Work Edge 才进入候选结构。

首次启用消息和其中附带的完整需求都只是定形输入，永远不能同时充当对 Mapflow 候选对象的人工确认。即使首轮已经写清功能、验收、约束和非目标，也必须先向人展示目的地候选合同，再等待一条后续、独立且明确引用该候选合同的确认消息。后续消息若只补充事实、约束或修改意见，也只能修订候选、重新展示完整合同并创建新的确认问题，不能同时确认尚未展示的修订版。收到带明确确认语义的回答前，`intent.status` 保持 `draft`、目的地保持 `pending`；不得进入 regression，不得创建正式 Blueprint、Task Brief 或业务实现。`继续`、`开始做吧`、`按计划来` 和模型自己声称“信息已经足够”都不是确认。有效确认必须通过一个指向 `destination` 的 wayfinding question 及其回答和来源引用留痕，`wayfinding-write` 会拒绝用纯事实补充把目的地升级为 confirmed。
4. 候选节点/边全部确认后，写入正式 Blueprint 并运行正向证明；然后用 `request-route-approval --question ... --decision-owner human:<identity>` 固定当前证明和责任人，把问题展示给人并结束本回合。旧状态的 pending 人工请求缺少责任人时，先按看板目标用 `assign-decision-owner --request ... --decision-owner human:<identity>` 补登，完成条件是原人工门恢复且没有被消费；三类人工门都由该 `decision_owner` 身份回答。候选确认不能兼作 Route Approval，也不能在创建请求的同一回合调用 `approve` 或创建施工授权。只有后续独立人工回答明确批准这条已证明路线，才能用 `approve --request ... --answer ... --actor human:<identity>` 只登记 Route Approval。没有 active Run 时，再对一条 ready/proven 边执行 `request-authorization --edge ... --question ... --decision-owner human:<identity>`，把返回的问题展示给人并停止；只有再下一条独立人工回答明确批准该边，才能用 `authorize --request ... --answer ... --actor human:<identity>` 激活一次 Edge Run。每条后续边、重试和失败备用边都重新请求，拒绝或含糊回答不启动工作。完成条件：Route Approval Request、人的路线回答、Route Approval、施工授权请求、人的施工回答、Decision 和 Edge Run 的因果链完整，同一回答没有跨门复用。
5. 已存在唯一 active Edge Run 时加载 `edge-delivery`；流式输入先建立 Proposal，子地图边回读 Arrival Receipt。边通过后先报告结果：通过最终到达预检时创建 Arrival Audit Request、展示问题并结束本回合；收到后续独立人工回答时，第一项运行时动作就是用该请求执行 `arrive`，此前不得运行 `prove`、`gate` 或其他写事件命令。未通过到达预检时，在同一回答末尾给出 replan、路线选择或下一条边的 pending 授权问题，不能停在没有下一对象的空闲态。维护仓库中的相邻 Skill 位于 `../<name>/SKILL.md`；用户级安装包内含 Skill 位于 `skills/<name>/SKILL.md`。完成条件：实际证据已绑定 run、edge、predicates、acceptance IDs 或有效 receipt，且人的下一动作明确；Arrival Audit Request、后续人工回答和 `arrival_audited` 事件的因果链完整，同一回答没有跨门复用。
6. 后续 CLI 命令继续使用同一 runtime，并以当前工作目录作为 `--root`；CLI 会解析同一 sidecar。Blueprint 局部修改后、再次 prove/approve 前，用 `replan --scope ... --changes ...` 登记精确 diff，保留既有 Evidence Record 和已验证 Work Edge 合同；replan 使 pending 授权失效并要求重新批准路线。

回答已登记的问题时，使用 `wayfinding-answer --question <id> --answer <text> [--evidence-ref kind:ref]` 更新同一 sidecar 的 `wayfinding.yaml`；不要只在聊天记录中回答。该命令只推进问题状态和草稿游标，不确认 Fact、不创建 Blueprint，也不跳过目的地确认或人工回归门。

入口 Skill 不复制完整阶段规则。普通开发请求没有明确入口语义时，不自动套用完整 Mapflow。

## 收敛提问格式

进入勘探、目的地定形或目标回归时，每次向用户提问前先用四行说明问题的建模落点：

```text
当前候选：<节点或边>
本轮目标：<target.kind> <target.id> · <target.label>
缺失条件：<为什么现在不能确认它>
回答后：<会更新 wayfinding 草稿或 Blueprint 的哪些字段>
问题：<一次只问一个会改变路线的取舍>
```

回答后立即更新 `wayfinding.yaml` 中的问题状态和证据引用，并刷新看板；只有完成这一步才能创建下一个 `pending` 问题。一个问题只确认一个节点或一条边，不得捆绑多个候选，也不要只写聊天笔记后宣称节点已建立。
