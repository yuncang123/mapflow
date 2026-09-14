# OrderPulse 订单查询超时：Mapflow 基准演示

这是一个与 Mapflow 仓库无关的虚构开发项目。演示目标是：

> 修复订单查询偶发超时，并证明正常请求、超时重试和下游失败回退都符合预期后安全发布。

这个例子刻意保留了起点和目的地的迷雾：仓库已经存在，但超时原因、恢复契约和发布授权都还没有事实证据。反向目标回归先列出完整候选链；人整体审阅并补齐因果、Brief、验收、非目标和授权合同后，`validate/prove` 通过的链才成为正式地图，不逐节点或逐边设置审批门。空白 Sidecar 用 `init` 首次登记，后续局部修订才用 `replan`。

## 1. 先看定义态地图

在仓库根目录执行：

```bash
node tools/mapflow.mjs validate --map examples/order-query-timeout/blueprint.yaml
node tools/mapflow.mjs prove --map examples/order-query-timeout/blueprint.yaml
node tools/mapflow.mjs board --map examples/order-query-timeout/blueprint.yaml --port 4183
```

打开 `http://127.0.0.1:4183`，选择“目标回归”镜头。建议按下面顺序点击：

1. `订单查询可靠性修复已安全发布`：看目的地验收和目标侧后缀证明。
2. `发布窗口与回滚方案已获授权`：看发布授权和前缀仍未接通的状态。
3. `重试与失败回退契约已确认`：看这是一个需要人做路线取舍的决策里程碑。
4. `OrderPulse 仓库存在，但超时原因未知`：看起始迷雾和第一条探查边。

看板是只读投影。它不会因为反向推理自动增加正式节点或边；正式拓扑中的对象都代表已经逐项人工确认、写入 Blueprint，并通过首次 `init` 或后续 `replan` 登记的结果。

## 2. 个人工作区的运行态演示

实际使用时，运行状态应该放在代码仓库之外的 Workspace Sidecar。可以用临时目录模拟：

```powershell
$demoRoot = Join-Path $env:TEMP "orderpulse-api-demo"
New-Item -ItemType Directory -Force $demoRoot | Out-Null
$workspace = node tools/mapflow.mjs enable --root $demoRoot --json | ConvertFrom-Json
Copy-Item examples/order-query-timeout/blueprint.yaml $workspace.paths.map -Force
Copy-Item examples/order-query-timeout/briefs/* $workspace.paths.briefs -Recurse -Force
node tools/mapflow.mjs validate --root $demoRoot
node tools/mapflow.mjs prove --root $demoRoot
node tools/mapflow.mjs init --root $demoRoot
node tools/mapflow.mjs board --root $demoRoot --port 4184
```

此时再打开 `http://127.0.0.1:4184`。对话、勘探和人工确认产生的事实只应通过 Proposal/Confirm 进入 sidecar；正式 Blueprint 通过首次 `init` 或后续局部 `replan` 登记。代码仓库本身不被写入 Mapflow runtime 文件。

## 3. 演示讲解主线

用一句话说明当前状态：

> 在当前仓库事实和显式约束下，修复路线结构完整、逻辑可达，但仍依赖超时原因、恢复契约和发布授权等条件，尚未实际到达。

然后展示五个阶段：

| 阶段 | 地图对象 | 演示重点 |
| --- | --- | --- |
| 勘探 | `service-observed` | 起点有 Git 仓库凭据，超时原因是 unknown |
| 目标回归 | `order-query-reliable` 向前递归 | 每层同时显示后缀证明、前缀可达性和桥接状态 |
| 人工决策 | `recovery-contract` | 人确认重试上限、超时预算、回退语义和幂等不变量 |
| 实施与验收 | `code-ready`、`verification-ready` | Git tag 只作为阶段实现凭据，场景矩阵作为验收证据 |
| 发布审计 | `release-approved`、`order-query-reliable` | Owner 授权、生产回读和非目标边界 |

这个案例不要求真的调用生产系统。示例中的 `git`、`document`、`command` 和 `receipt` 只是证据合同的形状；真正执行时应替换成可回读的项目凭据。
