# Mapflow 产品体验覆盖矩阵

`●` 是该案例的主验收目标，`○` 是伴随覆盖，空白表示不以该案例下结论。

| 案例 | 从零建图 | 目的地定形 | 人工确认 | 反向回归 | 正向证明 | 图分支/并行 | 实际施工 | 迷雾/修图 | 范围控制 | 子地图 | 子图历史 | 非代码证据 | 跨会话 | 看板可读性 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| library-system-greenfield | ● | ● | ● | ● | ● | ● | ● | ○ | ● |  |  |  |  | ● |
| library-reservation-brownfield |  | ○ | ● | ● | ● |  | ● | ○ | ● |  |  |  |  | ○ |
| order-timeout-diagnosis |  | ○ | ● | ○ | ● | ○ | ● | ● | ○ |  |  |  |  | ○ |
| scope-change-control | ○ | ● | ● | ○ | ● | ○ | ○ | ● | ● |  |  |  |  | ● |
| library-system-submaps | ○ | ● | ● | ● | ● | ○ | ○ | ○ | ○ | ● | ● |  |  | ● |
| community-workshop-noncode | ○ | ● | ● | ● | ● |  | ● | ○ | ● | ○ | ○ | ● |  | ○ |
| cross-session-resume | ○ | ○ | ● | ○ | ○ |  | ○ |  | ● |  |  |  | ● | ● |

## 结果与过程 Oracle

| 案例 | 独立结果 Oracle | 关键过程硬门 | 主要人工观察 |
| --- | --- | --- | --- |
| library-system-greenfield | 隐藏 HTTP 旅程检查 UI、登记、借还、查询与重启持久化 | 空 Sidecar、设计文档双分支与评审 Join、实现分支 AND 汇合、逐边 Evidence、Arrival | 模糊愿望是否自然长成包含设计网络、可并行且可控的路线 |
| library-reservation-brownfield | 既有测试 + 隐藏预约 FIFO、唯一性与旧接口检查 | 兼容性作为不变量，不用新功能绿灯覆盖回归 | 既有事实与新需求假设是否清楚分开 |
| order-timeout-diagnosis | 隐藏正常、瞬时超时、持续超时、非超时错误反例 | 根因保持 unknown、先探针、失败证据保留、最小 replan | 用户是否理解为什么此时诊断而不是直接改代码 |
| scope-change-control | 隐藏 CLI 检查添加、JSON 列表、CSV 与旧 share 缺席 | 变化先候选、人工确认、保留已验事实、最小差异 | 画板是否讲清保留/删除/新增/重证 |
| library-system-submaps | 绿地系统隐藏旅程 + 父级 receipt/stale 检查 | 子图独立到达、父边等 receipt、digest 当前、历史帧按 receipt revision 固定 | 收缩是否成为可解释摘要节点，实时/历史展开是否保留正确上下文 |
| community-workshop-noncode | 隐藏文档、预算和越权措辞检查 | 文档/会议/审批证据分离，发送/采购/预订无授权 | 非编码工作是否同样流畅且地图成本合理 |
| cross-session-resume | 隐藏归档、过滤列表与持久化检查 | workspace identity、证据/决策/拓扑恢复前后相同 | 新会话首答能否准确恢复且不重问、不施工 |

每条结果 Oracle 检查的是可观察合同，不要求固定文件组织、节点 ID 或唯一实现路线。过程硬门独立判定；产品结果通过不能抵消未确认入图、伪造 Evidence 或提前到达。

## 确定性内核硬门

`tests/test_core_contract.mjs` 固定默认产品只包含 Destination 回归、显式因果合同、五层证据和渐进式上下文；`tests/test_proof.mjs` 检查反向闭包、隔离事实世界、推导图与稳定 digest；`tests/test_mapflow.mjs` 用反例固定 reported pass 不改变 Fact、verifier 必须来自冻结 Brief、能力令牌绑定 map/brief/edge/run/verifier 且只能消费一次、实际非零退出码不能被调用方覆盖、多个 ready edge 由 `next-actions` 全量返回，以及普通边不产生多余授权门。这组 Runtime Oracle 不依赖模型，先于任何耗时 Agent 旅程运行。

## 回归节奏

### 本地或 PR 快速回归

1. 运行 `regression-plan`，得到受影响层和 segment。
2. Oracle 层运行 `npm run test:oracle` 与 `npm run benchmark:doctor`。
3. Runtime 层运行 `npm run test:runtime`；状态门通过后才进入 Agent 层。
4. Agent 层从冻结 checkpoint 启动一条陌生 Codex，只完成受影响阶段，目标预算 10–20 分钟。
5. `segment-passed` 只关闭本阶段风险，不进入完整旅程成功率。

### 单条发布预检

1. 先运行一条完整 `library-system-greenfield`，硬预算 60 分钟。
2. 未完成即记录当前 checkpoint 和瓶颈，不延长为多小时运行。
3. 单条完整通过后才投入三角色或全矩阵成本。

### 发布候选

1. 运行四条 core 旅程各一次。
2. 运行三个 extended 案例各一次。
3. 所有硬门通过，逐案生成报告。
4. 使用新上下文做 synthetic user precheck；它不替代上述确定性 Oracle。

发布候选报告必须保留每个案例的 `run.json`、`checks.jsonl`、`turns.jsonl`、`scores.jsonl`、`findings.jsonl`、`report.json` 和 `evidence/`。缺少轨迹或人工评分的运行只能算确定性检查，不能称为产品体验通过。

### 周期性稳定性回归

1. `library-system-greenfield`、`library-reservation-brownfield` 各运行三次。
2. 报告成功次数、P0/P1 次数、基础设施失败、体验分布和总轮数。
3. 不以一次漂亮演示替代稳定性。
