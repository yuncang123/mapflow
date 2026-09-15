---
name: edge-slicing
description: "把候选 Blueprint 中的一条 Work Edge 切成可独立施工的语义化 Task Brief；当边的执行、交接、上下文或证据合同不完整时使用。"
---

# edge-slicing：切出独立工作边

## 步骤

1. **对齐状态变化**：复制 from/to、premises、effects 和适用 invariant。完成条件：Brief 不改变 Destination，不把 expected effect 写成已发生。
2. **固定因果规则**：声明 rule basis、required witnesses 和 non-interference。完成条件：每个 effect 都能由至少一个实际 witness 推出。
3. **检查独立性**：比较同源边；依赖另一边 effect 时插入中间 State Node。完成条件：本边不读取同源边的未建模临时产物。
4. **限定执行面**：记录 in/out scope、允许动作和真正需要的外部授权。完成条件：普通本地工作不产生审批门，受保护动作有明确 decision owner。
5. **定义岗位接口**：只在跨角色时填写 `handoff` 的 from/to、inputs、outputs、decision rights。完成条件：交接内容可观察且保持在外部权威系统中，Mapflow 只存引用。
6. **限定上下文**：当默认 Focus 不足或材料容易超载时，填写一句 focus、最多五个 load-first、带触发条件的按需引用和 max-files/max-chars。完成条件：需要声明 context 的边可以先只读 Focus，超预算时可拆边或建子图；简单边不为完整字段增加仪式。
7. **绑定失败分支**：声明 replan、branch 或 stop 以及回滚边界。完成条件：失败不会被包装成完成，也不覆盖既有 Evidence。

使用用户级包的 `templates/task-brief.md` 作为可选起点，把 Brief 写入 `enable --json` 返回的 `paths.briefs`；文件使用工作语义命名。
