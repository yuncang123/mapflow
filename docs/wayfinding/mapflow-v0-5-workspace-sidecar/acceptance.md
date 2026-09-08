# Mapflow v0.5 Workspace Sidecar 验收

## 结论

仓库内 v0.5 已达到本次“用户级自动启用、与目标代码 Git 隔离”的个人本地可用基线。它不声明已经覆盖用户真实的全局安装，不声明 Git push、tag、发布或跨机器同步完成。

## 验收合同

| 要求 | 实现 | 验收结果 |
| --- | --- | --- |
| 说“启用 mapflow”时自动准备当前工作区 | 入口 Skill 第一步固定执行 `enable --root <当前工作目录> --json` | 通过；重复调用恢复同一 sidecar，不生成占位 Blueprint |
| Mapflow 不进入目标代码仓库 | Blueprint、Brief、events、state 位于用户状态目录的 Workspace Sidecar | 通过；临时 Git 仓库启用、初始化、查询前后的目录集合与 `git status --short` 完全相同 |
| 用户级包可独立运行 | 全局包携带 CLI/core/workspace resolver/board/vendor/templates/references/phase Skills | 通过；从隔离安装目录完成 enable、init、status 和 Board API/static asset 验证 |
| 工作区不会串图 | canonical Git worktree 或普通目录路径生成 Workspace Identity，manifest 反向绑定 | 通过；同一 worktree 子目录复用，不同 worktree 与普通目录隔离，manifest 漂移 fail closed |
| 覆盖路径不能破坏隔离 | `MAPFLOW_HOME` 必须为绝对路径，最终 sidecar 不得落入工作区 | 通过；仓库内 override 被拒绝，并兼容 Windows 8.3/long path canonicalization |
| 旧项目状态不被偷偷接管 | 仓库内遗留 `.mapflow` 只报告 | 通过；不读取、不迁移、不删除，旧文件内容保持不变 |
| 不再提供仓库级安装 | 安装器只接受 `--global` | 通过；`--target` 明确失败且目标目录不变 |

## 自动化证据

2026-09-03 在 Windows/PowerShell、Node.js 当前环境执行：

```text
npm test
57 tests, 57 pass, 0 fail

node tools/install.mjs --global --dry-run
exit 0；清单包含完整 runtime、board、vendor、templates、references 和 phase Skills

git diff --check
exit 0
```

完整回归仍覆盖 v0.4 的四值事实、正反向证明、Intent/Proposal 门、Edge Run、事件重建、Task Brief 冻结、父子地图 Receipt、多层看板和只读 ETag 服务；v0.5 新增 9 项安装/sidecar 隔离测试，包括 Windows AppContainer 文件虚拟化下首次创建前后的路径稳定性。

## 明确边界

- 第一次发现 Mapflow 仍需显式执行一次全局 bootstrap 安装；一个尚不存在的 Skill 无法由自然语言自行出现。
- 本轮没有覆盖用户真实的 `~/.agents/skills/mapflow`，避免未经授权替换正在使用的版本。安装升级后需重新加载支持 Skill discovery 的 Agent。
- sidecar 是本机私有状态。移动工作区路径会得到新的 Workspace Identity；跨机器迁移需要显式导出或交接。
- 仓库内历史 `.mapflow` 不自动迁移，因为无法无损判断其 Blueprint、事件 revision 和工作区身份；需要另行设计显式迁移命令。
- 看板仍是只读 Projection；自动启用不赋予它确认 Fact、执行 Work Edge 或改写 Git 的权限。
