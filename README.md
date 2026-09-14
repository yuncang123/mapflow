# Mapflow

Mapflow 是单人电脑上的工程地图 sidecar。它从已确认的 Destination 反向回归出 State Node 与 Work Edge，再从有来源的当前 Fact 正向证明至少一条路线可达；人或 Agent 只沿当前可信边推进，实际 Evidence 更新 Fact，最后形成可审计 Arrival。

它解决的不是“写一份看起来可实现的计划”，而是四个更严格的问题：

1. 目的地到底由哪些 Predicate 判定；
2. 每条边凭什么能从 premises 推出 conclusions；
3. 当前事实是否真的接通至少一条完整路线；
4. 执行后有什么 witness 能把预期效果升级为已观察事实。

Mapflow 不建设协作空间，也不取代 Jira、Git、PR、CI、测试平台、发布平台或团队沟通。Task Brief 中的小型 `handoff` 合同负责接入真实岗位；`context` 合同与 `mapflow context` 负责渐进式披露和注意力预算。

当前发布版本为 `0.8.0`。版本号只标识源码与用户级安装包，不代表已经部署或获得真实团队采用。

## 最小用法

维护本仓库时使用 `tools/mapflow.mjs`；安装后使用用户级包中的 `runtime/mapflow.mjs`。

```bash
node tools/mapflow.mjs enable --root D:/path/to/workspace --json
node tools/mapflow.mjs context --root D:/path/to/workspace --layer focus --json
node tools/mapflow.mjs next-actions --root D:/path/to/workspace --json
```

没有正式地图时：

```bash
node tools/mapflow.mjs validate --map path/to/blueprint.yaml
node tools/mapflow.mjs prove --map path/to/blueprint.yaml --json
node tools/mapflow.mjs init --root D:/path/to/workspace
```

普通、无额外授权要求的 proven/ready 边可直接启动：

```bash
node tools/mapflow.mjs start --root D:/path/to/workspace --edge implement-contract
```

只有 Task Brief 明确声明授权要求的边才请求授权：

```bash
node tools/mapflow.mjs request-authorization --root D:/path/to/workspace \
  --edge publish-release --question "是否授权执行本次发布？" --decision-owner human:owner
```

执行证据必须来自冻结 verifier、外部 readback 或子地图 receipt；reported pass 只是一条观察，不能更新 Fact。

```bash
node tools/mapflow.mjs issue-action --root D:/path/to/workspace \
  --edge implement-contract --verifier contract-test --json
node tools/mapflow.mjs verify-executed --root D:/path/to/workspace \
  --edge implement-contract --verifier contract-test --capability <one-use-token> \
  --evidence "合同测试实际通过" --outcome-ref command:contract-test --executor tool:mapflow
```

## 上下文披露

`focus` 是默认层，只给当前目的地、当前边、效果、岗位交接摘要和加载预算。更深内容按需取用：

```bash
node tools/mapflow.mjs context --root D:/path/to/workspace --layer focus --json
node tools/mapflow.mjs context --root D:/path/to/workspace --layer work --json
node tools/mapflow.mjs context --root D:/path/to/workspace --layer evidence --json
node tools/mapflow.mjs context --root D:/path/to/workspace --layer history --limit 20 --json
```

达到 Task Brief 的 `max_files` 或 `max_chars` 预算时，先摘要、拆边或建立子地图，不继续扩张当前上下文。

## 仓库结构

```text
mapflow/
├─ docs/workflow.md                    # 行为唯一真源
├─ docs/blueprint/map-model.md         # Blueprint 关系说明
├─ docs/integration/enterprise-handoffs.md
├─ skills/                             # 按当前阶段加载的窄 Skill
├─ templates/                          # 可选 Blueprint / Task Brief 起点
├─ tools/mapflow-core.mjs              # 模型校验、反向闭包、正向证明
├─ tools/mapflow-proof.mjs             # 推导图与证明摘要
├─ tools/mapflow.mjs                   # 运行态、证据与写入门
├─ tools/mapflow-board*.mjs            # 只读投影
└─ tests/                               # 合同与回归验证
```

用户级安装：

```bash
node tools/install.mjs --global
```

安装只写用户级 Mapflow 包；工作空间中的 Blueprint、Brief、events 和 state 位于仓库外 sidecar。Mapflow 仅在用户显式启用时工作。

## 阅读入口

- [行为真源](docs/workflow.md)
- [地图模型](docs/blueprint/map-model.md)
- [企业岗位交接与上下文披露](docs/integration/enterprise-handoffs.md)
- [Skill 路由](docs/skill-routing.md)
- [Community Workshop 示例](examples/community-workshop/README.md)
- [Library System 演化示例](examples/library-system-evolution/README.md)

## 验证

```bash
npm test
npm run benchmark:doctor
npm run demo:evolution
git diff --check
```

本地测试只证明当前代码、合同与 fixtures；不证明发布状态、生产行为、用户价值或企业采用。
