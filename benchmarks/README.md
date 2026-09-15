# Mapflow 产品体验持续回归

这套基准测试回答一个问题：

> 没有获得标准答案、Mapflow 内部文档或完成态地图的人，能否只通过自然语言与 Codex 协作，在 Mapflow 的帮助下清晰、准确、流畅、可控地完成真实项目或任务？

产品使命覆盖所有任务；本套件只抽样验证当前列出的任务类型。一个非编码案例或一组工程案例都不能证明普遍覆盖，新增任务族必须以独立结果 Oracle、过程硬门和真人可读性观察扩展证据。

自动测试证明机制，基准旅程证明体验。二者不能互相替代。

`library-system-greenfield` 的 `implementation-verified` 冻结包包含升级前的 Route Approval 历史事件，只用于证明新版运行时可把它们作为历史回放并继续 Arrival Audit；它不定义当前流程，也不允许恢复旧审批门。活动行为始终以 `docs/workflow.md` 和当前 Oracle 为准。

## 运行入口

### 日常开发：先选最小回归层

每次局部修改先让影响选择器给出最小验证集合：

```powershell
node tools/benchmark.mjs regression-plan --paths tools/mapflow.mjs
# 或按当前工作树自动判断
npm run benchmark:plan
```

回归按成本递增，后一级不能替代前一级：

| 层 | 证明什么 | 目标耗时 | 默认入口 |
| --- | --- | --- | --- |
| Oracle | 解析、断言、快照完整性、报告逻辑和案例包 | 约 1 分钟 | `npm run test:oracle` |
| Runtime | 状态转换、事件、Sidecar、看板、确定性 `next-actions`、一次性能力和真实 verifier；与 Oracle 合并并行运行 | 1–2 分钟 | `npm run test:regression` |
| Agent segment | 陌生 Codex 能否从合法 checkpoint 完成受影响阶段 | 10–20 分钟 | `segment-prepare` → `segment-turn` → `check` → `segment-report` |
| Release | 人能否完成整个产品体验旅程 | 先单条完整旅程，再完整矩阵 | 只有 `--level release` 显式选择 |

当前内置的 `library-system-greenfield:arrival-audit` segment 从已重新验过的 `implementation-verified` 联合快照开始。因为它故意启动全新陌生会话，`segment-turn` 会先加入公开恢复入口“启用 mapflow，继续当前地图”，再发送主线原本的到达审计回答。恢复入口只触发读取当前 Sidecar，不提供节点 ID、命令、期望事件或标准路线：

```powershell
$target = Join-Path $env:TEMP ("mapflow-segment-" + [guid]::NewGuid().ToString("N"))
node tools/benchmark.mjs segment-prepare --case library-system-greenfield --segment arrival-audit --target $target
node tools/benchmark.mjs segment-turn --run <run-id>
node tools/benchmark.mjs check --run <run-id> --checkpoint arrived
node tools/benchmark.mjs segment-report --run <run-id>
```

`segment-passed` 还要求冻结 revision 之后的新增事件与案例声明的事件序列完全一致；当前到达审计只能新增一次 `mapflow.arrival.audited.v1`。它只证明这一阶段的 Agent 行为。`report`、`smoke-report` 和 `suite-report` 都拒绝 segment run，因此它不能被误算成完整 Greenfield 或发布证据。

计划中的 Agent segment 永远只是 `covers` 声明所列阶段的定向覆盖。`regression-plan` 会同行显示 `TARGETED ONLY` 和实际覆盖项；未列出的 Agent 行为没有被这个 segment 验证，需要另一个 segment 或显式 Release 完整旅程。

`segment-turn` 是一次性尝试。命令开始时即写入 attempt 标记；无论子进程失败、命令被中断还是结果不通过，都保留该 run 的证据，并用新的空目标重新执行 `segment-prepare`。这避免在可能已经改变的目标或 Sidecar 上重复发送同一输入。`segment-report --outcome infrastructure-failed --outcome-evidence "<可复核错误>"` 只适用于尚未产生目标 checkpoint 检查或 Mapflow 增量的失败尝试。

| 中断位置 | 恢复动作 |
| --- | --- |
| `segment-turn` 未正常完成或返回失败 | 保留旧 run；创建新的空目标并重新执行 `segment-prepare`，不复用旧目标或 Sidecar |
| `check` 自身被中断、尚无完整结果 | 在同一个已完成 turn 的 run 上重新执行 `check` |
| `check` 返回失败 | 保留失败 run；修复后从新目标重新执行整个 segment |
| `segment-report` 被中断 | 在同一个 run 上重新执行 `segment-report` |

已有 run 的 observation 可以在数秒内重放当前断言逻辑：

