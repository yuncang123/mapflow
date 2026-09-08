# 社区工作坊多分辨率示例

这是一个与编码无关的三层地图：父图表示“工作坊可举办”，复杂准备由 `preparation/blueprint.yaml` 子地图完成，议程回读再由 `preparation/agenda/blueprint.yaml` 孙图独立验收。本产品仓库特意提交了三层已到达运行 fixture 和两级回执，便于重复测试递归展开/收缩、Edge Run、Acceptance 和 receipt；`.mapflow` 在这里仅是历史 fixture 目录形状，不是面向实际工作区的存储约定。

```bash
node tools/mapflow.mjs --state examples/community-workshop/.mapflow/state.json board --port 4180
```

浏览器打开 `http://127.0.0.1:4180`，选择“完成工作坊准备”并展开第一层；再选择子图里的“验收可读议程”，继续展开 `workshop-preparation/agenda-readability`。这些 state/events 只证明示例合同，不代表现实活动已经举办。

每层仍保持独立 Blueprint、state、events 和到达回执；父图只能通过逐层 readback 接纳下一层事实。实际使用时，这些文件全部位于该工作区的仓库外 Workspace Sidecar。
