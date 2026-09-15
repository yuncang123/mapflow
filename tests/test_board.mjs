import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { compileBoardModel, createBoardSnapshotReader } from "../tools/mapflow-board-core.mjs";
import { createBoardServer } from "../tools/mapflow-board.mjs";
import {
  activityGraphElements,
  collapsedSubmapElements,
  currentActionView,
  edgeExecutionLabel,
  navigationPositionView,
  parallelEdgeLane,
  selectElementIds,
  timelineEventLabel,
  topologySignature,
  wayfindingDestinationView,
  wayfindingNextAction,
} from "../tools/board/app.js";
import { createArrivalCheckpoint, initialFacts, proveBlueprint, readBlueprint } from "../tools/mapflow-core.mjs";
import { readWayfinding } from "../tools/mapflow-wayfinding.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const TEMPLATE_MAP = path.join(ROOT, "templates", "blueprint.yaml");
const ORDER_TIMEOUT_MAP = path.join(ROOT, "examples", "order-query-timeout", "blueprint.yaml");

function copyTemplate() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-board-"));
  fs.cpSync(path.join(ROOT, "templates"), directory, { recursive: true });
  return { directory, mapPath: path.join(directory, "blueprint.yaml") };
}

function runtimeState(loaded, mapPath) {
  const facts = initialFacts(loaded.blueprint);
  return {
    schema: 2,
    phase: "wayfinding",
    destination_status: "draft",
    map: path.basename(mapPath),
    map_digest: loaded.digest,
    map_id: loaded.blueprint.map_id,
    active_edge: null,
    verified_edges: [],
    verified_edge_contracts: {},
    blueprint_snapshot: structuredClone(loaded.blueprint),
    brief_digests: loaded.brief_digests,
    loop_iterations: {},
    facts,
    satisfied_nodes: [],
    last_proof: proveBlueprint(loaded.blueprint, facts),
    evidence: [],
    updated_at: "2026-09-03T00:00:00Z",
    history: [],
  };
}

function regressionEdge(id, from, to, proofStatus = "logical") {
  const predicate = `${id}-established`;
  return {
    id,
    from,
    to,
    label: id,
    purpose: "独立候选工作及其回读出口",
    status: "pending",
    brief_ref: `briefs/${id}.md`,
    preconditions: ["source-observed"],
    effects: [predicate],
    invariants: ["scope-preserved"],
    evidence_contract: [{ id: `${id}-evidence`, proves: [predicate], required: true }],
    acceptance: [{ id: `${id}-accepted`, proves: [predicate], proof: "出口可回读" }],
    non_goals: ["不扩大工作范围"],
    certainty: "expected",
    on_failure: { action: "replan", scope: `edge:${id}` },
    proof: { status: proofStatus, summary: `候选边 ${proofStatus} 证明`, missing: [], evidence_refs: [] },
  };
}

function regressionDraft(edges, nodes = []) {
  return {
    schema_version: 1,
    phase: "regression",
    intent: { statement: "建立一个可验收的演示路线", status: "shaped", open_questions: [] },
    origin: { id: "origin-fog", kind: "fog", label: "起始事实仍有迷雾", facts: [] },
    destination: {
      id: "destination",
      kind: "destination",
      label: "目标已定形",
      statement: "目标已满足",
      status: "confirmed",
      requires: ["goal-met"],
      invariants: [],
      acceptance: [{ id: "goal-accepted", proves: ["goal-met"], proof: "目标状态可回读" }],
    },
    boundaries: { in_scope: ["目标路线"], out_of_scope: ["无关扩展"], authorization: [] },
    nodes,
    edges,
    questions: [],
  };
}

test("an empty workspace exposes onboarding without inventing a Blueprint", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-empty-board-"));
  const reader = createBoardSnapshotReader({ statePath: path.join(directory, "current", "state.json") });
  const snapshot = reader();
  assert.equal(snapshot.model.projection.mode, "empty");
  assert.equal(snapshot.model.projection.source_status, "empty");
  assert.equal(snapshot.model.map.id, "unshaped-workspace");
  assert.equal(snapshot.model.map.intent.status, "draft");
  assert.equal(snapshot.model.proof.reachability, "not-started");
  assert.equal(snapshot.model.summary.reachability, "not-started");
  assert.equal(snapshot.model.summary.nodes, 0);
  assert.equal(snapshot.model.summary.edges, 0);
  assert.deepEqual(snapshot.model.nodes, []);
  assert.deepEqual(snapshot.model.edges, []);
  assert.equal(snapshot.model.goal_regression.steps.length, 0);
  assert.equal(snapshot.model.projection.read_only, true);
});

test("a collapsed submap replaces its parent edge with one readable node", () => {
  const binding = {
    id: "prepare-workshop",
    map_id: "workshop-preparation",
    parent_edge: "complete-workshop-preparation",
    actual_arrival: "audited",
    source_status: "current",
    receipt_status: "current",
  };
  const parentEdge = { id: binding.parent_edge, title: "完成工作坊准备", from: "request-confirmed", to: "workshop-ready" };
  const collapsed = collapsedSubmapElements(binding, parentEdge, binding.id);
  assert.equal(collapsed.node.id, "submap::prepare-workshop");
  assert.equal(collapsed.node.kind, "submap");
  assert.equal(collapsed.node.collapsed, true);
  assert.equal(collapsed.node.status, "arrived");
  assert.match(collapsed.node.label, /完成工作坊准备/);
  assert.match(collapsed.node.label, /已审计 0\/0/);
  assert.match(collapsed.node.label, /双击展开/);
  assert.deepEqual(collapsed.edges.map((edge) => [edge.from, edge.to]), [
    ["request-confirmed", "submap::prepare-workshop"],
    ["submap::prepare-workshop", "workshop-ready"],
  ]);
});

test("wayfinding next action does not register a Blueprint before regression closes", () => {
  assert.doesNotMatch(wayfindingNextAction("survey"), /写入 Blueprint|登记变更/);
  assert.doesNotMatch(wayfindingNextAction("shaping"), /写入 Blueprint|登记变更/);
  assert.match(wayfindingNextAction("regression"), /审阅完整候选链.*validate\/prove/);
  assert.match(wayfindingNextAction("regression"), /写入 Blueprint/);
});