```powershell
node tools/benchmark.mjs replay --run <run-id>
node tools/benchmark.mjs replay --run <run-id> --current-case
```

Replay 不启动 Agent、不执行 Runtime 动作、不重跑隐藏 verifier。它只证明录制 observation 在冻结或当前 Oracle 下是否得到一致判定。

### 10 分钟首次价值烟测

第一次使用先走图书系统的前三个 checkpoint：`prepared → enabled-empty → destination-shaped`。这里的 `enabled-empty` 指正式 Blueprint 仍为空，但画板已经显示两枚无连线的迷雾候选和当前问题。烟测验证问题是否围绕当前建模对象、目的地是否经人确认以及画板是否如实显示起点和终点；到这里即可运行：

```powershell
$target = Join-Path $env:TEMP ("mapflow-smoke-" + [guid]::NewGuid().ToString("N"))
node tools/benchmark.mjs prepare --case library-system-greenfield --target $target
node tools/benchmark.mjs check --run <run-id> --checkpoint prepared
  # 用 prepare 返回的 run_id 执行第一轮，命令自动在目标目录新建隔离 Codex 会话
  node tools/benchmark.mjs agent-turn --run <run-id> --turn opening --input-file <first-turn.txt>
node tools/benchmark.mjs check --run <run-id> --checkpoint enabled-empty
# 继续只回答模型主动提出的业务问题，确认目的地后检查
node tools/benchmark.mjs check --run <run-id> --checkpoint destination-shaped
node tools/benchmark.mjs smoke-report --run <run-id>
```

结果 `smoke-complete-needs-full-journey` 表示可以继续完整旅程，绝不表示案例、发布候选或产品体验已经通过。若缺少检查点，报告会给出下一条恢复命令；失败时应停止、保存证据并记录 finding。快速烟测不要求先理解整套矩阵，也不要求完成编码和逐边评分。

### 完整旅程

先确认案例包完整：

```powershell
npm run benchmark:doctor
node tools/benchmark.mjs list
```

为一次试验创建全新的目标工作区：

```powershell
$target = Join-Path $env:TEMP ("mapflow-benchmark-" + [guid]::NewGuid().ToString("N"))
node tools/benchmark.mjs prepare --case library-system-greenfield --target $target
```

`prepare` 只把 `subject/fixture/` 复制到目标目录并建立基线 Git 提交，不启用 Mapflow，不把主线、Oracle 或评分表复制到目标项目。它会在目标目录之外的本次评测目录冻结完整 case 包，后续 `probe`、`check` 和 `report` 始终读取该快照，不受源仓库中的 case 升版影响。命令返回本次 `run_id`、目标目录和冻结后的测试者主线文档。

推荐用 `agent-turn` 驱动独立的持久化 Codex 会话。它会固定使用 `prepare` 返回的 `target_root` 作为工作目录，只向子进程下传本次 run 固定的 `MAPFLOW_HOME`，并自动加上记忆/多 Agent 隔离参数；原始 JSONL、stderr、末条回答、session ID 和轮次记录会保存到 run evidence。测试者只逐轮发送 `operator/mainline.md` 中的“用户输入”，不附带本仓库文档、后续台词、节点 ID、命令或期望路线：

```powershell
node tools/benchmark.mjs agent-turn --run <run-id> --turn opening --input-file <first-turn.txt>
node tools/benchmark.mjs agent-turn --run <run-id> --turn destination-answer --session <session-id> --input-file <next-turn.txt>
```

`agent-turn` 的 stdout 最终只输出模型回答和可续接的 `session_id`；长轮次每 30 秒向 stderr 输出一条不含业务内容的心跳，并显示已观察到的 tool step、文件变更和 Agent 更新数量。这些计数只用于说明子进程仍在推进，不暴露业务内容，也不代表阶段已经通过。原始子进程输出仍只保存在 run artifact。普通后续轮必须传回同一 session；只有 `cross-session-resume` 案例声明的切换点才新建另一条会话。桌面应用手工测试仍可把 `target_root` 打开成新任务，但操作者必须自己保存轮次和验证隔离，不能与自动运行混为同一证据。

不熟悉 State Node、Work Edge 或 Evidence Contract 也不影响操作；是否确认只按[测试者确认清单](operator-checklist.md)里的普通问题判断。主线代码块使用业务语言，不教模型 Mapflow 的标准路线。

到达主线明确标出的 checkpoint 后，在 Mapflow 维护仓库运行隐藏检查。没有 checkpoint 的问答轮只记录和评分；重复施工时每轮记录，完成该阶段后再运行一次结果 checkpoint：

```powershell
node tools/benchmark.mjs check --run <run-id> --checkpoint <checkpoint-id>
```

