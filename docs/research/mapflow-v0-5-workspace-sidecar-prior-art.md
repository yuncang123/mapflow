# Mapflow v0.5 Workspace Sidecar Prior Art

日期：2026-09-03

## 问题归类

本次不是普通配置路径调整，而是“用户级工具如何为多个本地工作区保存隔离状态”的运行时与安装边界设计。目标是：Mapflow 全局入口只安装一次；每次在某个工作目录启用时自动建立仓库外 sidecar；Blueprint、Brief、事件和投影不进入目标仓库 Git。

## 检索范围

### 本仓库

- 当前 `tools/install.mjs --target` 把 runtime、模板、Skills 和状态约定写入目标仓库 `.mapflow/`，与新边界冲突。
- 当前全局安装只复制入口 Skill、引用文档和子 Skills，不带可执行 runtime，因此无法在入口触发后自行初始化工作区。
- 当前 CLI 默认状态为相对当前目录的 `.mapflow/state.json`，但已支持显式 `--state`，核心读写函数并不要求状态位于 Git 仓库中。

裁决：复用现有 CLI、事件真相、BoardModel 和原子文件写入；替换默认定位与安装布局，不另造执行引擎。

### XDG Base Directory Specification

来源：[XDG Base Directory Specification](https://specifications.freedesktop.org/basedir-spec/latest/)

`XDG_STATE_HOME` 专门承载需要跨重启保留、但不属于用户可移植文档的数据，缺省为 `~/.local/state`。这与 Mapflow 的 events/state/workspace manifest 语义一致。

裁决：借鉴目录职责。Unix 优先 `XDG_STATE_HOME/mapflow`，缺省 `~/.local/state/mapflow`；Windows 使用本机 `LOCALAPPDATA/Mapflow`。允许测试和高级用户用 `MAPFLOW_HOME` 显式覆盖。

### Git 工作树身份

来源：[git rev-parse](https://git-scm.com/docs/git-rev-parse)

`git rev-parse --show-toplevel` 返回当前工作树根；`--git-common-dir` 则可能让多个 worktree 共享身份。Mapflow 的事实会受当前 checkout 和未提交工作影响，因此不同 worktree 不应默认共享状态。

裁决：借鉴 Git 的 worktree root 发现，使用 canonical `--show-toplevel` 绝对路径作为 Workspace Identity；不使用 remote URL 或 common-dir，避免仓库改名、fork、隐私和多 worktree 串图。

### 编辑器的 workspace-scoped storage

来源：[VS Code Extension API - ExtensionContext](https://code.visualstudio.com/api/references/vscode-api#ExtensionContext)

成熟编辑器区分 global storage 与 workspace-scoped storage：实现属于用户级扩展，状态按 workspace 隔离，项目文件不必承载工具内部数据。

裁决：借鉴“两层所有权”，不采用 VS Code API。Mapflow runtime 属于全局安装；每个本地工作区只有一个外置 sidecar，并在 manifest 中回写 canonical root 以防 hash 碰撞或路径误绑定。

## 方案比较

| 方案 | 优点 | 失败模式 | 裁决 |
| --- | --- | --- | --- |
| 继续写目标仓库 `.mapflow/` | 实现最少、相对路径简单 | 污染 Git、每仓安装、容易误提交 | 拒绝 |
| 只依赖 `.git/info` 或 Git config | 仓库外观干净 | 非 Git 工作不适用；worktree/权限/迁移语义复杂 | 拒绝 |
| 用户级数据库 | 查询和并发能力强 | 对个人本地文件流过重，降低可检查与可恢复性 | 拒绝 |
| 用户状态目录中的 workspace sidecar | 仓库隔离、文件仍可读、可按 worktree 分开 | 路径迁移需要显式重新绑定 | 采用 |

## 最终复用裁决

采用“借鉴设计 + 复用现有组件”：

1. 沿用 Node 标准库、JSON/YAML 文件、append-only JSONL、现有 CLI 和看板，不新增依赖。
2. 新增轻量 Workspace Resolver，把 canonical 工作树路径映射为 `<state-home>/workspaces/<slug>-<sha256-prefix>`。
3. 全局安装包携带完整 runtime、模板、看板和子 Skills；入口 Skill 首步执行 `enable`，幂等创建或恢复 sidecar。
4. 移除面向目标仓库的安装路径；目标仓库保持零 Mapflow 文件、零 AGENTS 修改、零 Git ignore 要求。
5. 显式 `--state`/`--map` 继续服务仓库自身 fixture 与低层诊断；正常用户路径使用当前目录自动解析的 sidecar。

该裁决落在“借鉴设计”，因为 XDG、Git 和编辑器只提供目录与身份原则，Mapflow 特有的地图、事件和验收合同仍由现有实现承担。