test("wayfinding draft projects the origin candidate and question target before formal Blueprint", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-wayfinding-board-"));
  const current = path.join(directory, "current");
  fs.mkdirSync(current, { recursive: true });
  fs.writeFileSync(path.join(current, "wayfinding.yaml"), `schema_version: 1
phase: survey
intent:
  statement: 收敛订单查询超时的可验收目的地
  status: draft
  open_questions:
    - 是否构造本地模拟服务
origin:
  id: orderpulse-origin-fog
  kind: fog
  label: 仓库存在，但超时根因未知
  facts:
    - id: repo-present
      value: "true"
      evidence:
        - kind: git
          ref: orderpulse-api@main
    - id: timeout-cause
      value: unknown
      evidence: []
destination:
  id: orderpulse-destination-fog
  kind: fog
  label: 目的地尚未定形
  statement: 订单查询可靠性修复已安全发布
  status: pending
nodes: []
edges: []
questions:
  - id: choose-scope
    prompt: 这次要构造本地模拟服务，还是只做工作流建模？
    target:
      kind: destination
      id: orderpulse-destination-fog
      label: 目的地尚未定形
      purpose: 确定 Destination 的可观察 Predicate、验收、非目标和实施边界
    status: pending
    answer_updates:
      - wayfinding.intent.status
      - wayfinding.intent.open_questions
      - wayfinding.destination.status
`, "utf8");
  const reader = createBoardSnapshotReader({ statePath: path.join(current, "state.json") });
  const snapshot = reader();
  assert.equal(snapshot.model.projection.mode, "wayfinding");
  assert.equal(snapshot.model.map.wayfinding_phase, "survey");
  assert.equal(snapshot.model.wayfinding.phase, "survey");
  assert.equal(snapshot.model.summary.nodes, 0);
  assert.equal(snapshot.model.summary.edges, 0);
  assert.equal(snapshot.model.summary.draft_nodes, 2);
  assert.equal(snapshot.model.summary.draft_edges, 0);
  assert.equal(snapshot.model.summary.facts.unknown, 1);
  assert.equal(snapshot.model.summary.pending_regression_candidates, 0);
  assert.equal(snapshot.model.summary.open_questions, 1);
  assert.equal(snapshot.model.nodes.find((node) => node.id === "orderpulse-origin-fog").draft, true);
  assert.equal(snapshot.model.nodes.find((node) => node.id === "orderpulse-destination-fog").status, "destination-fog");
  assert.equal(snapshot.model.questions[0].target.kind, "destination");
  assert.equal(snapshot.model.questions[0].target.id, "orderpulse-destination-fog");
  assert.deepEqual(snapshot.model.wayfinding.current_target, snapshot.model.questions[0].target);
  const visible = selectElementIds(snapshot.model, "proven");
  assert.deepEqual(visible.nodes.sort(), ["orderpulse-destination-fog", "orderpulse-origin-fog"]);
  assert.deepEqual(visible.edges, []);
  assert.match(topologySignature(snapshot.model), /orderpulse-origin-fog/);
});

test("wayfinding shaping projects the complete destination contract before confirmation", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-wayfinding-destination-contract-"));
  const current = path.join(directory, "current");
  fs.mkdirSync(current, { recursive: true });
  fs.writeFileSync(path.join(current, "wayfinding.yaml"), `schema_version: 1
phase: shaping
intent:
  statement: 为本地图书管理员提供可持久化的核心借阅流程
  status: draft
  open_questions: [是否确认完整目的地合同]
origin:
  id: empty-repository
  kind: state
  label: 只有 README 的空仓库
  facts:
    - id: repository-exists
      value: "true"
      evidence:
        - kind: git
          ref: status-readback
destination:
  id: library-system-ready
  kind: destination
  label: 核心借阅流程可验收
  statement: 管理员可登记图书和读者，并完成借书、查询和归还
  status: pending
  requires: [registration-usable, loan-lifecycle-usable, restart-persistence-verified]
  invariants: [no-production-dependencies]
  acceptance:
    - id: core-flow-readback
      proves: [registration-usable, loan-lifecycle-usable]
      proof: 浏览器逐项完成核心流程
    - id: restart-readback
      proves: [restart-persistence-verified]
      proof: 重启后借阅状态保持一致
boundaries:
  in_scope: [登记、借书、查询和归还]
  out_of_scope: [收费、推荐和外部发布]
  authorization: [外部发布需要另行授权]
nodes: []
edges: []
questions:
  - id: confirm-destination
    prompt: 是否确认这份目的地合同？
    target:
      kind: destination
      id: library-system-ready
      label: 核心借阅流程可验收
      purpose: 确认目标 Predicate、验收、非目标和授权边界
    status: pending
    answer_updates: [wayfinding.intent.status, wayfinding.destination.status]
`, "utf8");

  const model = createBoardSnapshotReader({ statePath: path.join(current, "state.json") })().model;
  assert.deepEqual(model.map.destination.requires, ["registration-usable", "loan-lifecycle-usable", "restart-persistence-verified"]);
  assert.equal(model.map.destination.acceptance.length, 2);
  assert.deepEqual(model.map.boundaries.out_of_scope, ["收费、推荐和外部发布"]);
  assert.equal(model.acceptance[0].status, "pending");
  assert.equal(model.summary.acceptance_total, 2);
  assert.match(model.empty_state.next_steps[0], /目标谓词、验收、非目标、不变量和授权边界/);
  assert.doesNotMatch(model.empty_state.next_steps.join(" "), /Blueprint|登记正式/);
  const destination = model.nodes.find((node) => node.id === "library-system-ready");
  assert.deepEqual(destination.predicates.map((predicate) => predicate.id), model.map.destination.requires);
});

test("wayfinding candidate edges preserve human-confirmed contracts for the next regression step", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-wayfinding-contract-"));
  const current = path.join(directory, "current");
  fs.mkdirSync(current, { recursive: true });
  fs.writeFileSync(path.join(current, "wayfinding.yaml"), `schema_version: 1
phase: regression
intent:
  statement: 收敛一个可验收目的地
  status: shaped
  open_questions: []
origin:
  id: origin-fog
  kind: fog
  label: 当前起始状态仍有未知
  facts:
    - id: source-present
      value: "true"
      evidence: []
destination:
  id: destination-fog
  kind: destination
  label: 目标已定形但尚未到达
  statement: 目标已满足
  status: confirmed
  requires: [milestone-observed]
  invariants: []
  acceptance:
    - id: destination-accepted
      proves: [milestone-observed]
      proof: 里程碑状态可回读
boundaries:
  in_scope: [建立阶段里程碑]
  out_of_scope: [实施后续目标]
  authorization: []
nodes:
  - id: milestone-ready
    kind: state
    label: 阶段里程碑已确认
    purpose: 反向回归得到的可观察中间状态
    status: confirmed
edges:
  - id: establish-milestone
    from: origin-fog
    to: milestone-ready
    label: 建立阶段里程碑
    purpose: 独立完成并回读里程碑条件
    status: confirmed
    brief_ref: briefs/establish-milestone.md
    preconditions: [source-present]
    effects: [milestone-observed]
    invariants: [no-side-effect]
    evidence_contract:
      - id: milestone-readback
        proves: [milestone-observed]
        required: true
        proof: 回读记录证明里程碑已成立
    acceptance:
      - id: milestone-accepted
        proves: [milestone-observed]
        proof: 验收记录可回读
    non_goals: [不实施后续目标]
    certainty: conditional
    on_failure:
      action: replan
      scope: edge:establish-milestone
    proof:
      status: conditional
      summary: 仍依赖未知的外部前置
      missing: [external-ready]
      evidence_refs: []
questions: []
`, "utf8");
  const reader = createBoardSnapshotReader({ statePath: path.join(current, "state.json") });
  const snapshot = reader();
  const edge = snapshot.model.edges.find((item) => item.id === "establish-milestone");
  assert.equal(snapshot.model.wayfinding.phase, "regression");
  assert.equal(snapshot.model.summary.pending_regression_candidates, 0);
  assert.equal(edge.brief.ref, "briefs/establish-milestone.md");
  assert.deepEqual(edge.preconditions, ["source-present"]);
  assert.deepEqual(edge.effects, ["milestone-observed"]);
  assert.deepEqual(edge.applicable_invariants, ["no-side-effect"]);
  assert.deepEqual(edge.non_goals, ["不实施后续目标"]);
  assert.equal(edge.proof.status, "conditional");
  assert.equal(edge.acceptance[0].id, "milestone-accepted");
});

