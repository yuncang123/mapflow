# Mapflow Board 视觉与交互合同

## Subject

使用者是正在找路和执行路线的人。页面只有一个工作：回答“我们在哪里、为什么、接下来能走哪条边”。视觉语言取自测绘台和航路图，而不是项目管理后台。

## Tokens

- Chart paper `#edf2f1`：冷调地图底纸。
- Slate ink `#18252d`：正文与结构线。
- River teal `#16766f`：已验证事实与路线。
- Signal amber `#bd731d`：活动边与条件可达。
- Fog violet `#817c9d`：未知和迷雾。
- Fault coral `#c8564f`：冲突与 proof gap。
- Display：Bahnschrift；body：Segoe UI Variable；data：Cascadia Mono，并提供系统 fallback。

## Layout

```text
┌──────────────────────────────────────────────────────────────┐
│ Destination / proof / actual arrival / source revision       │
├──────────────┬───────────────────────────┬───────────────────┤
│ Route lens   │ Cytoscape survey canvas  │ Field inspector   │
│ search       │                           │ why / evidence    │
│ filters      │                           │ brief / acceptance│
│ accessible   │                           │                   │
│ element list │                           │                   │
├──────────────┴───────────────────────────┴───────────────────┤
│ Change soundings: runtime history and evidence events        │
└──────────────────────────────────────────────────────────────┘
```

窄屏按“摘要 → 图 → 检查器 → 时间线”纵向排列。左侧列表是画布的键盘可达替代入口。

## Signature

画布使用低对比坐标格和测绘刻度；活动 Work Edge 是唯一持续运动的“航迹脉冲”。系统尊重 `prefers-reduced-motion`，其余装饰保持静止。

## Interaction contract

- 首屏显示 Destination 和当前 proof，不以营销式 hero 稀释任务。
- 普通 state/evidence 更新只改数据和样式，保持用户摆放与视口；拓扑签名变化才重新布局。
- `proven`、`candidate`、`fog/gap` 三种视图可切换；搜索匹配语义 ID、标签和 Predicate。
- 点击节点或边在 Inspector 解释来源、条件、效果、证据、验收和失败分支。
- 所有来自工作文件的文本使用 `textContent` 渲染；不执行 Markdown HTML，不提供业务写入按钮。