默认输出是一屏人类摘要；需要完整机器字段时增加 `--json`。失败的隐藏 verifier 只显示失败结论，细节保存在 run evidence 中，不能把其路径、堆栈或修复线索发给被测模型。

动态重复轮次使用主线指定的只读 `probe` 判断 checkpoint 是否已经 ready，例如每次候选确认前检查 `regression-proposed`。`probe` 不运行隐藏 verifier、不写 `checks.jsonl` 或 evidence，`NOT READY` 也返回成功，因此不会把一次正常的中间状态污染成失败记录；只有 `READY` 后才运行正式 `check` 固化证据。

把实际输入、模型回答或任务链接和耗时写入本次运行记录；长回答建议先保存为临时文本，再用 `--response-file`：

```powershell
node tools/benchmark.mjs record --run <run-id> --turn <turn-id> `
  --input "<本轮实际发送的文字>" --response-file <response.txt> `
  --task-ref <task-id-or-link> --duration-seconds 45 --repeated-questions 0
```

首次观察到案例声明的 `expected_first_value` 后，标记刚刚完成的实际轮次；`agent-turn` 场景应在看完回答后执行，避免在调用前猜测：

```powershell
node tools/benchmark.mjs mark-first-value --run <run-id> --turn <turn-id> --note "可从回答和看板指出目的地、迷雾与下一确认对象"
```

手工 `record` 已经发生在观察之后，也可以直接增加 `--first-value`。报告会记录首次价值出现在哪一轮，以及从已记录轮次累计到该轮的秒数；原始轮次不被重写，事后标记追加保存在独立 annotation 记录中。

再按[评分锚点](rubric.md)记录人的体验：

```powershell
node tools/benchmark.mjs score --run <run-id> --turn <turn-id> --verdict continue `
  --clarity 3 --accuracy 3 --fluency 3 --control 3 --usefulness 3 `
  --note "能够说明当前状态、确认对象和下一步"
```

发现问题时记录可见证据与推断，二者分开：

```powershell
node tools/benchmark.mjs finding --run <run-id> --checkpoint <checkpoint-id> `
  --severity P1 --observed "未确认目的地就创建了正式工作边" `
  --inference "用户可能失去对范围的控制"
```

最后生成报告：

```powershell
node tools/benchmark.mjs report --run <run-id>
```

`report`、`smoke-report`、`segment-report` 和 `suite-report` 会先写出报告，再在门禁未通过时返回非零退出码，便于 CI 正确失败。只想生成中间报告而不影响脚本退出码时显式增加 `--no-fail`；它不会改变报告中的 gate。

报告会自动区分 `completed`、`task-failed`、`mapflow-failed`、`operator-deviation`、`budget-exhausted` 和尚未结束的 `in-progress`。若本轮因模型服务、Git、浏览器或本地运行环境终止，可显式使用 `--outcome infrastructure-failed --outcome-evidence "<可复核错误或外部状态>"`；该参数只改变归因并把 gate 保持为 `incomplete`，不会把失败 gate 改成通过，也不能覆盖 P0/P1、操作者偏差或超预算。

把一次发布候选的各案例报告聚合为矩阵门禁：

```powershell
node tools/benchmark.mjs suite-report --runs <run-a>,<run-b>,<run-c> --output <suite-report.json>
```

聚合器要求每个案例至多一个 run，并分别报告缺失的 core、extended 和未通过案例。`core-ready-for-small-human-test` 只代表四条 core 都完成；七条全部通过才可能得到 `release-candidate-ready-for-small-human-test`。

若任一 run 来自未提交的 Mapflow 工作树，单案例报告会保留 `benchmark_dirty` 警告。开发烟测和问题复现仍可继续，但矩阵聚合最多得到 `development-only-dirty-baseline`，不能作为固定版本的发布候选证据。

运行记录保存在独立的 `MAPFLOW_BENCHMARK_HOME/runs/<run-id>/`；默认位置也是 `MAPFLOW_HOME` 的同级目录，而不是其子目录。评测目录不进入被测项目 Git，也不能暴露给被测 Codex。每个 run 会固定记录自己的 Sidecar home，后续 `check` 不会因操作者终端中的 `MAPFLOW_HOME` 漂移而检查错工作区。

`agent-turn` 默认使用 `workspace-write`；如果 Windows 沙箱因系统策略无法启动，可以记录后显式增加 `--sandbox danger-full-access`，并在该会话的每次后续 `agent-turn` 中继续传入同一值。命令会把首轮沙箱参数转换成 resume 支持的配置覆盖，并把实际值写入证据。此时仍需逐项检查 JSONL 是否读取了评测目录或 Mapflow 源仓库，发生即按 `operator-deviation` 作废。不要自行拼接 `codex exec/resume` 参数；这会绕过 cwd、环境和证据留存门禁。目标和 Sidecar 路径必须使用中性随机名。

