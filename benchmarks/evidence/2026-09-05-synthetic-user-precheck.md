# Synthetic user precheck：验收矩阵 1.1.0

> 这是合成用户预检，不是真实用户研究，也不证明留存、付费、无障碍、生产可靠性或市场需求。

## 测试合同

- 问题：普通测试者不给模型 Mapflow 内部材料时，能否启动、理解并持续运行这套产品体验矩阵，而不被主线暗示标准过程？
- 目标用户：希望用 Codex 与 Mapflow 完成真实项目的个人使用者。
- 关键旅程：`doctor → list → prepare → 隔离任务 → checkpoint → record/score/finding → report → suite-report`。
- 可观察接缝：CLI 输出、目标 Git、仓库外 Sidecar、主线代码块、隐藏 checkpoint、报告与退出码。
- 允许写入：隔离 fixture、仓库外 benchmark run/Sidecar、本仓库内验收实现与本证据。
- 人类限定未知：真实长期使用意愿、跨项目收益、无障碍体验和市场需求。

## 修复前独立面板

三位互不协调的合成审阅者只使用公开入口，均在创建真实被测 Codex 任务前停止，因此他们验证的是“验收产品本身的可进入性”，不是七条 Mapflow 旅程已经通过。

| 角色 | Verdict | 分数 | 关键发现 |
| --- | --- | ---: | --- |
| 低耐心用户 | hesitate | 81/100 | P2：烟测漏列两个 checkpoint 命令；P3：报告边界为英文 |
| 交互审阅者 | hesitate | 71/100 | P1：失败 checkpoint 指向不存在的偏差分支；P2：隔离任务创建和 dirty 行动不够明确 |
| 怀疑型用户 | leave | 59/100 | P1：模型可见输入仍在教授预期 Mapflow 过程；P2：非通过报告退出码为 0；P2：完整运行手工负担较高 |

确认的两个 P1 根因分别是错误恢复指令和黑盒输入泄露。没有观察到 P0。

## 修复

1. 七条主线统一改成真实任务开场；后续只补业务事实或确认模型主动提出的对象。模型未自行勘探、收敛、提出候选、等待确认或保留证据时直接记失败，不再由测试者提示正确过程。
2. `benchmark doctor` 新增内部术语和过程辅导短语扫描，阻止主线以后退化成标准答案脚本。
3. checkpoint 失败统一要求停止并记录 finding；只有当前检查点真的写有偏差分支时才允许使用。
4. 烟测就地列出 `prepared`、`enabled-empty`、`destination-shaped` 三次检查，报告使用中文边界并生成缺失检查点恢复命令。
5. `report`、`smoke-report`、`suite-report` 在门禁未通过时返回非零退出码；`--no-fail` 只抑制进程失败，不改变 gate。
6. `prepare` 明确目标工作目录的绑定与核对方式，并说明 dirty 基线可用于开发烟测、不可用于发布候选。
7. 报告新增首次价值时点、轮数/分钟预算执行和单一结果归因，基础设施归因不能覆盖已有失败证据。

## 修复后复验

- 确定性回归：`npm test`，78/78 通过。
- 案例完整性：`npm run benchmark:doctor`，7/7 通过，全部案例版本为 1.1.0。
- 新鲜隔离烟测：`prepare`、`prepared`、用户级 runtime `enable`、`enabled-empty` 均通过；Sidecar 位于目标 Git 外。
- 负向门禁：缺少 `destination-shaped` 时，`smoke-report` 返回 `smoke-incomplete` 和退出码 1，并给出准确恢复命令。
- 静态边界：模型可见代码块没有 Mapflow 内部路线术语或已知过程辅导短语。

修复后的新鲜复验由根任务做了一次对抗性自审，结论为 `continue`，评分为清晰 18、认知负担 16、信任 18、动机 17、可用性 18，总分 87/100。由于当前回合没有使用新的独立审阅者，这一结果是较弱的 fallback 证据，不能冒充独立面板重测。

## Gate

`ready-for-small-human-test`（较弱的单人对抗性复验）：已确认 P0/P1 为零，确定性检查通过，适合开始真实的完整案例试跑。它不表示七条旅程已经执行通过；每条真实运行仍必须生成自己的 run、checkpoint、评分和报告。

下一步是由没有参与实现的人先完整运行 `library-system-greenfield`，再按变更表面选择其他 core 案例。若出现任何可复现 P1，回到 `repair-and-retest`。
