# Skill 工作流复用调研

> 调研日期：2026-09-02
>
> 结论范围：用于设计 `aigineer` 的个人地图优先 Skill 包。这里只记录与本工作流直接相关的公开一手资料和当前本地 Skill，不把目录数量或社区热度当成需求证据。

## 1. 检索来源

### 本地实现

- `C:/Users/chaoyuan12/.agents/skills/grilling/SKILL.md`
- `C:/Users/chaoyuan12/.agents/skills/wayfinder/SKILL.md`
- `C:/Users/chaoyuan12/.agents/skills/tdd/SKILL.md`
- `C:/Users/chaoyuan12/.agents/skills/diagnosing-bugs/SKILL.md`
- `C:/Users/chaoyuan12/.agents/skills/code-review/SKILL.md`
- `C:/Users/chaoyuan12/.agents/skills/domain-modeling/SKILL.md`
- `C:/Users/chaoyuan12/.agents/skills/session-handoff/SKILL.md`
- `C:/Users/chaoyuan12/.agents/skills/simulate-demanding-users/SKILL.md`
- `D:/Develop/private/aigineer/docs/blueprint/vibe-coding.md`

### 公开一手资料

| 来源 | 观察到的事实 |
| --- | --- |
| [Matt Pocock skills README](https://github.com/mattpocock/skills) | Skill 被描述为小型、易适配、可组合；安装器允许用户选择技能并把文件作为自己的可编辑文件；仓库将用户调用的编排 Skill 与模型自动调用的纪律 Skill 分开。 |
| [Matt `grilling`](https://github.com/mattpocock/skills/blob/main/skills/productivity/grilling/SKILL.md) | 用 design tree 和 frontier 逐轮收敛；事实由 Agent 查，取舍交给用户；共享理解前不行动。 |
| [Matt `wayfinder`](https://github.com/mattpocock/skills/blob/main/skills/engineering/wayfinder/SKILL.md) | 目的地先行；地图是索引；决策票和实施票分开；每次会话处理有限的决策；没有雾时不强行建图。 |
| [Matt `tdd`](https://github.com/mattpocock/skills/blob/main/skills/engineering/tdd/SKILL.md) | 通过公共 seam 做行为测试；red-green-refactor；一次一个 vertical slice；避免实现耦合和水平切片。 |
| [Matt `to-tickets`](https://github.com/mattpocock/skills/blob/main/skills/engineering/to-tickets/SKILL.md) | 将工作切成可独立验证的 tracer-bullet vertical slices，并声明 blocking edges；必要时采用 expand-contract。 |
| [Matt `implement`](https://github.com/mattpocock/skills/blob/main/skills/engineering/implement/SKILL.md) | 基于 spec/tickets 实施；尽量使用 TDD；定期跑类型检查和单测；完成后 review。 |
| [Anthropic skills README](https://github.com/anthropics/skills) | Skill 是包含 `SKILL.md`、脚本和资源的自包含目录；动态加载；官方仓库明确其示例需要在真实使用前测试。 |

## 2. 复用深度裁决

| 候选能力 | 裁决 | 采用内容 | 不直接采用的部分 |
| --- | --- | --- | --- |
| 目的地收敛 | `absorb + build` | 吸收 Matt `grilling` 的 design tree、frontier、事实/取舍分离；自建 Destination Contract | 不强制“relentless”文风，不把所有问题都问给用户 |
| 仓库勘探与影响面 | `build` | 吸收本地 `domain-modeling` 的术语纪律、Matt 架构扫描的热点优先和删除测试思想 | 不复制架构报告的 HTML 工作流，不把架构重构当每次任务必做 |
| 路线地图 | `adapt` | 吸收 Matt `wayfinder` 的目的地先行、地图索引、雾/票、决策与实施分离 | 不依赖 issue tracker；改用本地 Markdown/YAML 和 `aigineer` 状态投影 |
| 地图到施工 | `absorb` | 吸收 `to-tickets` 的 vertical slice、blocking edges、expand-contract 判据 | 不引入 tracker label、外部 issue 和团队分派 |
| 节点施工 | `adapt` | 吸收 Matt `implement` 的 spec 驱动、类型/单测节奏和完工 review；组合本地 `tdd`、`diagnosing-bugs`、`code-review` | 不强制每次提交或固定 issue tracker；遵守目标仓库约定 |
| 节点证据/到达 | `absorb` | 吸收本地 `verify`、`aigineer` 到达四问和 `simulate-demanding-users` 的 observed/inference 边界 | 不创建独立 `evidence-auditor`，因为没有独立用户工作 |
| 交接 | `adopt` | 采用本地 `session-handoff` 的目的地证据、检查点和安全边界 | 不改写其协议，不把交接变成正常任务必需步骤 |
| 复盘 | `adopt` | 采用本地 `retro` 的摩擦/原因/调整结构 | 不在每次小任务后强制复盘 |
| 产品价值 | `adapt / park` | 需要时使用本地 `simulate-demanding-users` 作为合成用户预检 | 暂不将它升级成通用产品验证 Skill，合成用户不能证明市场或留存 |
| 外部动作 | `park` | 参考本地安全边界和发布工作流的授权思想 | 当前没有稳定的个人发布契约，不先造通用 `release-action` |

## 3. 公开生态的分发启示

Matt 的仓库同时支持托管式插件和可编辑文件安装，并明确提醒不要重复安装两套；Anthropic 的仓库采用自包含目录和动态加载。对 `aigineer` 的启示是：

1. 核心 Skill 应该是普通目录 + `SKILL.md`，可脱离特定模型运行。
2. 编排入口与纪律 Skill 分离，避免一个巨大 Skill 吞掉所有流程。
3. 用户应能选择安装部分能力；默认组合通过一个入口路由，而非强制全家桶。
4. 外部 Skill 保持来源引用和复用裁决，不复制其完整正文，降低漂移和许可风险。
5. 真正的本地差异集中在 artifact contract、阶段门槛和本地文件适配层。

## 4. 未被现成方案完全覆盖的创新点

这里的“自研”只指具体契约，不是重新发明所有工程实践：

- 把目的地、仓库勘探、路线地图、施工简报和节点证据连接成同一组稳定 artifact。
- 用 `aigineer` 的轻量状态投影阻止未批准目的地和未选择节点的写入。
- 将 issue-tracker 型 wayfinding 改成个人仓库可直接使用的本地文件地图。
- 把“测试通过”与“目标达到”分成节点证据和到达审计两个层次，同时不增加独立审计 Skill。

## 5. 证据边界

- 公开仓库内容证明的是设计和分发方式，不证明它们适合所有个人工作流。
- GitHub API 检索遇到匿名 rate limit，因此本报告没有使用星标或 API 元数据做质量结论；主要依据已克隆仓库的源码/Skill 正文和官方 README。
- 当前尚未在多个真实业务项目上做 dogfood；核心 Skill 的触发精度、认知负担和重复劳动仍需观察。