test("wayfinding regression projects a destination-first candidate chain and keeps human confirmation separate from formal registration", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-wayfinding-regression-board-"));
  const current = path.join(directory, "current");
  fs.mkdirSync(current, { recursive: true });
  fs.writeFileSync(path.join(current, "wayfinding.yaml"), `schema_version: 1
phase: regression
intent:
  statement: 交付一个可回读的查询修复
  status: shaped
  open_questions: []
origin:
  id: origin-fog
  kind: fog
  label: 当前服务事实仍有迷雾
  facts:
    - id: source-present
      value: "true"
      evidence: []
    - id: cause-known
      value: unknown
      evidence: []
destination:
  id: destination
  kind: destination
  label: 查询修复已安全发布
  statement: 查询修复已安全发布
  status: confirmed
  requires: [published]
  invariants: [no-unapproved-publish]
  acceptance:
    - id: destination-observed
      proves: [published]
      proof: 发布结果可回读
boundaries:
  in_scope: [诊断、实现和发布观察]
  out_of_scope: [修改无关接口]
  authorization: [发布前需要人工授权]
nodes:
  - id: implementation-ready
    kind: state
    label: 实现已完成且可回滚
    purpose: 固定施工出口
    status: confirmed
  - id: cause-understood
    kind: state
    label: 根因已复现并定位
    purpose: 固定诊断出口
    status: pending
edges:
  - id: release-observe
    from: implementation-ready
    to: destination
    label: 发布并回读
    purpose: 建立发布后的观察状态
    status: pending
    brief_ref: briefs/release-observe.md
    preconditions: [implementation-ready]
    effects: [published]
    invariants: [no-unapproved-publish]
    evidence_contract:
      - id: production-readback
        proves: [published]
        required: true
        proof: 发布回读
    acceptance:
      - id: observe-accepted
        proves: [published]
        proof: 可回读的发布记录
    non_goals: [不修改无关接口]
    certainty: conditional
    on_failure:
      action: replan
      scope: edge:release-observe
    proof:
      status: conditional
      summary: 依赖授权窗口
      missing: [owner-approval]
      evidence_refs: []
  - id: implement-recovery
    from: cause-understood
    to: implementation-ready
    label: 实现恢复契约
    purpose: 形成可回滚实现
    status: pending
    brief_ref: briefs/implement-recovery.md
    preconditions: [cause-understood]
    effects: [implementation-ready]
    invariants: [no-unapproved-publish]
    evidence_contract:
      - id: implementation-readback
        proves: [implementation-ready]
        required: true
        proof: Git tag 和测试回读
    acceptance:
      - id: implementation-accepted
        proves: [implementation-ready]
        proof: 阶段验收记录
    non_goals: [不执行发布]
    certainty: expected
    on_failure:
      action: replan
      scope: edge:implement-recovery
    proof:
      status: logical
      summary: 目标后缀可达
      missing: []
      evidence_refs: []
questions: []
`, "utf8");
  const reader = createBoardSnapshotReader({ statePath: path.join(current, "state.json") });
  const snapshot = reader();
  const model = snapshot.model;
  assert.deepEqual(model.goal_regression.steps.map((step) => step.target_node), [
    "destination",
    "implementation-ready",
    "cause-understood",
  ]);
  assert.deepEqual(model.goal_regression.edge_ids, ["release-observe", "implement-recovery"]);
  assert.equal(model.goal_regression.steps[0].human_confirmed, true);
  assert.equal(model.goal_regression.steps[0].formal, false);
  assert.equal(model.goal_regression.steps[1].human_confirmed, true);
  assert.equal(model.goal_regression.steps[2].human_confirmed, false);
  assert.equal(model.goal_regression.steps[1].suffix_proof.status, "conditional");
  assert.equal(model.goal_regression.steps[2].suffix_proof.status, "conditional");
  assert.equal(model.goal_regression.steps[1].bridge_status, "awaiting-prefix");
  const releaseEdge = model.edges.find((edge) => edge.id === "release-observe");
  assert.equal(releaseEdge.goal_regression[0].human_confirmed, false);
  assert.equal(releaseEdge.goal_regression[0].suffix_proof.status, "logical");
  assert.equal(releaseEdge.goal_regression[0].prefix_reachability.status, "model-only");
  const currentRoute = selectElementIds(model, "proven");
  assert.ok(currentRoute.nodes.includes("destination"));
  assert.ok(currentRoute.nodes.includes("implementation-ready"));
  assert.equal(currentRoute.edges.includes("release-observe"), false);
  const focusedModel = structuredClone(model);
  focusedModel.wayfinding.current_target = {
    kind: "node",
    id: "cause-understood",
    label: "根因已复现并定位",
    purpose: "确认当前反推到的里程碑",
  };
  const focusedRoute = selectElementIds(focusedModel, "proven");
  assert.ok(focusedRoute.nodes.includes("cause-understood"));
  assert.ok(focusedRoute.edges.includes("implement-recovery"));
  const allRegression = selectElementIds(model, "goal-regression");
  assert.ok(allRegression.edges.includes("release-observe"));
  assert.ok(allRegression.edges.includes("implement-recovery"));
});

test("wayfinding regression does not close when a destination branch ends at an orphan candidate", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-wayfinding-orphan-"));
  const current = path.join(directory, "current");
  fs.mkdirSync(current, { recursive: true });
  const draft = regressionDraft([
    regressionEdge("origin-to-route", "origin-fog", "route-stage"),
    regressionEdge("route-to-destination", "route-stage", "destination"),
    regressionEdge("orphan-to-destination", "orphan-stage", "destination"),
  ], [
    { id: "route-stage", kind: "state", label: "可行路线阶段", purpose: "连接起始事实与目的地", status: "confirmed" },
    { id: "orphan-stage", kind: "state", label: "孤立候选阶段", purpose: "没有已确认的始发前缀", status: "confirmed" },
  ]);
  const file = path.join(current, "wayfinding.yaml");
  fs.writeFileSync(file, `${JSON.stringify(draft, null, 2)}\n`, "utf8");

  const model = createBoardSnapshotReader({ statePath: path.join(current, "state.json") })().model;
  assert.equal(model.goal_regression.complete_chain, false);
  assert.deepEqual(model.goal_regression.terminal_nodes.sort(), ["orphan-stage", "origin-fog"].sort());
  assert.deepEqual(model.goal_regression.unclosed_terminals, ["orphan-stage"]);
  assert.match(model.goal_regression.unclosed_terminals.join(","), /orphan-stage/);
});

