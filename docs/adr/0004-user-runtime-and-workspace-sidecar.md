# ADR 0004: 用户级运行时与工作区外 Workspace Sidecar

## Status

Accepted

## Context

早期安装器把 runtime、Skills、模板和 `.mapflow` 状态复制到每个目标工作区。对 Git 任务，这会把个人任务导航与产品代码混在同一个工作树中，增加误提交、重复安装和版本漂移；对非 Git 任务，它还会错误地把仓库当成启用前提。

## Decision

Mapflow 只安装一次用户级入口包。入口包携带完整 runtime、看板、依赖、模板、行为引用和阶段 Skills。用户明确启用时，入口第一步运行幂等 `enable`，按当前 Git worktree 或普通目录的 canonical path 建立 Workspace Identity，并在用户状态目录创建或恢复对应 sidecar。

sidecar 保存 manifest、当前 Blueprint、Brief、events 和 state。目标工作区不接收 Mapflow 文件，旧 `--target` 安装入口被拒绝；即使显式覆盖 state home，解析后的 sidecar 也不得落入目标工作区。工作区内遗留 `.mapflow` 只报告，不自动导入、迁移或删除。Git remote 和 shared common dir 不参与身份，不同 worktree 不共享运行状态。

## Consequences

- 说“启用 mapflow”可以在已安装入口存在时自动初始化或恢复当前工作区，无需逐仓安装。
- Blueprint、Brief、事件、投影和看板会话不进入目标工作区；Git 仅在仓库型任务中充当 realization/evidence adapter。
- 全局入口首次发现仍需要一次显式 bootstrap 安装；未安装的 Skill 无法靠自然语言自行出现。
- sidecar 是本机私有状态，不提供默认云同步或跨机器共享；需要迁移时必须显式导出或交接。
- 不同 Git worktree 拥有独立地图，避免同仓并行工作互相污染；移动工作区路径会产生新的 Workspace Identity。
