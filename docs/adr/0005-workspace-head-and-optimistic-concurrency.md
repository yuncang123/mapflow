# ADR 0005: 唯一 Workspace Head 与乐观并发写门

## Status

Accepted

## Context

Sidecar 已有 Wayfinding、Blueprint、事件流、state 和 BoardModel，但它们过去各自暴露 digest 或 projection revision。看板点击后会写入事件，Agent 也可能继续依赖聊天中的旧 Context Pack；两个客户端因此可能同时认为自己面对“当前地图”。单独的文件原子替换只能防半写，不能防 lost update，也不能证明仓库运行时与用户级安装运行时解释的是同一份合同。

## Decision

在 `current/head.json` 建立唯一 `mapflow.workspace-head/v1`。Head revision 等于当前阶段的事件链头：建模期绑定 Wayfinding 事件头，正式运行期绑定 runtime 事件头；同时固定地图、事件和 state 摘要，以及 runtime version/build digest。Head 是 current commit pointer，不复制 Destination、节点、边或 Fact。

CLI 和工作区看板共用 Workspace Snapshot reader。reader 在本机排他锁内校验 Head 与源文件，再生成 Focus、当前问题、下一动作和 BoardModel。Context Pack 与 BoardModel 只是同一 revision 的投影，不拥有独立真相。

所有正式写命令必须携带 `expected_revision`。写事务持有同一把锁，先比较 revision 与 runtime identity，再保存文件检查点、执行既有事件写入、原子替换 Head并强制 readback；不匹配或提交失败时 fail closed。这个语义等价于条件写入中的 `If-Match`，实现只使用 Node 原生文件 API和 `open(..., "wx")`，不引入数据库或常驻协调服务。

每个 Mapflow 回合和每次写入前都重新执行 `snapshot --root`。看板直接监听 Head、Wayfinding、两条事件流和 state；页面动作成功后先显示“已记录，等待 Codex 处理”，只有后续 Head revision 前进才显示“已应用到地图”。runtime mismatch 时仍可读取诊断信息，但关闭看板回答入口并拒绝正式写入。

## Consequences

- 旧聊天上下文、旧看板响应或并发终端不能覆盖新地图；它们的写入会在产生事件前被拒绝。
- Head、事件和源文件可相互校验；绕过合同的直接编辑不会静默成为 current truth。
- 每次写多一次小文件原子替换和 readback，每次快照需要短暂获取本机锁；这是单人本机 sidecar 可接受的成本。
- 首次启用可无 Head 启动；已有 Head 的 runtime 升级必须先核对安装 build，再以当前 revision 显式运行 `enable --expected-revision` 重绑。
- 该机制保证本机状态一致性，不等于分布式事务、跨机器同步、产品验收或生产安全。