test("wayfinding regression keeps a failed OR candidate visible without invalidating the viable branch", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-wayfinding-or-branch-"));
  const current = path.join(directory, "current");
  fs.mkdirSync(current, { recursive: true });
  const draft = regressionDraft([
    regressionEdge("origin-to-viable", "origin-fog", "viable-stage"),
    regressionEdge("viable-to-destination", "viable-stage", "destination", "logical"),
    regressionEdge("origin-to-failed", "origin-fog", "failed-stage"),
    regressionEdge("failed-to-destination", "failed-stage", "destination", "unreachable"),
  ], [
    { id: "viable-stage", kind: "state", label: "可行路线阶段", purpose: "通往目的地的可行分支", status: "confirmed" },
    { id: "failed-stage", kind: "decision", label: "失败候选阶段", purpose: "保留供人比较但不可达", status: "confirmed" },
  ]);
  const file = path.join(current, "wayfinding.yaml");
  fs.writeFileSync(file, `${JSON.stringify(draft, null, 2)}\n`, "utf8");

  const model = createBoardSnapshotReader({ statePath: path.join(current, "state.json") })().model;
  assert.equal(model.goal_regression.complete_chain, true);
  const origin = model.goal_regression.steps.find((step) => step.target_node === "origin-fog");
  assert.equal(origin.prefix_reachability.status, "fog");
  assert.equal(origin.bridge_status, "awaiting-prefix");
  const failed = model.goal_regression.steps.find((step) => step.target_node === "failed-stage");
  assert.equal(failed.suffix_proof.status, "unreachable");
  const failedIncoming = failed.incoming_edges.find((edge) => edge.edge_id === "origin-to-failed");
  assert.equal(failedIncoming.suffix_proven, false);
  assert.ok(model.goal_regression.steps.some((step) => step.target_node === "viable-stage"));
});

test("formal regression metadata is confirmed without changing formal edge direction", () => {
  const loaded = readBlueprint(TEMPLATE_MAP);
  const model = compileBoardModel({
    blueprint: loaded.blueprint,
    digest: loaded.digest,
    briefs: loaded.briefs,
  });
  const destinationStep = model.goal_regression.steps[0];
  assert.equal(destinationStep.formal, true);
  assert.equal(destinationStep.human_confirmed, true);
  const publishEdge = model.edges.find((edge) => edge.id === "publish-article");
  assert.equal(publishEdge.goal_regression[0].formal, true);
  assert.equal(publishEdge.goal_regression[0].human_confirmed, true);
  const publishStep = model.goal_regression.steps.find((step) => step.target_node === "article-live");
  assert.equal(publishStep.incoming_edges[0].formal, true);
  assert.equal(publishStep.incoming_edges[0].human_confirmed, true);
});

test("a human-confirmed fog destination is projected as a destination node", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-wayfinding-destination-kind-"));
  const current = path.join(directory, "current");
  fs.mkdirSync(current, { recursive: true });
  fs.writeFileSync(path.join(current, "wayfinding.yaml"), `schema_version: 1
phase: regression
intent:
  statement: 已收敛目标
  status: shaped
  open_questions: []
origin:
  id: origin-fog
  kind: fog
  label: 起始迷雾
  facts: []
destination:
  id: destination
  kind: fog
  label: 已确认目标
  statement: 目标状态
  status: confirmed
  requires: [goal-met]
  invariants: []
  acceptance:
    - id: goal-accepted
      proves: [goal-met]
      proof: 目标状态可回读
boundaries:
  in_scope: [目标路线]
  out_of_scope: [无关工作]
  authorization: []
nodes: []
edges: []
questions: []
`, "utf8");
  const model = createBoardSnapshotReader({ statePath: path.join(current, "state.json") })().model;
  const destination = model.nodes.find((node) => node.id === "destination");
  assert.equal(destination.kind, "destination");
  assert.equal(destination.status, "confirmed");
  assert.equal(model.map.destination.kind, "destination");
  assert.equal(model.goal_regression.destination.status, "defined");
});

test("wayfinding rejects any candidate edge before regression, not only a direct origin-to-destination placeholder", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-wayfinding-phase-edge-"));
  const file = path.join(directory, "wayfinding.yaml");
  fs.writeFileSync(file, `schema_version: 1
phase: shaping
intent:
  statement: 定形目标
  status: draft
  open_questions: [需要确认]
origin:
  id: origin-fog
  kind: fog
  label: 起始迷雾
  facts: []
destination:
  id: destination-fog
  kind: fog
  label: 目的地迷雾
  statement: 目标
  status: pending
nodes:
  - id: milestone
    kind: state
    label: 中间候选
    purpose: 尚未进入回归
edges:
  - id: premature-edge
    from: origin-fog
    to: milestone
    label: 过早路径
    purpose: 不应在目的地定形前出现
questions: []
`, "utf8");
  assert.throws(() => readWayfinding(file), /cannot declare candidate edges before destination regression/);
});

test("wayfinding rejects an origin-to-destination placeholder before regression", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-wayfinding-placeholder-"));
  const current = path.join(directory, "current");
  fs.mkdirSync(current, { recursive: true });
  const file = path.join(current, "wayfinding.yaml");
  fs.writeFileSync(file, `schema_version: 1
phase: shaping
intent:
  statement: 定形目标
  status: draft
  open_questions: [需要确认]
origin:
  id: origin-fog
  kind: fog
  label: 起始迷雾
  facts: []
destination:
  id: destination-fog
  kind: fog
  label: 目的地迷雾
  statement: 目标
  status: pending
nodes: []
edges:
  - id: placeholder
    from: origin-fog
    to: destination-fog
    label: 占位边
    purpose: 不应在目的地定形前出现
questions: []
`, "utf8");
  assert.throws(() => readWayfinding(file), /cannot create an origin-to-destination placeholder/);
});

test("wayfinding cannot enter regression before a human-confirmed destination", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-wayfinding-regression-gate-"));
  const file = path.join(directory, "wayfinding.yaml");
  fs.writeFileSync(file, `schema_version: 1
phase: regression
intent:
  statement: 定形目标
  status: draft
  open_questions: [需要确认]
origin:
  id: origin-fog
  kind: fog
  label: 起始迷雾
  facts: []
destination:
  id: destination-fog
  kind: fog
  label: 目的地迷雾
  statement: 目标
  status: pending
nodes: []
edges: []
questions: []
`, "utf8");
  assert.throws(() => readWayfinding(file), /requires a shaped Intent with no open questions/);
});

