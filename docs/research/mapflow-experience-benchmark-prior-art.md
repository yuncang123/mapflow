# Mapflow 持续产品体验基准 Prior Art

日期：2026-09-05

## 研究问题与边界

目标不是再证明 Mapflow 的 YAML、CLI 或 Cytoscape 看板能运行，而是建立一套可持续回归的产品体验基准，回答：

> 一个没有获得标准答案、内部模板或完成态地图的人，能否只用自然语言与 Codex 协作，在 Mapflow 的帮助下清晰、准确、流畅、可控地完成真实项目或任务？

这类需求同时属于：

- 可复现的 Agent 评测任务；
- 人与 Agent 多轮协作轨迹评测；
- 真实工作区的结果验收；
- 只读看板与外部真相的一致性审计；
- 带隐藏判据的黑盒产品体验测试。

本轮先检查本仓库，再核对五组一手资料。检索时固定的上游 `main` 提交为：

| 项目 | 本轮核对提交 |
| --- | --- |
| OpenAI Evals | `8eac7a7de5215c907fbddc30efdaf316913eccdd` |
| Inspect AI | `58e9b08e72b90b1ef6c675484377db4f0f578ecf` |
| SWE-bench | `02e7a74ffd0b707aab73d203fe87bdc7c76afc8e` |
| τ³-bench（仓库名仍为 `tau2-bench`） | `672227c6b6676edc20d57ea53b7000262aae77b9` |
| WebArena | `dce04686a56253aefba7b18a4fa0937cf1dc987b` |

## 仓库内已有基础与真实缺口

Mapflow 已有状态—工作边—Evidence 模型、仓库外 Sidecar、事件投影、人工确认门、正向可达性证明和只读看板。本仓库也已有一份[空白建图基准测试](../wayfinding/mapflow-v0-5-baseline-test/README.md)，但它仍以单案例操作手册为主，公开了较多 Mapflow 内部材料、推荐结构和命令。

当前缺的不是另一份完成态示例，而是下面这套可运行合同：

1. 多个不同失败模式的案例，而不是一个案例代表全部体验；
2. 测试者逐轮提交的自然语言主线，与模型不可见的 Oracle/Rubric 分离；
3. 每一轮对话后的可观察检查点，而不只检查最终产物；
4. 固定起点、隔离 Sidecar、可重置 fixture 和唯一 run identity；
5. 对话、工具、Git、Sidecar、事件、看板、验证输出和人工观察的统一结果记录；
6. 将确定性事实、一票否决、带锚点的人类体验评分和模型辅助诊断分层；
7. 多次试验，区分偶然成功、稳定成功和基础设施失败。

本仓库没有运行时依赖，测试目前使用 Node 内置测试器。引入一个完整 Python Agent 评测框架会改变轻量分发边界；因此外部方案首先按“借鉴评测设计”审查，不预设代码级采用。

## 候选一：OpenAI Evals

### 一手证据

