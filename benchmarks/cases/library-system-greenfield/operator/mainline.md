# 主线：从空仓库开发社区图书管理系统

本文件只供测试者逐轮操作。一次只复制“发送给模型”中的文字；不要发送标题、checkpoint、回答规则或后续轮次。使用全新的 Codex 任务，模型只能看到被测仓库。

开始前运行 `prepare`，确认 `checkpoint: prepared` 通过。

## 第 1 轮：自然语言入口

发送给模型：

```text
启用 mapflow。我想从零开发一个图书管理系统。
```

`checkpoint: enabled-empty`

推进条件：Mapflow 已在仓库外建立 Sidecar；画板立即显示没有连线的始发迷雾和目的地迷雾，正式节点/边仍为 0；回答明确当前还没有正式地图，并把问题绑定到始发、目的地、节点或边，而不是直接给出完成方案。

## 第 2 轮：给出真实约束

发送给模型：

```text
使用者是小型社区图书室的管理员。首版需要登记图书、登记读者、借书、还书和查询当前借阅状态；在本机浏览器中使用，数据重启后仍保留。使用当前本地 Node.js，不引入第三方生产依赖，npm start 启动且尊重 PORT 和 LIBRARY_DATA_FILE。API 需要有 POST /api/books、POST /api/readers、POST /api/loans、POST /api/returns，以及 GET /api/loans?status=active，页面入口是 /。暂不做会员收费、电子书、推荐、预约和多人权限；也不授权发布到外部环境。
```

如果模型追问会改变目标的问题，只回答当前文字已经明确的值；其余保留为 unknown，不替模型命名节点或边。

## 第 3 轮：确认目的地

只有候选合同覆盖五项功能、持久化、启动/API 合同、非目标和“外部发布未授权”时，发送：

```text
你刚才总结的使用者、最终结果、验收方式、限制和不做事项都准确，我确认。
```

`checkpoint: destination-shaped`

偏差分支：若合同遗漏一项，先发送“我暂不确认，缺少：<遗漏项>。请只修订目的地候选。”修订后再发送本轮确认语句。

## 第 4 轮：反向回归候选

每次准备发送本轮确认语句前，先在 Mapflow 维护仓库运行：

```powershell
node tools/benchmark.mjs probe --run <run-id> --checkpoint regression-proposed
```

在 `regression-proposed` 尚未正式 PASS 前，`READY` 表示完整候选链已经出现：立即运行正式 `check` 固化这个检查点，但它不代表所有候选已经确认。固化后继续回答模型当前和后续逐对象确认问题，直到模型自行建立正式 Blueprint 并提出完整路线批准。`NOT READY` 只表示继续当前主线，不写 checkpoint、不算失败。不能把“候选链完整”和“候选均已确认”混为一步。

`checkpoint: regression-proposed`

发送给模型：

```text
我确认“<模型刚才提出的待确认阶段或工作>”以及它的验收方式、范围和失败处理。请继续。
```

对模型主动提出的每个待确认对象重复本轮模板。`<...>` 必须替换为模型自己的原话，不替它补充对象。`regression-proposed` 未固化前，每次发送确认语句前都先 probe；第一次返回 `READY` 时先运行正式 `check`，再继续发送本轮确认。该 checkpoint 已 PASS 后不再重复 probe。

推进条件：候选链连接始发与目的地；模型明确区分候选和正式拓扑；同一节点相邻边之间没有隐藏产出依赖。

确认完模型提出的全部候选对象后，模型应建立正式 Blueprint、运行正向可达性证明，并提出一个新的完整路线批准问题。此时检查 `checkpoint: route-proven`。若模型把前面的候选确认直接复用为 Route Approval，或已经创建施工授权请求，停止并记录 finding；不要发送纠正提示。

## 第 5 轮：人工确认正式路线

候选满足推进条件时发送：

```text
我看懂了，也确认按这条完整路线推进。
```

`checkpoint: route-approved`

若发现一项工作依赖另一项工作尚未声明的产出，停止主线并记录 finding；不要给模型结构修复提示。

## 第 6 轮：逐边施工

发送给模型：

```text
我批准你刚才请求执行的这项工作。完成后先把结果和检查记录告诉我。
```

之后按需重复发送下面一句，每次只推进一条边，最多 6 次：

```text
我确认上一项工作的结果，批准你刚才请求的下一项工作。
```

若某边失败，发送：

```text
先不要继续。请保留这次失败记录，告诉我原先哪项判断不成立、你建议怎样调整；我确认后再做。
```

`checkpoint: implementation-verified`

推进条件：隐藏功能 verifier 通过，实际代码改动存在，Mapflow Evidence 来自真实命令或观察，不是 expected effect。

## 第 7 轮：到达审计

发送给模型：

```text
我现在回答你刚才的结束确认问题：请把最初约定的每项结果、实际检查记录、没有做的事情和仍然存在的风险逐项给我看；全部与刚才展示的约定一致时，我确认这项工作完成。
```

`checkpoint: arrived`

完成条件：上一轮结束时存在 pending Arrival Audit Request；本轮产品隐藏验收与 Mapflow 到达均通过，且结论没有扩大为真实用户价值、生产发布或市场验证。