## 案例矩阵

完整覆盖关系见 [matrix.md](matrix.md)。发布候选至少运行全部 `core` 案例；`extended` 案例用于版本发布与周期性稳定性回归。

| 案例 | 等级 | 主要问题 |
| --- | --- | --- |
| `library-system-greenfield` | core | 地图能否从模糊愿望长出代码前的设计文档网络、独立实现分支、AND 汇合并最终交付 |
| `library-reservation-brownfield` | core | 能否尊重既有代码、兼容性和回归面增加功能 |
| `order-timeout-diagnosis` | core | 能否保留迷雾、用探针找根因并按反例修图 |
| `scope-change-control` | core | 需求中途变化时能否受控改道并保留历史证据 |
| `library-system-submaps` | extended | 大目标能否拆成可收缩、可独立验收且可按 Receipt 回放历史的子地图 |
| `community-workshop-noncode` | extended | 非编码工作是否同样支持证据、授权和到达审计 |
| `cross-session-resume` | extended | 新会话能否从 Sidecar 恢复真实当前位置而不重问已决事项 |

OrderPulse 不再是主线示例，只承担故障诊断专项案例。图书管理系统是端到端主线。

每个案例包均由三块组成：`subject/fixture/` 是被测模型可见的真实现场，`operator/mainline.md` 是测试者逐条提交的自然语言主线，`oracle/` 是永不复制到目标工作区的隐藏检查。主线允许按模型提问做等价回答，但 `advance_when` 未满足时不能靠跳到下一轮掩盖失败。

## 判定层次

每个案例同时保留四类结果：

1. **结果 Oracle**：项目或任务是否通过真实检查和逐项验收。
2. **过程硬门**：人工确认、授权、Evidence、Sidecar 和实际到达边界是否被破坏。
3. **体验评分**：每轮的清晰、准确、流畅、可控和有用程度。
4. **轨迹诊断**：轮数、阻塞、重复提问、回退、Git/Sidecar/看板变化和原始输出。

合理的节点名称、等价里程碑和不同实现路线允许通过。标准答案只证明案例可解，不是唯一正确轨迹。

## 发布门

单案例只有同时满足以下条件才得到 `ready-for-small-human-test`：

- 所有必需检查点均通过；
- 没有 P0/P1；
- 每轮五项体验评分总分中位数至少为 12/15；
- 超过半数轮次的测试者判断为 `continue`。

结果只能称为“产品体验基准”或“synthetic user precheck”。真实长期使用、付费、无障碍体验和市场需求仍需要真实用户证据。

## 版本与隔离

- 任何影响用户输入、fixture、Oracle 或 Mapflow 行为的改动都提升 case 或 suite 版本。
- `prepare` 后的 case、主线、Oracle 和 verifier 固定在 run 目录；没有快照的旧 run 若检测到当前 case 版本漂移，会拒绝续跑而不是混用规则。
- `checkpoint-save` 只冻结当前仍能重新通过的已固化 checkpoint；包内分别校验目标工作树、Sidecar、checks 和 turns digest。
- `segment-prepare` 必须用当前 case 的 fixture 与 checkpoint Oracle 合同重新校验快照，并在新路径创建 Git 基线与重新绑定的 Sidecar；它不继承源 Codex 会话。
- 每次运行使用新的目标目录、Sidecar identity 和 run ID。
- 被测模型只能看到目标工作区；`operator/` 和 `oracle/` 永不复制进去。
- 编码案例固定 fixture digest 和 Git 基线，结果保存最终 diff、检查输出和 BoardModel 快照。
- 基础设施失败、任务失败和产品体验失败分别记录，不混成一个失败原因。

整体评测设计来源见 [产品体验 Prior Art](../docs/research/mapflow-experience-benchmark-prior-art.md)，快速回归裁决见 [checkpoint/replay Prior Art](../docs/research/mapflow-fast-regression-prior-art.md)。

完整 Greenfield 面板的耗时反例见 [2026-09-07 synthetic user precheck](evidence/2026-09-07-library-system-greenfield-synthetic-user-precheck.md)；从联合快照执行的真实陌生 Codex 阶段验证见 [2026-09-07 arrival-audit segment](evidence/2026-09-07-library-system-greenfield-arrival-audit-segment.md)；快速回归入口的三角色验收见 [2026-09-08 fast regression synthetic user precheck](evidence/2026-09-08-fast-regression-synthetic-user-precheck.md)；人工门恢复与子地图交互复测见 [2026-09-08 wayfinding dynamic journey](evidence/2026-09-08-wayfinding-dynamic-journey.md)。这些记录都不是发布证据，完整旅程保留给显式 Release 回归。