- OpenAI Evals 将一个 eval 定义为“数据集 + eval class”；样本以 JSONL 表示，至少含 `input`，基本评测再含 `ideal`。[Building an eval](https://github.com/openai/evals/blob/8eac7a7de5215c907fbddc30efdaf316913eccdd/docs/build-eval.md)
- Eval 注册名显式包含 `<eval_name>.<split>.<version>`，并要求变更评测时提升版本，以维持结果可比较性。[Building an eval](https://github.com/openai/evals/blob/8eac7a7de5215c907fbddc30efdaf316913eccdd/docs/build-eval.md#registering-the-eval)
- README 明确支持用不公开的数据建立 private eval，从常见真实工作流构造回归样本。[OpenAI Evals README](https://github.com/openai/evals/blob/8eac7a7de5215c907fbddc30efdaf316913eccdd/README.md)
- 开放式答案可以用 rubric 驱动的 model-graded eval，但官方建议为评分器补充人类 `choice labels`，再做 meta-eval 验证评分器本身。[Model-graded evals](https://github.com/openai/evals/blob/8eac7a7de5215c907fbddc30efdaf316913eccdd/docs/build-eval.md#for-model-graded-evals-a-step-by-step-workflow)
- 运行时会将事件记录为本地 JSONL，可供文本查看或程序化分析。[Running evals](https://github.com/openai/evals/blob/8eac7a7de5215c907fbddc30efdaf316913eccdd/docs/run-evals.md#logging)

### 可复用机制

- 为每个案例固定 `case_id + split + version`，案例定义改变即升版，旧结果不与新版混算。
- 将逐轮用户输入当公开 `input`，将预期真相变化、禁止行为和评分锚点当隐藏 `ideal/rubric`。
- 对“清晰、流畅、认知负担”这类开放式质量使用带正反例锚点的评分表；若将来增加模型辅助评分，必须用一批人工标签反向验证评分器。
- 保存逐事件记录，使总分可以回溯到具体一轮和具体证据。

### 不适合直接采用

- OpenAI Evals 的基本模板主要面向“一个输入—一个 completion”，不能直接表达用户确认、Sidecar 演进、看板刷新和实际施工组成的多轮 Work Episode。
- `match/includes` 适合确定性小断言，不适合评价措辞可变的自然交互；反过来，model grader 也不能替代 Git、测试、Evidence 和事件链这些确定性 Oracle。
- 原仓库的 CLI、Python 注册表和 completion function 会把 Mapflow 基准绑定到另一个运行时，不能直接操纵用户正在使用的 Codex 桌面会话。

### 裁决

**借鉴设计。** 采用版本化案例、隐藏 rubric、事件日志和评分器 meta-eval 的原则；不引入 OpenAI Evals 运行时。

## 候选二：Inspect AI

### 一手证据

- Inspect 的基本 `Task` 由 `dataset + solver + scorer` 组成，并原生支持多轮对话、工具、epochs、执行限制、setup/cleanup、sandbox 和 metadata。[Tasks](https://inspect.aisi.org.uk/tasks.html.md)
- `Sample` 可以拥有稳定 `id`、`input`、`target`、`metadata`、`files`、`setup` 和独立 sandbox；同一 Task 下的各样本仍拥有互不干扰的 sandbox 实例。[Datasets](https://inspect.aisi.org.uk/datasets.html.md)；[Sandboxing](https://inspect.aisi.org.uk/sandboxing.html.md#per-sample-setup)
- `EvalSample` 会记录完整对话 `messages`、最终 `store`、执行 `events`、`scores`、模型用量、起止时间、错误和唯一运行 UUID。[EvalSample source](https://github.com/UKGovernmentBEIS/inspect_ai/blob/58e9b08e72b90b1ef6c675484377db4f0f578ecf/src/inspect_ai/log/_log.py)
- Eval log 既保存任务、模型、计划、汇总结果，也保存每个样本的输入、输出、target 和 score；重试若要可靠复用完成样本，必须提供稳定唯一的 sample id。[Eval logs](https://inspect.aisi.org.uk/eval-logs.html.md)
- Task 可设置 message、token、time、working time 和 cost 等限制，还能用 epochs 重复执行同一样本。[Tasks](https://inspect.aisi.org.uk/tasks.html.md#task-options)

### 可复用机制

- 把一个 Mapflow 案例看成可重复 Task，把一次独立运行看成 Sample/Episode。
- 每个案例显式声明 fixture、逐轮输入、观察点、Oracle、Rubric、预算、setup 和 cleanup。
- 结果包同时保存 run 级元数据、逐案例摘要和逐轮事件；汇总页只展示索引，失败分析再读取完整轨迹。
- 每次试验使用独立工作区和 Sidecar，禁止样本之间复用工作状态。
- 为每轮和整场设置最大轮数/时间等预算，超预算应成为独立终止原因，而不是笼统记为“失败”。

### 不适合直接采用

- Inspect 是通用 Python eval runner，适合由 runner 调模型 API；Mapflow 首批验收要覆盖真实的人操作 Codex、观察看板并作出确认，runner 无法等价替代这种产品表面。
- Docker per-sample sandbox 对公共开源代码评测很好，但 Mapflow 还要验证 Windows 本地 Git、仓库外 Sidecar、浏览器投影和跨会话恢复；完全容器化会遮蔽这些关键边界。
- 直接整体采用会为一个 Node 零依赖工具引入大型 Python 评测栈，需求重合不足一半。

### 裁决

**借鉴设计，保留未来导出适配器。** 采用 Task/Sample/Score/Log 的分层数据形状、稳定 ID、隔离和预算概念；首版用 Mapflow 原生文件与 Node 检查实现。需要批量跨模型 API 评测时，再考虑把同一案例清单导出为 Inspect Task，而不是让 Inspect 成为唯一真相源。

## 候选三：SWE-bench

### 一手证据

- 每个 SWE-bench 实例固定 `instance_id`、真实仓库、`base_commit`、问题描述、gold `patch`、`test_patch`、`FAIL_TO_PASS` 和 `PASS_TO_PASS`；官方在结构说明中直接提醒求解时不要查看 gold patch。[Dataset structure](https://github.com/SWE-bench/SWE-bench/blob/02e7a74ffd0b707aab73d203fe87bdc7c76afc8e/docs/guides/datasets.md#dataset-structure)
- 评测器在 Docker 中应用模型补丁并运行仓库测试，以减少平台差异；流程明确分成 setup、patch application、test execution、grading 和 reporting。[Harness reference](https://github.com/SWE-bench/SWE-bench/blob/02e7a74ffd0b707aab73d203fe87bdc7c76afc8e/docs/reference/harness.md)
- 每次运行使用 `run_id`，每个实例保存 `report.json`、测试输出、harness log、实际执行脚本和应用的 patch；汇总还区分 resolved、unresolved、empty patch、error、likely infrastructure failure 和 ambiguous failure。[Evaluation results](https://github.com/SWE-bench/SWE-bench/blob/02e7a74ffd0b707aab73d203fe87bdc7c76afc8e/docs/guides/evaluation.md#understanding-evaluation-results)
- 结果缓存按 `run_id + instance_id`，并不考虑 patch 内容；若改变候选补丁却复用 run id，会错误复用旧结果。[Result caching](https://github.com/SWE-bench/SWE-bench/blob/02e7a74ffd0b707aab73d203fe87bdc7c76afc8e/docs/guides/evaluation.md#result-caching)

### 可复用机制

- 编码案例必须固定 fixture 的 Git commit/digest，实施结束后同时跑“目标测试”和“原有回归测试”。
- Gold 只用于验证 fixture 与 Oracle 确实可解，绝不进入被测模型可读的工作区、提示词或 Sidecar。
- 每个 run 使用新 ID；结果包保存最终 diff、实际验证命令、原始输出和 harness 决策，而不只保存一个通过标志。
- 将产品失败、任务未完成、基础设施失败和无法判定分开统计，避免把环境故障误算成 Mapflow 体验失败。

### 不适合直接采用

- SWE-bench 的目标是 issue-to-patch，主要 Oracle 是最终测试结果；它不检查人是否理解当前位置、是否确认节点/边、是否及时看见迷雾、是否能控制范围。
- 公开数据集中 gold patch 和 test patch 与任务同处一个数据对象。Mapflow 的黑盒验收应采用更强隔离：模型工作区只含真实现场，隐藏 Oracle 存放在外部 harness 目录。
- Docker 镜像、存储和多仓库依赖显著超出 Mapflow 第一阶段本地基准需要；非编码案例也无法套用 patch 模型。
- 一个通过测试的补丁不能证明 Mapflow 有帮助：必须另行评价建图轨迹、人工控制门和看板一致性。

### 裁决

**借鉴设计。** 采用不可变 fixture、隐藏 gold/acceptance、双测试集合、结果分类和完整 per-run 证据包；不采用 SWE-bench 数据集或 Docker harness。

## 候选四：τ³-bench

### 一手证据

- 当前 τ³-bench 将领域建模为 policy、agent tools、tasks，以及可选的 user tools，并支持用户模拟器与 Agent 的多轮交互。[τ³-bench README](https://github.com/sierra-research/tau2-bench/blob/672227c6b6676edc20d57ea53b7000262aae77b9/README.md#overview)
- 一个任务的最终 reward 是 `reward_basis` 中各部分的乘积；常见判据同时检查最终数据库状态和必须向用户传达的信息。[Task schema and evaluation](https://github.com/sierra-research/tau2-bench/blob/672227c6b6676edc20d57ea53b7000262aae77b9/docs/evaluation.md)
- `evaluation_criteria.actions` 默认只是产生正确终态的一条参考路径。只要获得等价数据库终态，其他正确工具路径也能通过；仅在确实要求唯一轨迹的任务中才把 ACTION 纳入硬判据。[Actions are not the only path](https://github.com/sierra-research/tau2-bench/blob/672227c6b6676edc20d57ea53b7000262aae77b9/docs/evaluation.md#why-actions-looks-like-a-requirement-and-isnt)
- runner 支持 `num_trials`、seed、checkpoint、retry 和自动恢复；结果会保存任务、运行元数据和每次 simulation。[Running simulations](https://github.com/sierra-research/tau2-bench/blob/672227c6b6676edc20d57ea53b7000262aae77b9/docs/running_simulations.md)
- `SimulationRun` 记录 task id、trial、seed、终止原因、成本、消息和 reward；运行元数据还绑定 benchmark Git commit。[Simulation result model](https://github.com/sierra-research/tau2-bench/blob/672227c6b6676edc20d57ea53b7000262aae77b9/src/tau2/data_model/simulation.py)
- 当前指标实现把基础设施错误从 Agent 结果中排除，并对多次 trial 计算 `pass^k`。[Agent metrics](https://github.com/sierra-research/tau2-bench/blob/672227c6b6676edc20d57ea53b7000262aae77b9/src/tau2/metrics/agent_metrics.py)

### 可复用机制

- 测试者主线脚本扮演“真实用户”，只在当前轮给出自然语言，不把任务目标状态、后续台词和评分表注入模型上下文。
- 以最终可回读事实、验收 Evidence 和不变量作为结果主判据；把一条参考 Mapflow 路径用于诊断，不把它误当成唯一正确路径。
- 只有 Mapflow 的硬不变量适合做轨迹硬门，例如“未经人确认不得把候选节点登记为正式节点”“expected effect 不得冒充 actual evidence”。提问措辞、合理的里程碑命名和等价分解不能要求逐字匹配 gold trace。
- 同一案例运行多次，记录单次成功率和“连续若干次均成功”的稳定性，而不是凭一次演示下结论。
- 分开记录 Agent、用户脚本和环境的错误归因，避免坏 fixture 或测试者偏离脚本污染产品结论。

### 不适合直接采用

- LLM 用户模拟器适合大批量研究，但会引入另一个随机模型。Mapflow 的首批产品验收需要确定的逐轮人工脚本，并保留真实用户是否感到清晰、流畅、可控的观察。
- 数据库 hash 等价适用于封闭事务系统；Mapflow 面向开放世界，不能把整个目标项目压成单一状态 hash，必须逐项核对 Fact、Evidence、Git、外部回执和不变量。
- `communicate_info` 的子串匹配不适合中文自然对话；应评分“用户是否获得了必要信息”，而不是是否复述固定句子。
- τ³-bench 文档将自然语言断言标为实验性能力；Mapflow 不能用单一 LLM judge 取代隐藏确定性 Oracle 或人类体验评分。

### 裁决

**重点借鉴设计。** “终态正确优先、轨迹诊断为辅；仅将真正唯一的过程不变量设为硬门”最适合 Mapflow。多次试验、错误归因和完整对话保存也应直接映射到基准合同；不引入其领域模拟器。

## 候选五：WebArena

### 一手证据

- WebArena 是自托管网站环境，正式评测要求使用独立环境，并在整组实验后恢复初始数据。[End-to-end evaluation](https://github.com/web-arena-x/webarena/blob/dce04686a56253aefba7b18a4fa0937cf1dc987b/README.md#end-to-end-evaluation)；[Environment reset](https://github.com/web-arena-x/webarena/blob/dce04686a56253aefba7b18a4fa0937cf1dc987b/environment_docker/README.md#environment-reset)
- Evaluator 接收整条 `trajectory`，可以组合答案字符串、最终 URL 和页面内容检查，并将各检查项相乘。[Evaluator source](https://github.com/web-arena-x/webarena/blob/dce04686a56253aefba7b18a4fa0937cf1dc987b/evaluation_harness/evaluators.py)
- 每个运行将轨迹保存成 HTML；公开实验资源进一步保存每步 accessibility tree、原始模型输出、解析后 action、截图及 Playwright trace，后者还能回看 HTML 和网络流量。[Execution traces](https://github.com/web-arena-x/webarena/blob/dce04686a56253aefba7b18a4fa0937cf1dc987b/resources/README.md)
- 官方仓库还发布了部分人工轨迹，说明最终分数之外，人工解题过程本身也可以成为分析基线。[Human trajectories](https://github.com/web-arena-x/webarena/blob/dce04686a56253aefba7b18a4fa0937cf1dc987b/resources/README.md#12212023-human-trajectories)

### 可复用机制

- 看板验收不能只截最终屏幕；每个关键轮次都要保存“用户输入—模型输出—Sidecar 摘要—看板截图/状态—发生的动作”。
- UI 检查必须关联真相源检查：看板内容正确、动态刷新及时、stale 明确、节点/边 Inspector 可追溯，缺一不可。
- 结果浏览器应支持从失败汇总跳到单轮轨迹，便于判断是地图模型、投影、Agent 路由还是用户脚本导致失败。

### 不适合直接采用

- WebArena 的完整网站集和浏览器 runner 体量很大，且重点是自主网页操作，不是人与 Codex 共建工作地图。
- 其部分 Oracle 依赖固定 URL、DOM locator、字符串和硬编码等待，容易把页面实现细节误当产品语义。Mapflow 应优先检查 BoardModel/Sidecar 语义，再用真实浏览器验证视觉与交互。
- WebArena 当前 README 已推荐新实验使用 AgentLab/BrowserGym；进一步说明不应把其旧 canonical runner 整体嵌入 Mapflow。

### 裁决

**借鉴设计。** 采用逐轮视觉轨迹、状态—动作—截图关联和可钻取结果浏览；不采用网站环境与 evaluator 代码。

## 跨项目综合：Mapflow 应采用的评测合同

### 1. 案例包必须分成可见面与隐藏面

```text
benchmark case
├─ subject/                    # 被测模型可见
│  └─ fixture/                # 真实项目现场；不含 Mapflow 答案
├─ operator/                   # 仅测试者可见
│  └─ mainline.md             # 按轮复制的自然语言和分支规则
├─ oracle/                     # 被测模型不可见
│  ├─ checkpoints.yaml        # 每轮必须/允许/禁止发生的状态变化
│  ├─ rubric.yaml             # 人类体验评分锚点
│  ├─ acceptance/             # 测试、查询或人工验收脚本
│  └─ gold/                   # 仅验证案例可解，不要求路径一致
└─ case.yaml                  # id、版本、fixture digest、预算和标签
```

这里的“不给大模型任何材料”应精确定义为：不向模型提供 Mapflow 标准答案、完成态地图、后续用户脚本和隐藏验收表。模型仍应像真实工作一样读取目标项目现场和项目约定；否则无法检验真实勘探能力。

### 2. 每一轮是可验收的 Checkpoint，不是固定答案

每轮隐藏检查点至少包含：

| 字段 | 含义 |
| --- | --- |
| `operator_input` | 本轮测试者原样发送的自然语言 |
| `intent_under_test` | 这一轮在验证哪项产品能力 |
| `must_observe` | 回答、Sidecar、事件、看板或 Git 中必须出现的语义 |
| `may_vary` | 合理替代路径、命名、顺序和措辞 |
| `must_not` | 本轮不得发生的越权、伪证据或提前推进 |
| `truth_delta` | 相对上一轮，正式真相允许如何改变 |
| `human_decision` | 是否必须等人确认，以及确认对象是什么 |
| `evidence_capture` | 要保留的 transcript、快照、命令输出或截图 |
| `advance_when` | 何时可以发送下一轮输入 |

`gold` 只证明案例存在至少一条可行路径。除非路线本身就是受测对象，否则不能因为模型采用了另一条等价路径而失败。

### 3. 评分必须分层，不能揉成一个主观总分

建议固定四层：

1. **结果 Oracle**：项目或任务是否真实完成；目标 Predicate、Acceptance、不变量和 Evidence 是否逐项成立。
2. **过程硬门**：是否违反确认、授权、事实来源、边独立性、投影只读、逻辑可达与实际到达分离等不可妥协边界。
3. **逐轮产品体验 Rubric**：清晰、准确、流畅、可控和额外负担，用 `0/1/2` 或 `0/1/2/3` 锚点由人评分，并写明证据位置。
4. **轨迹诊断指标**：总轮数、阻塞轮数、重复提问、错误回退、未经要求暴露内部 ID/CLI 的次数、修图范围、刷新延迟等；用于定位退化，不单独代表成功。

确定性检查优先于 LLM judge。若使用模型辅助归类长轨迹，只能作为诊断或初筛，并用人工标注集做 meta-eval。

### 4. 一票否决只用于真实安全与真相破坏

适合一票否决的事件包括：

- 未经人确认，把候选节点或边登记进正式 Blueprint；
- 把模型推断、expected effect 或看板内容登记成实际 Evidence；
- 未获授权执行外部写入、发布或不可逆动作；
- 验收未通过却宣布实际到达；
- 看板把 stale/缺失数据投影为当前真相；
- Mapflow 写入目标项目 Git，违反仓库外 Sidecar 边界；
- 修改或读取隐藏 Oracle/gold 来完成任务。

不应一票否决合理的不同命名、等价里程碑分解、问题顺序或正确但不同的实现路径。

### 5. Fixture 与运行必须可重放

每次 run 至少绑定：

- benchmark suite 版本和 commit；
- case id、case version、fixture commit/digest；
- Mapflow 源码版本、已安装 runtime 版本和关键文件 digest；
- Codex/模型标识与可得设置；
- 工作区和 Sidecar 的全新实例 identity；
- trial、可选 seed、起止时间、预算和终止原因；
- 操作者实际发送的逐轮文本；
- 最终 Git diff/status、验证原始输出、Sidecar/event 快照和看板证据。

任何影响输入、Oracle、环境或 Mapflow 行为的变更都必须升 case/suite 版本。不同候选实现不得复用同一个缓存结果；基础设施失败单独重试和统计。

### 6. 重复试验测稳定性，不把演示成功当成产品通过

推荐分三种节奏：

- PR/本地快速回归：确定性合同测试 + 每类一条短旅程；
- 发布候选回归：完整案例矩阵，每案例至少一次人工黑盒运行；
- 周期性稳定性回归：关键案例重复多次，报告成功次数、严重过程违规次数、基础设施失败和体验分布。

`pass^k` 可以作为“连续 k 次均成功”的稳定性参考，但 Mapflow 还必须同时报告一票否决数与人工体验分，不能只发布单个聚合数字。

## 建议的案例矩阵

该矩阵是从失败模式出发的最小覆盖，不是要求每个案例固定一条 gold 路线：

| 案例族 | 主要风险 | 必须覆盖的核心机制 |
| --- | --- | --- |
| 空仓库开发系统 | 地图无法从零自然长出 | 勘探、目的地定形、人工确认、反向回归、施工、到达审计 |
| 存量系统增加功能 | 忽略已有契约或扩大影响面 | 仓库勘探、回归面、兼容性、Git 实施凭据 |
| 故障诊断 | 过早锁定根因 | 四值事实、迷雾、探针边、反例驱动修图 |
| 中途需求变化 | 地图不能受控改道 | 最小子图 replan、历史证据保留、停止未授权边 |
| 大型任务与子地图 | 大图不可读、父子验收漂移 | 收缩/展开、Arrival Receipt、跨层状态传播 |
| 非编码任务 | Mapflow 被 Git/代码绑死 | 外部证据适配、审批/文档/会议等工作边 |
| 跨会话恢复 | 对话中断后丢失真实当前位置 | Sidecar identity、事件重建、当前问题和 active edge 恢复 |
| 负面与越权场景 | 看似顺畅但破坏控制边界 | 人工确认门、授权、失败停止、禁止伪 Evidence |

自动合同测试验证“机制没坏”，上述黑盒旅程验证“人在真实使用中能不能成功”。两者不能互相替代。

## 最终复用裁决

| 候选 | 复用深度 | 采用内容 | 拒绝内容 |
| --- | --- | --- | --- |
| OpenAI Evals | 借鉴设计 | 版本化 eval、隐藏 rubric、事件日志、评分器 meta-eval | 单轮模板和完整 Python runtime |
| Inspect AI | 借鉴设计；未来可导出 | Task/Sample/Score/Log、稳定 ID、隔离、预算、epochs | 直接作为 Codex 桌面体验 runner |
| SWE-bench | 借鉴设计 | 固定 Git 起点、gold 隔离、真实测试、per-run 证据、错误分类 | patch-only 模型和重型 Docker harness |
| τ³-bench | 重点借鉴设计 | 用户—Agent 多轮、终态优先、等价路径、重复试验、错误归因 | LLM 用户替代真人、DB hash 和字符串即真相 |
| WebArena | 借鉴设计 | 逐轮状态/动作/截图、可钻取轨迹、浏览器证据 | 自托管网站集、脆弱 DOM Oracle、旧 runner |

总裁决落在 **借鉴设计**：Mapflow 应建立自己的轻量案例清单、隐藏 Oracle、人工主线脚本、逐轮证据记录和结果汇总，不整体采用任何现有框架，也不新增运行时依赖。原因是现成框架分别擅长模型 completion、API Agent、代码补丁、封闭事务或自主网页操作，没有一个把“人类逐轮确认 + 仓库外地图真相 + 只读动态图投影 + 开放世界 Evidence + 实际项目交付”作为同一验收对象。

未来若需要批量比较 API 模型，可新增从 Mapflow-native case manifest 到 Inspect Task 的单向导出器；Mapflow 案例和结果包仍应是产品验收的真相源，避免被某一评测框架锁定。
