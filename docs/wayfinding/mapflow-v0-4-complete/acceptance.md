# Mapflow v0.4 个人本地版验收报告

日期：2026-09-03

结论：仓库内 v0.4 已达到“个人本地可用、可重复验收”的版本基线；尚未执行 Git push、tag、npm publish、全局覆盖安装或真实业务项目验收，因此不声明对外发布完成。

## 已验收能力

- Intent 必须 shaped 且无开放问题才可批准 Destination。
- Work Event 只生成 Proposal；confirm 后才更新四值 Fact，stale/reject 不污染事实。
- Decision Record 与 Edge Run 分离；active、waiting、blocked、passed、failed、cancelled 可追溯，多次尝试不覆盖。
- waiting/blocked 释放 active slot；取消 dormant run 不改变另一条 active run。
- verify 显式区分 pass/fail；失败不应用 expected effects，并执行 replan/branch/stop。
- `.mapflow/events.jsonl` 为追加事件真相；envelope、map identity、revision、seq、唯一性、hash chain 和最新 projection/state 等价均会校验，state 可重建。
- Blueprint、Task Brief、运行 Evidence、Map Receipt 和投影职责分离；冷启动 stale 时仍显示冻结 Brief。
- 父图单向绑定 child；只有 child map/digest、arrival、Acceptance、Predicate 和 Evidence 回读均通过时才接纳 Map Receipt。
- 已接纳 Receipt 固定 child Blueprint digest 与 arrival state revision；漂移 fail closed，并明确引导还原固定版本或建立 successor parent map；会作废已接纳 Receipt 的原地 replan 在写入前拒绝。
- 看板只读、ETag 增量刷新、最近有效快照、stale 提示、搜索/镜头/Inspector、窄屏和 reduced-motion 合同保留。
- 子地图可以按 `parent-binding/child-binding` 语义路径递归展开；每层使用独立 Cytoscape namespace、compound container 和 projection-only portal edge。

## 可重复证据

### 自动化

```text
npm test
50 tests / 50 pass / 0 fail
```

覆盖核心推理、OR/AND、迷雾、循环预算、隐藏边耦合、Task Brief 合同、replan 冻结边界、Proposal 门、事件重建与篡改、Edge Run 生命周期、备用分支、父子回执、stale、递归子地图 API、安装和只读 HTTP。

### 示例地图

```text
validate: map_id=run-community-workshop, maps=3, bindings=2
prove: structural=complete, reachability=conditional, destination_reachable=true
runtime: phase=arrived, actual_arrival=audited, receipt=current
```

示例只证明本地合同和演示凭据，不证明现实工作坊已经举办、有人报名或参与者满意。

### 真实浏览器

- 父图初始 3 个可导航对象；展开准备图后为 11 个列表对象，再展开议程孙图后为 17 个，并显示两层 compound terrain 与各层 portal edge。
- 两层 `aria-expanded` 均从 `false` 切换为 `true`，刷新后 17 个对象和双层展开状态保持；逐层收缩可恢复父级视图。
- 父边在画布中被 portal route 替代后，Inspector 与收缩按钮仍保持可用。
- 低高度桌面窗口中路线列表被约束在自身滚动区，底部时间线不再遮挡鼠标选择；键盘焦点路径保持可用。
- 展开状态下 console error/warning 为 0。
- 展开、刷新、收缩和再次展开前后，父/子/孙 Blueprint、state、events 九个真相文件 SHA256 完全一致。

### 隔离安装

隔离目录安装后确认：

```text
version=0.4.0
event_schema=mapflow.event/v1
capabilities=intent,proposal-gate,edge-runs,submap-receipts,multiresolution-board
installed example validate/prove passed
```

安装器没有修改目标 `AGENTS.md`，验收临时目录已清理；没有覆盖用户全局 Mapflow。

## 明确未证明

- 未在真实业务项目完成 Owner 验收；社区工作坊只是非编码 fixture。
- 未证明云同步、多人并发权限、远程编排、第三方平台写入或生产部署；这些不属于个人本地 v0.4。
- 未证明浏览器投影可以替代事件真相、Evidence 或产品验收；看板始终只读。
- 未创建发布 tag、Release 或 npm 包，也未推送当前工作树。

## 验收入口

```powershell
npm test
node tools/mapflow.mjs validate --map examples/community-workshop/blueprint.yaml --json
node tools/mapflow.mjs prove --map examples/community-workshop/blueprint.yaml --json
node tools/mapflow.mjs --state examples/community-workshop/.mapflow/state.json status --json
node tools/mapflow.mjs --state examples/community-workshop/.mapflow/state.json board --port 4180
```

本轮已运行 `git diff --check` 与 Markdown 本地链接检查且通过；任何后续改动都会使本报告的测试计数成为历史快照，需要重新验收。