test("BoardModel preserves proof, fog, route, Brief, and acceptance semantics", () => {
  const loaded = readBlueprint(TEMPLATE_MAP);
  const model = compileBoardModel({
    blueprint: loaded.blueprint,
    digest: loaded.digest,
    briefs: loaded.briefs,
  });

  assert.equal(model.projection.read_only, true);
  assert.equal(model.map.actual_arrival, "not-audited");
  assert.equal(model.summary.structural, "complete");
  assert.equal(model.summary.reachability, "conditional");
  assert.equal(model.predicates.length, loaded.blueprint.predicates.length);
  assert.equal(model.nodes.find((node) => node.kind === "fog").status, "fog");
  assert.equal(model.nodes.find((node) => node.kind === "destination").status, "unsatisfied");
  assert.deepEqual(model.goal_regression.steps.map((step) => step.target_node), [
    "article-live",
    "candidate-approved",
    "candidate-ready",
    "writing-ready",
    "material-present-audience-unknown",
  ]);
  assert.equal(model.goal_regression.complete_chain, true);
  const approvalStep = model.goal_regression.steps.find((step) => step.target_node === "candidate-approved");
  assert.equal(approvalStep.suffix_proof.status, "logical");
  assert.deepEqual(approvalStep.suffix_proof.proven_edges, ["publish-article"]);
  assert.equal(approvalStep.prefix_reachability.status, "conditional");
  assert.equal(approvalStep.bridge_status, "model-only");
  assert.equal(approvalStep.incoming_edges[0].confirmed, true);
  assert.deepEqual(approvalStep.incoming_edges[0].non_goals, ["修改候选稿或执行发布"]);
  const firstEdge = model.edges.find((edge) => edge.id === "settle-audience");
  assert.equal(firstEdge.proven, true);
  assert.equal(firstEdge.ready, true);
  assert.equal(firstEdge.status, "ready");
  assert.equal(firstEdge.brief.metadata.title, "明确文章读者");
  assert.match(firstEdge.brief.content, /# State transition/);
  assert.ok(model.acceptance.every((item) => item.status === "pending"));
});

test("goal regression keeps human-unconfirmed candidates out of the formal graph", () => {
  const loaded = readBlueprint(TEMPLATE_MAP);
  const state = runtimeState(loaded, TEMPLATE_MAP);
  state.regression_proposals = [{
    id: "probe-audience-route",
    kind: "edge",
    status: "pending",
    summary: "候选：先访谈再确定读者",
  }];
  const model = compileBoardModel({
    blueprint: loaded.blueprint,
    digest: loaded.digest,
    briefs: loaded.briefs,
    state,
    stateDigest: "regression-candidate",
  });
  assert.equal(model.goal_regression.confirmation_policy, "destination-confirmed-then-formal-registration");
  assert.equal(model.goal_regression.unconfirmed_candidates.length, 1);
  assert.equal(model.summary.pending_regression_candidates, 1);
  assert.equal(model.nodes.some((node) => node.id === "probe-audience-route"), false);
  assert.equal(model.edges.some((edge) => edge.id === "probe-audience-route"), false);
  const regression = selectElementIds(model, "goal-regression");
  assert.equal(regression.edges.includes("probe-audience-route"), false);
  assert.ok(regression.edges.includes("publish-article"));
});

test("BoardModel exposes protected-edge authorization and arrival audit causality", () => {
  const loaded = readBlueprint(TEMPLATE_MAP);
  const state = runtimeState(loaded, TEMPLATE_MAP);
  state.phase = "implementation";
  state.destination_status = "approved";
  state.runtime_status = "running";
  state.authorization_requests = [{
    id: "publish-article-authorization-1",
    edge: "publish-article",
    question: "May I publish the approved article?",
    requested_by: "agent:codex",
    requested_at: "2026-09-03T00:02:00Z",
    status: "granted",
    answer: "Approved for this edge only",
    authorized_by: "human:owner",
    authorized_at: "2026-09-03T00:03:00Z",
  }];
  state.arrival_audit_requests = [{
    id: "publish-article-arrival-audit-request-1",
    map_digest: loaded.digest,
    state_revision: 12,
    evidence_digest: "evidence-digest",
    acceptance: ["public-page-readable", "sensitive-review-recorded"],
    question: "Have the destination and residual risks been audited?",
    requested_by: "agent:codex",
    requested_at: "2026-09-03T00:04:00Z",
    status: "pending",
  }];
  state.active_edge = "publish-article";
  state.active_run = "publish-article-run-1";
  state.edge_runs = [{
    id: state.active_run,
    edge: state.active_edge,
    status: "active",
    attempt: 1,
    decision: "publish-article-decision-1",
    authorization_request: "publish-article-authorization-1",
    started_at: "2026-09-03T00:03:00Z",
    updated_at: "2026-09-03T00:03:00Z",
  }];
  state.decisions = [{
    id: "publish-article-decision-1",
    edge: "publish-article",
    at_node: "candidate-approved",
    alternatives: ["publish-article"],
    reason: "Approved for this edge only",
    actor: "human:owner",
    authorization_request: "publish-article-authorization-1",
    decided_at: "2026-09-03T00:03:00Z",
  }];

  const model = compileBoardModel({
    blueprint: loaded.blueprint,
    digest: loaded.digest,
    briefs: loaded.briefs,
    state,
    stateDigest: "authorization-causality",
  });
  const edge = model.edges.find((item) => item.id === "publish-article");
  assert.equal(model.summary.pending_authorizations, 0);
  assert.equal(model.summary.pending_arrival_audits, 1);
  assert.equal(model.authorization_requests.length, 1);
  assert.equal(model.arrival_audit_requests.length, 1);
  assert.equal(edge.authorization_requests[0].status, "granted");
  assert.equal(edge.runs[0].authorization_request, edge.authorization_requests[0].id);
  assert.equal(edge.decisions[0].authorization_request, edge.authorization_requests[0].id);
  const repairAction = currentActionView(model);
  assert.equal(repairAction.state, "agent-next");
  assert.equal(repairAction.title, "补登到达审计责任人");
  assert.equal(repairAction.owner, "当前会话 Agent");
  assert.equal(repairAction.target_id, model.arrival_audit_requests[0].id);
  assert.match(repairAction.after, /不授权施工，也不登记到达/);
  model.arrival_audit_requests[0].decision_owner = "human:owner";
  const action = currentActionView(model);
  assert.equal(action.state, "waiting-human");
  assert.equal(action.title, "审计实际到达");
  assert.equal(action.owner, "你（human:owner）");
});

test("BoardModel keeps historical Arrival visible while current destination facts drift", () => {
  const loaded = readBlueprint(TEMPLATE_MAP);
  const state = runtimeState(loaded, TEMPLATE_MAP);
  state.phase = "arrived";
  state.destination_status = "approved";
  const invariantMap = new Map(loaded.blueprint.invariants.map((invariant) => [invariant.id, invariant]));
  const arrivalPredicates = [...new Set([
    ...loaded.blueprint.destination.requires,
    ...loaded.blueprint.destination.invariants.flatMap((invariantId) => invariantMap.get(invariantId).requires),
  ])];
  for (const predicateId of arrivalPredicates) {
    const predicate = loaded.blueprint.predicates.find((item) => item.id === predicateId);
    state.facts[predicate.fact] = { value: predicate.equals, evidence: [{ kind: "external", ref: `arrival:${predicateId}`, strength: "observed" }] };
  }
  state.arrival_audit = {
    request: "publish-article-arrival-audit-request-1",
    acceptance: loaded.blueprint.destination.acceptance.map((item) => item.id),
    non_goals: [], risks: [], answer: "audited", confirm: "audited", actor: "human:owner",
    recorded_at: "2026-09-03T00:10:00Z", run_id: "publish-article-arrival-12",
  };
  state.arrival_checkpoints = [];
  state.successor_bindings = [];
  state.arrival_checkpoints.push(createArrivalCheckpoint({ state, blueprint: loaded.blueprint, stateRevision: 12 }));
  state.facts["article-published"] = {
    value: "false",
    evidence: [{ kind: "external", ref: "availability-readback:404", strength: "observed", observed_at: "2026-09-03T00:20:00Z" }],
  };

  const model = compileBoardModel({
    blueprint: loaded.blueprint,
    digest: loaded.digest,
    briefs: loaded.briefs,
    state,
    stateDigest: "arrival-drift",
  });
  assert.equal(model.map.actual_arrival, "audited");
  assert.equal(model.map.current_destination.status, "drifted");
  assert.deepEqual(model.map.current_destination.missing, ["article-published"]);
  assert.equal(model.arrival_checkpoints.length, 1);
  assert.equal(model.summary.arrival_checkpoints, 1);
  assert.equal(model.nodes.find((node) => node.id === "article-live").status, "drifted");
  assert.equal(model.nodes.find((node) => node.id === "article-live").arrival_checkpoint_ids.length, 1);
  const completeRouteSet = selectElementIds(model, "all");
  assert.deepEqual(new Set(completeRouteSet.edges), new Set(model.edges.map((edge) => edge.id)));
});

test("the board distinguishes directly startable and protected ready edges", () => {
  const loaded = readBlueprint(TEMPLATE_MAP);
  const state = runtimeState(loaded, TEMPLATE_MAP);
  const model = compileBoardModel({
    blueprint: loaded.blueprint,
    digest: loaded.digest,
    briefs: loaded.briefs,
    state,
    stateDigest: "direct-start-ready",
  });
  const edge = model.edges.find((item) => item.id === "settle-audience");
  assert.equal(edge.status, "ready");
  assert.equal(edgeExecutionLabel(edge, model), "前置已满足，可直接启动");
  const action = currentActionView(model);
  assert.equal(action.state, "agent-next");
  assert.equal(action.title, "开始：明确文章读者");

  const protectedEdge = structuredClone(edge);
  protectedEdge.brief.metadata.contract.authorization.required = ["任务所有者明确授权"];
  assert.equal(edgeExecutionLabel(protectedEdge, model), "前置已满足，需请求声明授权");
  protectedEdge.authorization_requests = [{ status: "pending" }];
  assert.equal(edgeExecutionLabel(protectedEdge, model), "前置已满足，待授权确认");
});

test("the current action exposes multiple independent ready branches instead of choosing one silently", () => {
  const action = currentActionView({
    map: { actual_arrival: "not-audited" },
    summary: { active_edge: null, parallel_ready_edges: 2 },
    proof: { reachability: "logical" },
    edges: [
      { id: "build-catalog", title: "构建目录与搜索", status: "ready", proven: true },
      { id: "build-circulation", title: "构建借还生命周期", status: "ready", proven: true },
    ],
    proposals: [],
    authorization_requests: [], arrival_audit_requests: [],
  });
  assert.equal(action.state_label, "并行分支已就绪");
  assert.equal(action.title, "2 项任务可以并行推进");
  assert.match(action.question, /构建目录与搜索.*构建借还生命周期/);
  assert.match(action.after, /其他独立任务仍保持可开始/);
});

test("parallel work edges receive distinct fork-and-join visual lanes", () => {
  const model = {
    edges: [
      { id: "build-catalog", from: "journey-ready", to: "slices-ready" },
      { id: "build-circulation", from: "journey-ready", to: "slices-ready" },
      { id: "integrate", from: "slices-ready", to: "integrated" },
    ],
  };
  const catalog = parallelEdgeLane(model.edges[0], model);
  const circulation = parallelEdgeLane(model.edges[1], model);
  const integrate = parallelEdgeLane(model.edges[2], model);
  assert.equal(catalog.className, "parallel-lane");
  assert.equal(circulation.className, "parallel-lane");
  assert.equal(catalog.offset, -circulation.offset);
  assert.notEqual(catalog.offset, 0);
  assert.notEqual(catalog.labelOffset, circulation.labelOffset);
  assert.deepEqual(integrate, { className: "", offset: 0, labelOffset: 0 });
});

test("the activity graph projects work edges as task nodes between milestone states", () => {
  const model = {
    projection: { mode: "runtime" },
    nodes: [
      { id: "origin", label: "需求已确认", kind: "state", status: "satisfied", predicates: [], proof_gaps: [] },
      { id: "joined", label: "实现已汇合", kind: "join", status: "unsatisfied", predicates: [], proof_gaps: [] },
      { id: "destination", label: "目标已验收", kind: "destination", status: "unsatisfied", predicates: [], proof_gaps: [] },
    ],
    edges: [
      { id: "build-api", title: "实现 API", from: "origin", to: "joined", status: "active", proven: true, proof_gaps: [] },
      { id: "build-ui", title: "实现界面", from: "origin", to: "joined", status: "ready", proven: true, proof_gaps: [] },
      { id: "accept", title: "验收核心旅程", from: "joined", to: "destination", status: "blocked", proven: true, proof_gaps: [] },
    ],
  };

  const elements = activityGraphElements(model);
  const milestoneNodes = elements.filter((item) => item.group === "nodes" && item.classes.includes("milestone-node"));
  const activityNodes = elements.filter((item) => item.group === "nodes" && item.classes.includes("activity-node"));
  const connectors = elements.filter((item) => item.group === "edges" && item.classes.includes("activity-connector"));

  assert.equal(milestoneNodes.length, 3);
  assert.equal(activityNodes.length, 3);
  assert.equal(connectors.length, 6);
  assert.equal(elements.some((item) => item.data.id === "build-api"), false);
  assert.deepEqual(
    activityNodes.find((item) => item.data.refId === "build-api").data,
    {
      id: "activity::build-api",
      refId: "build-api",
      refType: "edge",
      label: "实现 API\n进行中",
      kind: "activity",
      status: "active",
    },
  );
  assert.ok(connectors.some((item) => item.data.source === "origin" && item.data.target === "activity::build-api"));
  assert.ok(connectors.some((item) => item.data.source === "activity::build-api" && item.data.target === "joined"));
  assert.match(milestoneNodes.find((item) => item.data.refId === "origin").classes, /flow-start/);
  assert.match(milestoneNodes.find((item) => item.data.refId === "joined").classes, /flow-join/);
  assert.match(milestoneNodes.find((item) => item.data.refId === "destination").classes, /flow-end/);
});

test("navigation position distinguishes current work, waiting gates, and completed arrival", () => {
  const base = {
    projection: { mode: "runtime" },
    map: { actual_arrival: "not-audited", current_destination: { node_id: "destination", status: "satisfied" } },
    summary: { active_edge: "build-api", pending_arrival_audits: 0 },
    nodes: [
      { id: "origin", label: "需求已确认" },
      { id: "destination", label: "目标已验收" },
    ],
    edges: [{ id: "build-api", title: "实现 API", from: "origin", to: "destination", status: "active" }],
    arrival_audit_requests: [],
  };
  assert.deepEqual(navigationPositionView(base), {
    label: "实现 API",
    detail: "需求已确认 -> 目标已验收",
    state: "active",
  });

  const waiting = structuredClone(base);
  waiting.summary.active_edge = null;
  waiting.summary.pending_arrival_audits = 1;
  waiting.arrival_audit_requests = [{ status: "pending" }];
  assert.deepEqual(navigationPositionView(waiting), {
    label: "目标已验收",
    detail: "工作已完成，等待到达审计",
    state: "waiting",
  });

  const arrived = structuredClone(waiting);
  arrived.map.actual_arrival = "audited";
  assert.deepEqual(navigationPositionView(arrived), {
    label: "目标已验收",
    detail: "本航段已审计到达，可从这里开始下一航段",
    state: "complete",
  });
});

test("an arrived legacy fixture keeps old approval events as history only", () => {
  const statePath = path.join(ROOT, "examples", "community-workshop", ".mapflow", "state.json");
  const model = createBoardSnapshotReader({ statePath })().model;
  const historicalApproval = model.timeline.find((entry) => entry.label === "destination_approved");
  assert.equal(timelineEventLabel(historicalApproval), "旧版目的地批准与首边选择");
  assert.equal(currentActionView(model).state, "complete");
});

test("a formal destination stays unsatisfied before executed evidence rather than becoming destination fog", () => {
  const loaded = readBlueprint(TEMPLATE_MAP);
  const state = runtimeState(loaded, TEMPLATE_MAP);
  const model = compileBoardModel({
    blueprint: loaded.blueprint,
    digest: loaded.digest,
    briefs: loaded.briefs,
    state,
    stateDigest: "unapproved-formal-destination",
  });
  assert.equal(model.nodes.find((node) => node.kind === "destination").status, "unsatisfied");
  assert.equal(model.goal_regression.destination.status, "defined");
});

test("wayfinding inspector keeps a readable destination when an older board response omits label fields", () => {
  const view = wayfindingDestinationView({
    map: {
      destination: { statement: "候选目标陈述" },
    },
    wayfinding: {
      draft_nodes: [{ id: "destination-fog", kind: "fog", status: "destination-fog", label: "目的地尚未定形" }],
    },
  });
  assert.deepEqual(view, {
    status: "fog",
    label: "目的地尚未定形",
    statement: "候选目标陈述",
  });
});

test("order timeout baseline keeps fog, human decision, stage evidence, and regression proof", () => {
  const loaded = readBlueprint(ORDER_TIMEOUT_MAP);
  const model = compileBoardModel({
    blueprint: loaded.blueprint,
    digest: loaded.digest,
    briefs: loaded.briefs,
  });
  assert.equal(model.summary.structural, "complete");
  assert.equal(model.summary.reachability, "conditional");
  assert.equal(model.summary.nodes, 7);
  assert.equal(model.summary.edges, 6);
  assert.equal(model.nodes.find((node) => node.kind === "fog").status, "fog");
  assert.equal(model.nodes.find((node) => node.kind === "decision").label, "重试与失败回退契约已确认");
  assert.equal(model.nodes.find((node) => node.id === "code-ready").realization_refs[0].ref, "orderpulse-api@tag/order-query-timeout-v1");
  assert.equal(model.edges.find((edge) => edge.id === "reproduce-timeout").status, "ready");
  assert.equal(model.edges.find((edge) => edge.id === "confirm-recovery-contract").status, "blocked");
  assert.deepEqual(model.goal_regression.steps.map((step) => step.target_node), [
    "order-query-reliable",
    "release-approved",
    "verification-ready",
    "code-ready",
    "recovery-contract",
    "timeout-understood",
    "service-observed",
  ]);
  assert.equal(model.goal_regression.confirmation_policy, "destination-confirmed-then-formal-registration");
  assert.ok(model.goal_regression.steps.every((step) => step.confirmed));
  assert.equal(model.acceptance.length, 5);
});

test("BoardModel binds runtime evidence and acceptance to an edge", () => {
  const loaded = readBlueprint(TEMPLATE_MAP);
  const state = runtimeState(loaded, TEMPLATE_MAP);
  state.phase = "implementation";
  state.destination_status = "approved";
  state.verified_edges = ["settle-audience"];
  state.facts["audience-known"] = {
    value: "true",
    evidence: [{ kind: "meeting", ref: "minutes/audience" }],
  };
  state.evidence.push({
    edge: "settle-audience",
    claim: "audience confirmed",
    proves: ["audience-known"],
    acceptance_ids: [],
    outcome_refs: [{ kind: "meeting", ref: "minutes/audience" }],
    checks: [{ command: "read minutes", result: "pass", observed: "audience named" }],
    limits: { simulated: [], inferred: [], unverified: [], product_unknowns: [] },
    executor: "human:owner",
    recorded_at: "2026-09-03T00:01:00Z",
  });
  const model = compileBoardModel({
    blueprint: loaded.blueprint,
    digest: loaded.digest,
    briefs: loaded.briefs,
    state,
    stateDigest: "runtime-digest",
  });
  const edge = model.edges.find((item) => item.id === "settle-audience");
  assert.equal(edge.status, "verified");
  assert.equal(edge.evidence[0].executor, "human:owner");
  assert.equal(model.nodes.find((node) => node.id === "writing-ready").satisfied, true);
  assert.ok(model.timeline.some((entry) => entry.kind === "evidence"));
  assert.equal(model.nodes.find((node) => node.kind === "fog").status, "unsatisfied");
});

test("board lenses and search expose route context without changing topology", () => {
  const loaded = readBlueprint(TEMPLATE_MAP);
  const model = compileBoardModel({
    blueprint: loaded.blueprint,
    digest: loaded.digest,
    briefs: loaded.briefs,
  });
  const signature = topologySignature(model);
  const route = selectElementIds(model, "proven");
  assert.ok(route.edges.includes("settle-audience"));
  assert.ok(route.nodes.includes("writing-ready"));

  const searched = selectElementIds(model, "all", "audience-known");
  assert.ok(searched.matches.length > 0);
  assert.ok(searched.nodes.includes("writing-ready"));
  assert.ok(searched.edges.includes("settle-audience"));

  const changed = structuredClone(model);
  changed.edges[0].status = "active";
  changed.nodes[0].status = "satisfied";
  assert.equal(topologySignature(changed), signature);
});

test("snapshot reader uses registered truth for unregistered map changes", () => {
  const { directory, mapPath } = copyTemplate();
  const loaded = readBlueprint(mapPath);
  const statePath = path.join(directory, "state.json");
  fs.writeFileSync(statePath, `${JSON.stringify(runtimeState(loaded, mapPath), null, 2)}\n`, "utf8");
  const reader = createBoardSnapshotReader({ mapPath, statePath });
  const current = reader();
  assert.equal(current.model.projection.source_status, "current");

  fs.appendFileSync(mapPath, "\n# unregistered change\n", "utf8");
  const stale = reader();
  assert.equal(stale.model.projection.source_status, "stale");
  assert.match(stale.model.projection.source_error, /unregistered changes/);
  assert.equal(stale.model.map.id, loaded.blueprint.map_id);
});

test("snapshot reader retains last-known-good data during invalid writes", () => {
  const { mapPath } = copyTemplate();
  const reader = createBoardSnapshotReader({ mapPath });
  const current = reader();
  fs.writeFileSync(mapPath, "destination: [", "utf8");
  const stale = reader();
  assert.equal(stale.model.projection.source_status, "stale");
  assert.equal(stale.model.map.id, current.model.map.id);
  assert.match(stale.model.projection.source_error, /invalid blueprint YAML/);
});

test("board server serves a read-only ETag API and offline assets", async () => {
  const server = createBoardServer({ mapPath: TEMPLATE_MAP });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const first = await fetch(`${base}/api/board`);
    assert.equal(first.status, 200);
    assert.equal(first.headers.get("x-content-type-options"), "nosniff");
    assert.match(first.headers.get("content-security-policy"), /default-src 'self'/);
    const etag = first.headers.get("etag");
    assert.ok(etag);
    assert.equal((await first.json()).projection.read_only, true);

    const unchanged = await fetch(`${base}/api/board`, { headers: { "If-None-Match": etag } });
    assert.equal(unchanged.status, 304);

    const head = await fetch(`${base}/api/board`, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");

    const page = await fetch(base);
    assert.equal(page.status, 200);
    const pageSource = await page.text();
    assert.match(pageSource, /Mapflow Board/);
    assert.match(pageSource, /id="current-action"/);
    assert.match(pageSource, /目的地/);
    assert.match(pageSource, /当前位置/);
    assert.match(pageSource, /下一步/);
    assert.match(pageSource, /任务与里程碑/);
    assert.match(pageSource, /id="toggle-inspector"[^>]*aria-expanded="false"/);
    assert.match(pageSource, /id="inspector"[^>]*hidden/);
    assert.match(pageSource, /当前推进/);
    assert.match(pageSource, /完整路线/);
    assert.match(pageSource, /<details class="lens-more">/);
    assert.doesNotMatch(pageSource, /<details class="lens-more"[^>]*open/);
    assert.match(pageSource, /<details class="history-drawer"/);
    assert.doesNotMatch(pageSource, /<details class="history-drawer"[^>]*open/);
    const app = await fetch(`${base}/app.js`);
    assert.equal(app.status, 200);
    const appSource = await app.text();
    assert.match(appSource, /If-None-Match/);
    assert.match(appSource, /new EventSource\("\/api\/stream"\)/);
    assert.match(appSource, /lens:\s*"all"/);
    assert.doesNotMatch(appSource, /\.innerHTML\s*=/);
    assert.match(appSource, /goal-regression/);
    assert.match(appSource, /目标回归/);
    assert.match(appSource, /dblclick/);
    assert.match(appSource, /button\.addEventListener\("dblclick"/);
    assert.match(appSource, /focusSubmap\(bindingPath\)/);
    assert.match(appSource, /前置已满足，可直接启动/);
    assert.match(appSource, /前置已满足，需请求声明授权/);
    const styles = await fetch(`${base}/styles.css`);
    assert.equal(styles.status, 200);
    const stylesSource = await styles.text();
    assert.match(stylesSource, /\.workbench\.has-inspector\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(300px, 360px\)/s);
    assert.match(stylesSource, /\.element-list\s*\{[^}]*overflow-y:\s*auto;/s);
    const vendor = await fetch(`${base}/vendor/cytoscape.min.js`);
    assert.equal(vendor.status, 200);
    assert.ok((await vendor.text()).length > 400000);

    const write = await fetch(`${base}/api/board`, { method: "POST" });
    assert.equal(write.status, 405);
    assert.match((await write.json()).error, /read-only/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("board stream notifies a revision change and leaves API readback authoritative", async () => {
  const { directory, mapPath } = copyTemplate();
  const loaded = readBlueprint(mapPath);
  const statePath = path.join(directory, "state.json");
  const state = runtimeState(loaded, mapPath);
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  const server = createBoardServer({ mapPath, statePath });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const controller = new AbortController();
  try {
    const response = await fetch(`${base}/api/stream`, { signal: controller.signal });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/event-stream/);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    async function nextEvent() {
      let buffer = "";
      while (!buffer.includes("\n\n")) {
        const part = await reader.read();
        if (part.done) throw new Error("board stream closed before an event arrived");
        buffer += decoder.decode(part.value, { stream: true });
      }
      return buffer;
    }
    const initial = await nextEvent();
    assert.match(initial, /event: revision/);
    const initialRevision = JSON.parse(initial.match(/data: (\{.*\})/)[1]).revision;

    state.updated_at = "2026-09-03T00:01:00Z";
    fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    let timeoutId;
    const changed = await Promise.race([
      nextEvent(),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("timed out waiting for board stream revision")), 5000);
      }),
    ]).finally(() => clearTimeout(timeoutId));
    const changedRevision = JSON.parse(changed.match(/data: (\{.*\})/)[1]).revision;
    assert.notEqual(changedRevision, initialRevision);
    const readback = await (await fetch(`${base}/api/board`)).json();
    assert.equal(readback.projection.revision, changedRevision);
    await reader.cancel();
  } finally {
    controller.abort();
    await new Promise((resolve) => server.close(resolve));
  }
});
