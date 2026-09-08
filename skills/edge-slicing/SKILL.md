---
name: edge-slicing
description: "把候选 Blueprint 中的一条 Work Edge 切成可独立施工的语义化 Task Brief；当地图尚未校验、边的执行面、授权或证据合同仍不完整时使用。"
---

# edge-slicing：切出独立工作边

## 输入

- 候选 Blueprint 和待定形的唯一 Work Edge；在地图校验与批准前完成。
- 该边的 from/to State Node、preconditions、effects、invariants 和 evidence contract。
- 目标环境约定；事实不足时返回起始状态勘探（仅仓库型工作加载 `repository-recon`），路线错误时返回 `blueprint-planning`。

## 步骤

1. **对齐状态变化**：复制边的 from、to、前置和效果。完成条件：Task Brief 不改变 Destination，也不把 expected effect 说成已发生。
2. **独立性检查**：比较同源其他边；共享起始 Fact 可以，依赖另一边的 effect 必须先插入中间 State Node。完成条件：brief 不需要读取同源边的临时产物。
3. **限定执行面**：记录允许写入、外部动作、执行器、非目标和授权。完成条件：执行者无需猜测能改什么，新增权限会要求重新证明路线。
4. **绑定证据**：把每项 required evidence 映射到 effect Predicate 和可观察出口。完成条件：所有 effect 都能由实际证据证明。
5. **失败边界**：记录 replan、branch 或 stop，以及可回滚状态。完成条件：失败不会被包装成完成，也不会覆盖既有证据。

## 产出

使用 Mapflow 用户级包的 `templates/task-brief.md` 作为可选起点，把实际 Brief 写入 `enable --json` 返回的 `paths.briefs`。文件名采用工作语义，例如 `review-candidate.md`；不用顺序票号表达意义，也不写入目标工作区。
