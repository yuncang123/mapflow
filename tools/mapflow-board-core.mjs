import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  STATE_SCHEMA_VERSION,
  arrivalCheckpointDigest,
  deriveSatisfiedNodes,
  edgeReadiness,
  ensureArrivalCheckpoints,
  initialFacts,
  buildGoalRegression,
  predicateSatisfied,
  proveBlueprint,
  readBlueprint,
  registeredBriefFormattingEquivalent,
  validateBlueprint,
} from "./mapflow-core.mjs";
import { readWayfinding, validateWayfinding } from "./mapflow-wayfinding.mjs";
import { readWayfindingEvents } from "./mapflow-evolution.mjs";

export class BoardError extends Error {}

function fail(message) {
  throw new BoardError(message);
}

function now() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function clone(value) {
  return structuredClone(value);
}

function asObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return value;
}

function asArray(value, label) {
  if (!Array.isArray(value)) fail(`${label} must be a list`);
  return value;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function emptyBoardModel() {
  const intent = {
    statement: "尚未记录 Intent",
    status: "draft",
    open_questions: ["目的地尚未通过 grilling 定形"],
  };
  const destination = {
    statement: "尚未定形目的地",
    requires: [],
    invariants: [],
    acceptance: [],
  };
  const proof = {
    structural: "not-started",
    reachability: "not-started",
    evidence_levels: {
      structural_soundness: { status: "not-started" },
      declared_model_derivability: { status: "not-started" },
      runtime_readiness: { status: "not-started", ready_edges: [] },
      executed_derivation: { status: "not-observed", verified_edges: [] },
      audited_arrival: { status: "not-observed", request: null },
    },
    destination_reachable: false,
    required_predicates: [],
    candidate_edges: [],
    proven_edges: [],
    reachable_nodes: [],
    applied_edges: [],
    assumptions_used: [],
    proof_gaps: [],
  };
  const revision = hash("empty-workspace");
  return {
    schema: 1,
    projection: {
      revision,
      generated_at: now(),
      source_status: "empty",
      source_error: null,
      map_digest: null,
      state_updated_at: null,
      mode: "empty",
      read_only: true,
    },
    map: {
      id: "unshaped-workspace",
      intent,
      destination,
      boundaries: { in_scope: [], out_of_scope: [], authorization: [] },
      phase: "wayfinding",
      destination_status: "draft",
      actual_arrival: "not-audited",
      runtime_status: "empty",
    },
    summary: {
      structural: "not-started",
      reachability: "not-started",
      nodes: 0,
      satisfied_nodes: 0,
      edges: 0,
      verified_edges: 0,
      active_edge: null,
      active_run: null,
      pending_authorizations: 0,
      pending_arrival_audits: 0,
      proof_gaps: 0,
      acceptance_passed: 0,
      acceptance_total: 0,
      facts: { true: 0, false: 0, unknown: 0, conflict: 0 },
      submaps: 0,
      stale_submaps: 0,
      pending_proposals: 0,
      pending_regression_candidates: 0,
      goal_regression_steps: 0,
      goal_regression_edges: 0,
      goal_regression_confirmed: 0,
    },
    proof,
    evidence_levels: clone(proof.evidence_levels),
    goal_regression: {
      roots: [],
      origin_nodes: [],
      destination: { node_id: null, label: destination.statement, status: "fog" },
      steps: [],
      edge_ids: [],
      complete_chain: false,
      terminal_nodes: [],
      unclosed_terminals: [],
      generated_from: "not-started",
      confirmation_policy: "destination-confirmed-then-formal-registration",
      confirmation_note: "先确认 Destination；回归候选作为完整链审阅，写入并通过 validate/prove 后才成为正式地图。",
      unconfirmed_candidates: [],
    },
    acceptance: [],
    predicates: [],
    nodes: [],
    edges: [],
    facts: {},
    loops: [],
    proof_gaps: [],
    evidence: [],
    edge_runs: [],
    decisions: [],
    authorization_requests: [],
    arrival_audit_requests: [],
    proposals: [],
    work_events: [],
    submaps: [],
    timeline: [],
    empty_state: {
      title: "地图尚未建立",
      next_steps: [
        "读取工作区和外部权威来源，固定四值起始事实",
        "通过 grilling 将模糊诉求收敛为 Intent 和 Destination Contract",
        "经人确认后，才把里程碑节点、工作边和独立 Brief 写入 Blueprint",
      ],
    },
  };
}

// Wayfinding drafts do not have the formal planner's predicate graph yet. The
// board still needs to show the human reasoning surface: start at the goal,
// walk incoming candidate edges backwards, and keep prefix reachability
// separate from the suffix proof supplied by the candidate contract.
function buildWayfindingRegression({ draft, nodes, edges }) {
  const destination = draft.destination;
  if (!destination) {
    return {
      roots: [],
      origin_nodes: [draft.origin.id],
      destination: { node_id: null, label: "尚未定形目的地", status: "fog" },
      steps: [],
      edge_ids: [],
      complete_chain: false,
      terminal_nodes: [],
      unclosed_terminals: [],
      generated_from: "wayfinding-draft",
    };
  }

  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const incoming = new Map();
  const outgoing = new Map();
  for (const edge of edges) {
    const list = incoming.get(edge.to) ?? [];
    list.push(edge);
    incoming.set(edge.to, list);
    const next = outgoing.get(edge.from) ?? [];
    next.push(edge);
    outgoing.set(edge.from, next);
  }

  const steps = [];
  const seenDepth = new Map();
  const queue = [{ id: destination.id, depth: 0 }];
  while (queue.length) {
    const current = queue.shift();
    const previousDepth = seenDepth.get(current.id);
    if (previousDepth !== undefined && previousDepth <= current.depth) continue;
    seenDepth.set(current.id, current.depth);
    const node = nodeMap.get(current.id) ?? {
      id: current.id,
      label: destination.label,
      kind: destination.kind,
      facts: [],
      status: destination.status ?? "pending",
    };
    const producers = (incoming.get(current.id) ?? []).slice().sort((left, right) => left.id.localeCompare(right.id));
    const nextSteps = (outgoing.get(current.id) ?? [])
      .map((edge) => ({ edge, step: steps.find((item) => item.target_node === edge.to) }))
      .filter((item) => item.step);
    const suffixStatuses = nextSteps.map(({ edge, step }) => [edge.proof?.status ?? "unreachable", step.suffix_proof?.status ?? "unreachable"]);
    const suffixStatus = current.id === destination.id && destination.status !== "confirmed" && destination.status !== "destination"
      ? "fog"
      : current.id === destination.id
        ? "logical"
        : suffixStatuses.filter(([edgeStatus, targetStatus]) => !["unreachable", "fog"].includes(edgeStatus) && !["unreachable", "fog"].includes(targetStatus)).length === 0
          ? "unreachable"
          : suffixStatuses.some(([edgeStatus, targetStatus]) => [edgeStatus, targetStatus].includes("conditional"))
              ? "conditional"
              : "logical";
    const facts = node.predicates ?? node.facts ?? [];
    const hasUnknown = facts.some((fact) => ["unknown", "conflict"].includes(fact.actual ?? fact.value));
    const prefixStatus = current.id === draft.origin.id
      ? hasUnknown || facts.length === 0 ? "fog" : "observed"
      : hasUnknown
        ? "fog"
        : node.status === "confirmed" ? "model-only" : "awaiting-prefix";
    // Legacy drafts may carry per-object status. It is projected as review
    // metadata only; schema 3 registration does not require per-object gates.
    const humanConfirmed = current.id === destination.id
      ? destination.status === "confirmed" || destination.status === "destination"
      : node.status === "confirmed";
    const bridgeStatus = suffixStatus === "unreachable"
      ? "suffix-unproven"
      : current.id === draft.origin.id && prefixStatus === "observed"
        ? "connected"
        : "awaiting-prefix";
    const incomingEdges = producers.map((edge) => ({
      edge_id: edge.id,
      from: edge.from,
      to: edge.to,
      required_predicates: [...(edge.preconditions ?? [])],
      effects: [...(edge.effects ?? [])],
      brief_ref: edge.brief_ref ?? null,
      certainty: edge.certainty ?? "expected",
      acceptance_contract: clone(edge.evidence_contract ?? []),
      acceptance: clone(edge.acceptance ?? []),
      non_goals: [...(edge.non_goals ?? [])],
      // This edge leads into the node currently being built. Its target-side
      // suffix is therefore the suffix computed for the current node; the
      // target step is not in `steps` yet while its incoming edges are built.
      suffix_proven: !["unreachable", "fog"].includes(edge.proof?.status)
        && !["unreachable", "fog"].includes(suffixStatus),
      confirmed: edge.status === "confirmed",
      human_confirmed: edge.status === "confirmed",
      formal: false,
      confirmation_source: edge.status === "confirmed" ? "human-wayfinding" : null,
    }));
    steps.push({
      depth: current.depth,
      target_node: node.id,
      target_label: node.label,
      target_kind: node.kind,
      required_predicates: [...facts.map((fact) => fact.id)],
      prefix_reachability: {
        status: prefixStatus,
        observed: prefixStatus === "observed",
        modeled: prefixStatus === "model-only",
      },
      suffix_proof: {
        status: suffixStatus,
        structural: "candidate",
        destination_reachable: !["unreachable", "fog"].includes(suffixStatus),
        proven_edges: nextSteps.filter(({ edge, step }) => !["unreachable", "fog"].includes(edge.proof?.status) && !["unreachable", "fog"].includes(step.suffix_proof?.status)).map(({ edge }) => edge.id),
        proof_gaps: producers.flatMap((edge) => edge.proof?.missing ?? []),
        seeded_predicates: [...facts.map((fact) => fact.id)],
        target_node: node.id,
      },
      bridge_status: bridgeStatus,
      confirmed: false,
      human_confirmed: humanConfirmed,
      formal: false,
      confirmation_source: humanConfirmed ? "human-wayfinding" : null,
      incoming_edges: incomingEdges,
    });
    for (const edge of producers) {
      if (nodeMap.has(edge.from)) queue.push({ id: edge.from, depth: current.depth + 1 });
    }
  }
  steps.sort((left, right) => left.depth - right.depth || left.target_node.localeCompare(right.target_node));
  const edgeIds = [...new Set(steps.flatMap((step) => step.incoming_edges.map((edge) => edge.edge_id)))];
  const originStep = steps.find((step) => step.target_node === draft.origin.id);
  const terminalNodes = steps
    .filter((step) => step.incoming_edges.length === 0)
    .map((step) => step.target_node);
  const unclosedTerminals = terminalNodes.filter((nodeId) => nodeId !== draft.origin.id);
  return {
    roots: [destination.id],
    origin_nodes: [draft.origin.id],
    destination: {
      node_id: destination.id,
      label: destination.label,
      status: destination.status === "confirmed" || destination.status === "destination" ? "defined" : "fog",
    },
    steps,
    edge_ids: edgeIds,
    complete_chain: Boolean(
      steps.some((step) => step.target_node === destination.id)
      && originStep
      && originStep.incoming_edges.length === 0
      && unclosedTerminals.length === 0,
    ),
    terminal_nodes: terminalNodes,
    unclosed_terminals: unclosedTerminals,
    generated_from: "destination-backward-regression",
  };
}

export function compileWayfindingBoardModel({ draft, digest, sourceStatus = "current", sourceError = null }) {
  const destinationConfirmed = draft.destination
    && ["confirmed", "destination"].includes(draft.destination.status);
  const originFacts = draft.origin.facts ?? [];
  const originSettled = originFacts.length > 0
    && originFacts.every((fact) => ["true", "false"].includes(fact.value));
  const regressionDraft = draft.destination && draft.destination.kind !== "destination" && destinationConfirmed
    ? {
      ...draft,
      destination: { ...draft.destination, kind: "destination" },
    }
    : draft;
  const draftNodes = [
    {
      id: draft.origin.id,
      kind: draft.origin.kind,
      label: draft.origin.label,
      purpose: "现场勘探固定的始发状态候选",
      status: draft.origin.kind === "fog" || !originSettled ? "fog" : "satisfied",
      draft: true,
      formal: false,
      predicates: (draft.origin.facts ?? []).map((fact) => ({
        id: fact.id,
        fact: fact.id,
        equals: fact.value,
        actual: fact.value,
        satisfied: ["true", "false"].includes(fact.value),
        evidence: clone(fact.evidence ?? []),
      })),
      proof_gaps: [],
      satisfied: originSettled,
      goal_regression: null,
    },
    ...(regressionDraft.destination ? [{
      id: regressionDraft.destination.id,
      kind: regressionDraft.destination.kind,
      label: regressionDraft.destination.label,
      purpose: "等待 Intent 和 Destination Contract 定形",
      status: destinationConfirmed ? "confirmed" : "destination-fog",
      draft: true,
      formal: false,
      predicates: (regressionDraft.destination.requires ?? []).map((predicateId) => ({
        id: predicateId,
        fact: predicateId,
        equals: "true",
        actual: "unknown",
        satisfied: false,
        evidence: [],
      })),
      proof_gaps: [],
      satisfied: false,
      goal_regression: null,
    }] : []),
    ...(draft.nodes ?? []).map((node) => ({
      ...clone(node),
      status: node.status ?? "candidate",
      draft: true,
      formal: false,
      predicates: (node.facts ?? []).map((fact) => ({
        id: fact.id,
        fact: fact.id,
        equals: fact.value,
        actual: fact.value,
        satisfied: fact.value === "true",
        evidence: clone(fact.evidence ?? []),
      })),
      proof_gaps: [],
      satisfied: false,
      goal_regression: null,
    })),
  ];
  const draftEdges = (draft.edges ?? []).map((edge) => ({
    ...clone(edge),
    title: edge.label,
    status: edge.status ?? "candidate",
    candidate: true,
    proven: false,
    ready: false,
    missing: [],
    draft: true,
    formal: false,
    brief: { ref: edge.brief_ref ?? "待人确认后创建 Task Brief", metadata: null, content: null },
    preconditions: clone(edge.preconditions ?? []),
    effects: clone(edge.effects ?? []),
    invariants: clone(edge.invariants ?? []),
    applicable_invariants: clone(edge.invariants ?? []),
    evidence_contract: clone(edge.evidence_contract ?? []),
    acceptance: clone(edge.acceptance ?? []),
    non_goals: clone(edge.non_goals ?? []),
    certainty: edge.certainty ?? "expected",
    proof: clone(edge.proof ?? null),
    evidence: [],
    proof_gaps: [],
    runs: [],
    decisions: [],
    loops: [],
    submap: null,
    goal_regression: [],
    on_failure: clone(edge.on_failure ?? "确认后补齐"),
  }));
  const destination = draft.destination
    ? {
      statement: draft.destination.statement,
      requires: clone(draft.destination.requires ?? []),
      invariants: clone(draft.destination.invariants ?? []),
      acceptance: clone(draft.destination.acceptance ?? []),
    }
    : { statement: "尚未定形目的地", requires: [], invariants: [], acceptance: [] };
  const facts = Object.fromEntries((draft.origin.facts ?? []).map((fact) => [fact.id, {
    value: fact.value,
    evidence: clone(fact.evidence ?? []),
  }]));
  const factCounts = { true: 0, false: 0, unknown: 0, conflict: 0 };
  for (const fact of Object.values(facts)) {
    if (fact.value in factCounts) factCounts[fact.value] += 1;
  }
  const proof = {
    structural: "not-started",
    reachability: "not-started",
    evidence_levels: {
      structural_soundness: { status: "not-started" },
      declared_model_derivability: { status: "not-started" },
      runtime_readiness: { status: "not-started", ready_edges: [] },
      executed_derivation: { status: "not-observed", verified_edges: [] },
      audited_arrival: { status: "not-observed", request: null },
    },
    destination_reachable: false,
    required_predicates: [],
    candidate_edges: draftEdges.map((edge) => edge.id),
    proven_edges: [],
    reachable_nodes: [],
    applied_edges: [],
    assumptions_used: [],
    proof_gaps: [],
  };
  const questions = clone(draft.questions ?? []);
  // An answered question remains in the ledger, but it must not keep the
  // reasoning cursor pinned to an object that no longer needs a decision.
  const currentQuestion = questions.find((question) => (question.status ?? "pending") === "pending") ?? null;
  const pendingRegressionCandidates = [...(draft.nodes ?? []), ...(draft.edges ?? [])]
    .filter((item) => item.status !== "confirmed");
  const goalRegression = buildWayfindingRegression({ draft: regressionDraft, nodes: draftNodes, edges: draftEdges });
  const regressionStepByNode = new Map(goalRegression.steps.map((step) => [step.target_node, step]));
  for (const node of draftNodes) {
    const step = regressionStepByNode.get(node.id);
    if (step) node.goal_regression = clone(step);
  }
  const regressionEdgeById = new Map(goalRegression.steps.flatMap((step) => step.incoming_edges.map((edge) => [edge.edge_id, edge])));
  for (const edge of draftEdges) {
    const regression = regressionEdgeById.get(edge.id);
    if (regression) {
      const targetStep = goalRegression.steps.find((step) => step.target_node === edge.to);
      const sourceStep = goalRegression.steps.find((step) => step.target_node === edge.from);
      edge.goal_regression = [{
        depth: targetStep?.depth ?? null,
        target_node: edge.to,
        suffix_proof: clone(targetStep?.suffix_proof ?? {
          status: regression.suffix_proven ? "logical" : "unreachable",
          destination_reachable: regression.suffix_proven,
        }),
        prefix_reachability: clone(sourceStep?.prefix_reachability ?? {}),
        bridge_status: targetStep?.bridge_status ?? "awaiting-prefix",
        acceptance: clone(edge.acceptance ?? []),
        non_goals: clone(edge.non_goals ?? []),
        confirmed: regression.confirmed === true,
        human_confirmed: edge.status === "confirmed",
        formal: false,
        confirmation_source: edge.status === "confirmed" ? "human-wayfinding" : null,
      }];
    }
  }
  const revision = hash("wayfinding:" + digest + ":" + sourceStatus + ":" + (sourceError ?? ""));
  return {
    schema: 1,
    projection: {
      revision,
      generated_at: now(),
      source_status: sourceStatus,
      source_error: sourceError,
      map_digest: digest,
      state_updated_at: draft.updated_at ?? null,
      mode: "wayfinding",
      read_only: true,
    },
    map: {
      id: "wayfinding-draft",
      intent: clone(draft.intent),
      destination: regressionDraft.destination
        ? {
          id: regressionDraft.destination.id,
          kind: regressionDraft.destination.kind,
          label: regressionDraft.destination.label,
          statement: regressionDraft.destination.statement,
          status: regressionDraft.destination.status ?? "pending",
          requires: clone(regressionDraft.destination.requires ?? []),
          invariants: clone(regressionDraft.destination.invariants ?? []),
          acceptance: clone(regressionDraft.destination.acceptance ?? []),
        }
        : destination,
      boundaries: clone(draft.boundaries ?? { in_scope: [], out_of_scope: [], authorization: [] }),
      phase: "wayfinding",
      wayfinding_phase: draft.phase,
      destination_status: draft.intent.status === "shaped" ? "changed" : "draft",
      actual_arrival: "not-audited",
      runtime_status: "wayfinding-draft",
    },
    summary: {
      structural: "not-started",
      reachability: "not-started",
      nodes: 0,
      satisfied_nodes: 0,
      edges: 0,
      verified_edges: 0,
      draft_nodes: draftNodes.length,
      draft_edges: draftEdges.length,
      pending_draft_nodes: draftNodes.filter((node) => !["confirmed", "satisfied"].includes(node.status)).length,
      pending_draft_edges: draftEdges.filter((edge) => edge.status !== "confirmed").length,
      open_questions: questions.filter((question) => ["pending", "deferred"].includes(question.status ?? "pending")).length,
      active_edge: null,
      active_run: null,
      pending_authorizations: 0,
      pending_arrival_audits: 0,
      proof_gaps: 0,
      acceptance_passed: 0,
      acceptance_total: draft.destination?.acceptance?.length ?? 0,
      facts: factCounts,
      submaps: 0,
      stale_submaps: 0,
      pending_proposals: 0,
      pending_regression_candidates: pendingRegressionCandidates.length,
      goal_regression_steps: goalRegression.steps.length,
      goal_regression_edges: goalRegression.edge_ids.length,
      goal_regression_confirmed: goalRegression.steps.filter((step) => step.human_confirmed).length,
    },
    proof,
    evidence_levels: clone(proof.evidence_levels),
    goal_regression: {
      ...goalRegression,
      confirmation_policy: "destination-confirmed-then-formal-registration",
      confirmation_note: "当前显示完整回归候选链；整体审阅并补齐合同后，写入 Blueprint 且通过 validate/prove 才成为正式拓扑。",
      unconfirmed_candidates: pendingRegressionCandidates.map((item) => ({ id: item.id, kind: item.kind ?? "edge", summary: item.purpose ?? item.label })),
    },
    acceptance: clone((draft.destination?.acceptance ?? []).map((item) => ({
      ...item,
      status: item.status ?? "pending",
      missing: clone(item.proves ?? []),
      evidence_records: 0,
    }))),
    predicates: [],
    nodes: draftNodes,
    edges: draftEdges,
    facts,
    loops: [],
    proof_gaps: [],
    evidence: [],
    edge_runs: [],
    decisions: [],
    authorization_requests: [],
    arrival_audit_requests: [],
    proposals: [],
    work_events: [],
    map_receipts: [],
    submaps: [],
    timeline: [],
    questions,
    wayfinding: {
      phase: draft.phase,
      draft_nodes: draftNodes,
      draft_edges: draftEdges,
      questions,
      current_target: currentQuestion?.target ?? null,
      current_question_id: currentQuestion?.id ?? null,
    },
    empty_state: {
      title: "正在建立地图草稿",
      next_steps: draft.phase === "survey"
        ? [
          "固定始发候选节点的四值事实和证据来源",
          "把唯一问题切换到待定形的目的地合同",
        ]
        : draft.phase === "shaping"
          ? [
            "收敛目标谓词、验收、非目标、不变量和授权边界",
            "展示完整目的地合同并等待后续独立人工确认",
          ]
          : goalRegression.complete_chain && !currentQuestion
            ? [
              "候选链已闭合并完成整体审阅；生成独立 Task Brief 和 Blueprint",
              "执行 validate/prove；首次建图用 init，已有地图修图用 replan",
            ]
            : [
              "从目的地反推完整里程碑与独立工作边候选链",
              "整体审阅、补齐合同并证明可达后再登记正式 Blueprint",
            ],
    },
  };
}

function eventDigest(event) {
  const payload = clone(event);
  delete payload.event_digest;
  return hash(stableJson(payload));
}

function readRuntimeEvolutionEvents(eventsPath) {
  if (!eventsPath || !fs.existsSync(eventsPath)) return [];
  const lines = fs.readFileSync(eventsPath, "utf8").split(/\r?\n/).filter((line) => line.trim() !== "");
  const events = [];
  const identities = new Set();
  let previous = null;
  let streamIdentity = null;
  for (let index = 0; index < lines.length; index += 1) {
    const seq = index + 1;
    let event;
    try {
      event = JSON.parse(lines[index]);
    } catch (error) {
      fail(`invalid runtime evolution event JSON at line ${seq}: ${error.message}`);
    }
    if (!event || typeof event !== "object" || Array.isArray(event)) fail(`runtime evolution event at seq ${seq} must be an object`);
    if (event.schema !== "mapflow.event/v1" || event.specversion !== "1.0") fail(`unsupported runtime evolution event at seq ${seq}`);
    for (const field of ["id", "source", "type", "time", "subject", "stream", "base_revision", "actor", "event_digest"]) {
      if (typeof event[field] !== "string" || event[field].trim() === "") fail(`runtime evolution event ${field} is invalid at seq ${seq}`);
    }
    if (!event.data || typeof event.data !== "object" || Array.isArray(event.data)) fail(`runtime evolution event data is invalid at seq ${seq}`);
    const projection = event.data.projection;
    if (!projection || typeof projection !== "object" || Array.isArray(projection) || projection.event_stream !== undefined) {
      fail(`runtime evolution projection is invalid at seq ${seq}`);
    }
    if (!/^mapflow\.[a-z0-9.]+\.v1$/.test(event.type)) fail(`runtime evolution event type is invalid at seq ${seq}`);
    if (event.seq !== seq) fail(`runtime evolution sequence gap at line ${seq}: found ${event.seq}`);
    if (event.previous_digest !== previous) fail(`runtime evolution hash chain is broken at seq ${seq}`);
    if (event.event_digest !== eventDigest(event)) fail(`runtime evolution digest mismatch at seq ${seq}`);
    if (event.base_revision !== (previous ?? projection.map_digest)) fail(`runtime evolution base revision mismatch at seq ${seq}`);
    if (event.source !== `mapflow://${projection.map_id}` || event.stream !== `map/${projection.map_id}`) {
      fail(`runtime evolution map identity mismatch at seq ${seq}`);
    }
    if (Number.isNaN(Date.parse(event.time))) fail(`runtime evolution time is invalid at seq ${seq}`);
    const identity = `${event.source}\0${event.stream}`;
    if (streamIdentity === null) streamIdentity = identity;
    if (streamIdentity !== identity) fail(`runtime evolution stream identity changed at seq ${seq}`);
    const eventIdentity = `${event.source}\0${event.id}`;
    if (identities.has(eventIdentity)) fail(`duplicate runtime evolution event identity at seq ${seq}`);
    identities.add(eventIdentity);
    previous = event.event_digest;
    events.push(event);
  }
  return events;
}

function eventLabel(type, details = {}) {
  const labels = {
    "mapflow.initialized.v1": "登记首张正式 Blueprint",
    "mapflow.edge.authorized.v1": "人工授权工作边",
    "mapflow.edge.verified.v1": "验证工作边与 Evidence",
    "mapflow.replan.requested.v1": "反例驱动修图",
    "mapflow.arrival.audited.v1": "完成到达审计",
  };
  if (labels[type]) return labels[type];
  const plain = type.replace(/^mapflow\./, "").replace(/\.v1$/, "").replaceAll(".", " ");
  return details.edge ? `${plain} · ${details.edge}` : plain;
}

function evolutionDiff(previousModel, nextModel) {
  function collectionDiff(previous = [], next = []) {
    const before = new Map(previous.map((item) => [item.id, item]));
    const after = new Map(next.map((item) => [item.id, item]));
    return {
      added: [...after.keys()].filter((id) => !before.has(id)),
      removed: [...before.keys()].filter((id) => !after.has(id)),
      changed: [...after.keys()].filter((id) => before.has(id) && stableJson(before.get(id)) !== stableJson(after.get(id))),
    };
  }
  const nodes = collectionDiff(previousModel?.nodes, nextModel.nodes);
  const edges = collectionDiff(previousModel?.edges, nextModel.edges);
  const beforeFacts = previousModel?.facts ?? {};
  const afterFacts = nextModel.facts ?? {};
  const facts = [...new Set([...Object.keys(beforeFacts), ...Object.keys(afterFacts)])]
    .filter((id) => stableJson(beforeFacts[id]) !== stableJson(afterFacts[id]));
  const acceptance = collectionDiff(previousModel?.acceptance, nextModel.acceptance);
  const beforeEvidence = new Set((previousModel?.evidence ?? []).map((item) => item.id ?? stableJson(item)));
  const evidence = (nextModel.evidence ?? [])
    .map((item) => item.id ?? stableJson(item))
    .filter((id) => !beforeEvidence.has(id));
  return { nodes, edges, facts: { changed: facts }, acceptance, evidence: { added: evidence } };
}

function markEvolutionChanges(model, diff) {
  const addedNodes = new Set(diff.nodes.added);
  const changedNodes = new Set(diff.nodes.changed);
  const addedEdges = new Set(diff.edges.added);
  const changedEdges = new Set(diff.edges.changed);
  for (const node of model.nodes) {
    if (addedNodes.has(node.id)) node.evolution_status = "added";
    else if (changedNodes.has(node.id)) node.evolution_status = "changed";
  }
  for (const edge of model.edges) {
    if (addedEdges.has(edge.id)) edge.evolution_status = "added";
    else if (changedEdges.has(edge.id)) edge.evolution_status = "changed";
  }
}

function stateFacts(state, blueprint) {
  if (!state) return initialFacts(blueprint);
  return clone(asObject(state.facts, "state.facts"));
}

function validateRuntimeState(state, blueprint) {
  if (!state) return;
  asObject(state, "state");
  ensureArrivalCheckpoints(state, blueprint);
  if (state.schema !== STATE_SCHEMA_VERSION) fail(`unsupported state schema: ${state.schema}`);
  if (state.map_id !== blueprint.map_id) fail(`state map_id ${state.map_id} does not match ${blueprint.map_id}`);
  asObject(state.facts, "state.facts");
  asArray(state.verified_edges, "state.verified_edges");
  asArray(state.evidence, "state.evidence");
  asArray(state.history, "state.history");
  asObject(state.loop_iterations, "state.loop_iterations");
  if (state.active_edge !== null && typeof state.active_edge !== "string") fail("state.active_edge must be a string or null");
  for (const field of ["edge_runs", "decisions", "route_approval_requests", "route_approvals", "authorization_requests", "arrival_audit_requests", "work_events", "proposals", "regression_proposals", "map_receipts", "receipt_invalidations"]) {
    if (state[field] !== undefined) asArray(state[field], `state.${field}`);
  }
  for (const checkpoint of state.arrival_checkpoints ?? []) {
    if (checkpoint?.schema !== "mapflow.arrival-checkpoint/v1" || checkpoint.receipt_digest !== arrivalCheckpointDigest(checkpoint)) {
      fail(`Arrival Checkpoint is invalid: ${checkpoint?.id ?? "unknown"}`);
    }
  }
}

function factValue(facts, factId) {
  const fact = facts[factId];
  return typeof fact === "string" ? fact : fact?.value;
}

function factEvidence(facts, factId) {
  const fact = facts[factId];
  return Array.isArray(fact?.evidence) ? clone(fact.evidence) : [];
}

function applicableInvariants(edge, blueprint) {
  const ids = new Set(edge.invariants);
  for (const invariantId of blueprint.destination.invariants) {
    const invariant = blueprint.invariants.find((item) => item.id === invariantId);
    if (invariant?.applies_to.includes(edge.id)) ids.add(invariantId);
  }
  return [...ids].map((id) => blueprint.invariants.find((item) => item.id === id)).filter(Boolean);
}

function acceptanceView(acceptance, evidence) {
  const records = evidence.filter((record) => (
    record.acceptance_ids?.includes(acceptance.id)
    && record.checks?.some((check) => check.result === "pass" && check.mode !== "reported")
    && (record.limits?.unverified?.length ?? 0) === 0
  ));
  const proven = new Set(records.flatMap((record) => record.proves ?? []));
  const missing = acceptance.proves.filter((predicateId) => !proven.has(predicateId));
  return {
    ...clone(acceptance),
    status: missing.length === 0 ? "passed" : "pending",
    missing,
    evidence_records: records.length,
  };
}

function nodeStatus(node, predicateViews, satisfied, { currentDestinationId, currentDestinationStatus, historicalArrival }) {
  if (node.id === currentDestinationId && ["arrived", "drifted"].includes(currentDestinationStatus)) return currentDestinationStatus;
  if (historicalArrival) return "historical-arrival";
  if (predicateViews.some((predicate) => predicate.actual === "conflict")) return "conflict";
  if (predicateViews.some((predicate) => predicate.actual === "unknown")) return "fog";
  return satisfied ? "satisfied" : "unsatisfied";
}

function edgeStatus({ edge, activeEdge, verifiedEdges, readiness, proofGaps, proven, latestRun, submap, effectsObserved }) {
  if (submap?.receipt_status === "stale" || submap?.source_status === "stale") return "stale";
  if (activeEdge === edge.id || latestRun?.status === "active") return "active";
  if (["waiting", "blocked", "failed", "cancelled"].includes(latestRun?.status)) return latestRun.status;
  if (verifiedEdges.has(edge.id)) return effectsObserved ? "verified" : "drifted";
  if (proofGaps.some((gap) => gap.at_edge === edge.id)) return "blocked";
  if (readiness.ready && proven) return "ready";
  if (readiness.ready) return "candidate";
  return "blocked";
}

function buildTimeline(state) {
  const history = (state?.history ?? []).map((entry, index) => ({
    id: `history:${index}`,
    kind: "history",
    at: entry.at ?? null,
    label: entry.event ?? "runtime event",
    details: clone(entry),
  }));
  const evidence = (state?.evidence ?? []).map((entry, index) => ({
    id: `evidence:${index}`,
    kind: "evidence",
    at: entry.recorded_at ?? null,
    label: entry.claim ?? `Evidence for ${entry.edge}`,
    edge: entry.edge,
    details: clone(entry),
  }));
  const arrivals = (state?.arrival_checkpoints ?? []).map((checkpoint) => ({
    id: `arrival:${checkpoint.id}`,
    kind: "arrival",
    at: checkpoint.recorded_at,
    label: `Arrival · ${checkpoint.destination.statement}`,
    details: clone(checkpoint),
  }));
  return [...history, ...evidence, ...arrivals].sort((left, right) => (
    String(left.at ?? "").localeCompare(String(right.at ?? "")) || left.id.localeCompare(right.id)
  ));
}

export function compileBoardModel({
  blueprint,
  digest,
  briefs = {},
  state = null,
  sourceStatus = "current",
  sourceError = null,
  stateDigest = null,
  submaps = [],
}) {
  validateBlueprint(blueprint);
  validateRuntimeState(state, blueprint);
  const facts = stateFacts(state, blueprint);
  const loopIterations = state?.loop_iterations ?? Object.fromEntries(blueprint.loops.map((loop) => [loop.id, 0]));
  const proof = proveBlueprint(blueprint, facts, { loopIterations });
  const goalRegression = buildGoalRegression(blueprint, facts, {
    proof,
    destinationStatus: state?.destination_status ?? "draft",
    loopIterations,
  });
  const satisfiedNodeIds = new Set(deriveSatisfiedNodes(blueprint, facts));
  const verifiedEdges = new Set(state?.verified_edges ?? []);
  const evidence = clone(state?.evidence ?? []);
  const acceptance = blueprint.destination.acceptance.map((item) => acceptanceView(item, evidence));
  const proofGaps = clone(proof.proof_gaps);
  const candidateEdges = new Set(proof.candidate_edges);
  const provenEdges = new Set(proof.proven_edges);
  const actualArrival = state?.phase === "arrived" ? "audited" : "not-audited";
  const edgeRuns = clone(state?.edge_runs ?? []);
  const decisions = clone(state?.decisions ?? []);
  const authorizationRequests = clone(state?.authorization_requests ?? []);
  const capabilities = clone(state?.capabilities ?? []);
  const arrivalAuditRequests = clone(state?.arrival_audit_requests ?? []);
  const arrivalCheckpoints = clone(state?.arrival_checkpoints ?? []);
  const successorBindings = clone(state?.successor_bindings ?? []);
  const submapByEdge = new Map(submaps.map((item) => [item.parent_edge, item]));
  const predicates = blueprint.predicates.map((predicate) => ({
    ...clone(predicate),
    actual: factValue(facts, predicate.fact) ?? "unknown",
    satisfied: predicateSatisfied(predicate.id, facts, blueprint),
    evidence: factEvidence(facts, predicate.fact),
  }));
  const predicateMap = new Map(predicates.map((predicate) => [predicate.id, predicate]));
  const currentDestinationNode = [...blueprint.nodes].reverse().find((node) => (
    node.kind === "destination"
    && blueprint.destination.requires.every((predicateId) => node.predicates.includes(predicateId))
  )) ?? null;
  const invariantMap = new Map(blueprint.invariants.map((invariant) => [invariant.id, invariant]));
  const currentDestinationRequired = [...new Set([
    ...blueprint.destination.requires,
    ...blueprint.destination.invariants.flatMap((invariantId) => invariantMap.get(invariantId)?.requires ?? []),
  ])];
  const currentDestinationMissing = currentDestinationRequired.filter((predicateId) => !predicateSatisfied(predicateId, facts, blueprint));
  const currentDestinationObserved = currentDestinationMissing.length === 0;
  const currentDestinationStatus = currentDestinationObserved
    ? state?.phase === "arrived" ? "arrived" : "satisfied"
    : state?.phase === "arrived" && arrivalCheckpoints.length > 0 ? "drifted" : "unsatisfied";
  const checkpointIdsByNode = new Map();
  for (const checkpoint of arrivalCheckpoints) {
    const nodeId = checkpoint.destination_node.id;
    if (!checkpointIdsByNode.has(nodeId)) checkpointIdsByNode.set(nodeId, []);
    checkpointIdsByNode.get(nodeId).push(checkpoint.id);
  }

  const nodes = blueprint.nodes.map((node) => {
    const nodePredicates = node.predicates.map((predicateId) => clone(predicateMap.get(predicateId)));
    const satisfied = satisfiedNodeIds.has(node.id);
    return {
      ...clone(node),
      satisfied,
      status: nodeStatus(
        node,
        nodePredicates,
        satisfied,
        {
          currentDestinationId: currentDestinationNode?.id ?? null,
          currentDestinationStatus,
          historicalArrival: checkpointIdsByNode.has(node.id) && node.id !== currentDestinationNode?.id,
        },
      ),
      arrival_checkpoint_ids: [...(checkpointIdsByNode.get(node.id) ?? [])],
      predicates: nodePredicates,
      proof_gaps: proofGaps.filter((gap) => node.predicates.includes(gap.missing)),
      goal_regression: null,
    };
  });

  const regressionStepByNode = new Map(goalRegression.steps.map((step) => [step.target_node, step]));
  for (const node of nodes) {
    const step = regressionStepByNode.get(node.id);
    if (!step) continue;
    node.goal_regression = clone(step);
  }

  const edges = blueprint.edges.map((edge) => {
    const readiness = edgeReadiness(blueprint, facts, edge.id);
    const edgeEvidence = evidence.filter((record) => record.edge === edge.id);
    const edgeAcceptance = acceptance.filter((item) => (
      item.proves.some((predicateId) => edge.effects.includes(predicateId))
      || edgeEvidence.some((record) => record.acceptance_ids?.includes(item.id))
    ));
    const brief = briefs[edge.id];
    const invariants = applicableInvariants(edge, blueprint);
    const loops = blueprint.loops.filter((loop) => loop.edges.includes(edge.id)).map((loop) => ({
      ...clone(loop),
      iterations: loopIterations[loop.id] ?? 0,
      exhausted: (loopIterations[loop.id] ?? 0) >= loop.max_iterations,
    }));
    const runs = edgeRuns.filter((run) => run.edge === edge.id);
    const latestRun = runs.at(-1) ?? null;
    const submap = submapByEdge.get(edge.id) ?? null;
    return {
      ...clone(edge),
      title: brief?.metadata?.title ?? edge.id,
      status: edgeStatus({
        edge,
        activeEdge: state?.active_edge ?? null,
        verifiedEdges,
        readiness,
        proofGaps,
        proven: provenEdges.has(edge.id),
        latestRun,
        submap,
        effectsObserved: edge.effects.every((predicateId) => predicateSatisfied(predicateId, facts, blueprint)),
      }),
      candidate: candidateEdges.has(edge.id),
      proven: provenEdges.has(edge.id),
      ready: readiness.ready,
      missing: clone(readiness.missing),
      brief: brief ? clone(brief) : { ref: edge.brief_ref, metadata: null, content: null },
      non_goals: clone(brief?.metadata?.contract?.scope?.out ?? []),
      applicable_invariants: clone(invariants),
      loops,
      evidence: edgeEvidence,
      acceptance: edgeAcceptance,
      proof_gaps: proofGaps.filter((gap) => gap.at_edge === edge.id),
      causal_gaps: (proof.causal_gaps ?? []).filter((gap) => gap.at_edge === edge.id),
      runs,
      decisions: decisions.filter((decision) => decision.edge === edge.id),
      authorization_requests: authorizationRequests.filter((request) => request.edge === edge.id),
      capabilities: capabilities.filter((capability) => capability.edge === edge.id),
      submap: submap ? clone(submap) : null,
      goal_regression: goalRegression.steps
        .filter((step) => step.incoming_edges.some((candidate) => candidate.edge_id === edge.id))
        .map((step) => ({
          depth: step.depth,
          target_node: step.target_node,
          suffix_proof: clone(step.suffix_proof),
          prefix_reachability: clone(step.prefix_reachability),
          bridge_status: step.bridge_status,
          confirmed: true,
          human_confirmed: true,
          formal: true,
          confirmation_source: "formal-blueprint",
        })),
    };
  });

  const factCounts = { true: 0, false: 0, unknown: 0, conflict: 0 };
  for (const fact of Object.values(facts)) {
    const value = typeof fact === "string" ? fact : fact?.value;
    if (value in factCounts) factCounts[value] += 1;
  }
  const revision = hash(`${digest}:${stateDigest ?? "definition"}:${sourceStatus}:${sourceError ?? ""}:${stableJson(submaps)}`);
  const enrichedGoalRegression = {
    ...clone(goalRegression),
    destination: {
      ...clone(goalRegression.destination),
      status: "defined",
    },
    confirmation_policy: "destination-confirmed-then-formal-registration",
    confirmation_note: "只有已写入 Blueprint、通过 validate/prove 并经 init 或 replan 登记的节点和工作边才进入正式图。",
    unconfirmed_candidates: clone(state?.regression_proposals ?? []),
  };
  const regressionStepLookup = new Map(enrichedGoalRegression.steps.map((step) => [step.target_node, step]));
  for (const edge of edges) {
    const step = regressionStepLookup.get(edge.to);
    if (!step) continue;
    const briefContract = edge.brief?.metadata?.contract ?? {};
    const nonGoals = [
      ...(briefContract.scope?.out ?? []),
      ...(briefContract.out_of_scope ?? []),
    ];
    for (const candidate of step.incoming_edges.filter((item) => item.edge_id === edge.id)) {
      candidate.non_goals = [...new Set(nonGoals)];
      candidate.acceptance = edge.acceptance.map((item) => clone(item));
    }
  }
  for (const node of nodes) {
    const step = regressionStepLookup.get(node.id);
    if (step) node.goal_regression = clone(step);
  }
  const readyEdges = edges.filter((edge) => edge.status === "ready" && edge.proven);
  const independentPairs = [];
  for (let leftIndex = 0; leftIndex < readyEdges.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < readyEdges.length; rightIndex += 1) {
      const left = readyEdges[leftIndex];
      const right = readyEdges[rightIndex];
      const leftRequirements = new Set([
        ...blueprint.nodes.find((node) => node.id === left.from).predicates,
        ...left.preconditions,
        ...left.applicable_invariants.flatMap((invariant) => invariant.requires),
      ]);
      const rightRequirements = new Set([
        ...blueprint.nodes.find((node) => node.id === right.from).predicates,
        ...right.preconditions,
        ...right.applicable_invariants.flatMap((invariant) => invariant.requires),
      ]);
      const leftEffectFacts = new Set(left.effects.map((predicateId) => predicateMap.get(predicateId).fact));
      const rightEffectFacts = new Set(right.effects.map((predicateId) => predicateMap.get(predicateId).fact));
      const independent = !left.effects.some((predicateId) => rightRequirements.has(predicateId))
        && !right.effects.some((predicateId) => leftRequirements.has(predicateId))
        && ![...leftEffectFacts].some((factId) => rightEffectFacts.has(factId));
      if (independent) independentPairs.push([left.id, right.id]);
    }
  }
  const parallelReadyEdges = new Set(independentPairs.flat());
  const destinationObserved = blueprint.destination.requires.every((predicateId) => predicateSatisfied(predicateId, facts, blueprint));
  const acceptanceObserved = acceptance.length > 0 && acceptance.every((item) => item.status === "passed");
  const evidenceLevels = {
    ...clone(proof.evidence_levels ?? {}),
    runtime_readiness: {
      status: state?.active_run ? "active" : readyEdges.length > 0 ? "ready" : destinationObserved && acceptanceObserved ? "complete" : "blocked",
      ready_edges: readyEdges.map((edge) => edge.id),
      active_edge: state?.active_edge ?? null,
      basis: "observed facts, current proof, loop budget, and active run state",
    },
    executed_derivation: {
      status: destinationObserved && acceptanceObserved ? "complete" : verifiedEdges.size > 0 ? "partial" : "not-observed",
      verified_edges: [...verifiedEdges],
      basis: "trusted edge evidence has applied observed effects",
    },
    audited_arrival: {
      status: actualArrival === "audited" ? "established" : "not-observed",
      request: state?.arrival_audit?.request ?? null,
      basis: "a designated human or Agent consumed the frozen arrival audit request",
    },
  };
  return {
    schema: 1,
    projection: {
      revision,
      generated_at: now(),
      source_status: sourceStatus,
      source_error: sourceError,
      map_digest: digest,
      state_updated_at: state?.updated_at ?? null,
      mode: state ? "runtime" : "definition",
      read_only: true,
    },
    map: {
      id: blueprint.map_id,
      intent: clone(blueprint.intent),
      destination: clone(blueprint.destination),
      boundaries: clone(blueprint.boundaries),
      phase: state?.phase ?? "wayfinding",
      destination_status: state?.destination_status ?? "draft",
      actual_arrival: actualArrival,
      current_destination: {
        node_id: currentDestinationNode?.id ?? null,
        status: currentDestinationStatus,
        observed: currentDestinationObserved,
        required: currentDestinationRequired,
        missing: currentDestinationMissing,
      },
      latest_arrival: arrivalCheckpoints.at(-1) ?? null,
      runtime_status: state?.runtime_status ?? (state ? "idle" : "definition"),
    },
    summary: {
      structural: proof.structural,
      reachability: proof.reachability,
      nodes: nodes.length,
      satisfied_nodes: nodes.filter((node) => node.satisfied).length,
      edges: edges.length,
      verified_edges: edges.filter((edge) => edge.status === "verified").length,
      ready_edges: readyEdges.map((edge) => edge.id),
      parallel_ready_edges: parallelReadyEdges.size,
      parallel_ready_groups: independentPairs,
      active_edge: state?.active_edge ?? null,
      active_run: state?.active_run ?? null,
      pending_authorizations: authorizationRequests.filter((request) => request.status === "pending").length,
      active_capabilities: capabilities.filter((capability) => capability.status === "active").length,
      pending_arrival_audits: arrivalAuditRequests.filter((request) => request.status === "pending").length,
      arrival_checkpoints: arrivalCheckpoints.length,
      successor_legs: successorBindings.length,
      proof_gaps: proofGaps.length,
      acceptance_passed: acceptance.filter((item) => item.status === "passed").length,
      acceptance_total: acceptance.length,
      facts: factCounts,
      submaps: submaps.length,
      stale_submaps: submaps.filter((item) => item.source_status === "stale" || item.receipt_status === "stale").length,
      pending_proposals: (state?.proposals ?? []).filter((item) => item.status === "pending").length,
      pending_regression_candidates: (state?.regression_proposals ?? []).filter((item) => item.status === "pending").length,
      goal_regression_steps: goalRegression.steps.length,
      goal_regression_edges: goalRegression.edge_ids.length,
      goal_regression_confirmed: enrichedGoalRegression.steps.reduce((total, step) => total + step.incoming_edges.filter((edge) => edge.confirmed).length, 0),
    },
    proof: { ...clone(proof), evidence_levels: clone(evidenceLevels) },
    evidence_levels: evidenceLevels,
    goal_regression: enrichedGoalRegression,
    acceptance,
    predicates,
    nodes,
    edges,
    facts,
    loops: blueprint.loops.map((loop) => ({
      ...clone(loop),
      iterations: loopIterations[loop.id] ?? 0,
      exhausted: (loopIterations[loop.id] ?? 0) >= loop.max_iterations,
    })),
    proof_gaps: proofGaps,
    evidence,
    edge_runs: edgeRuns,
    decisions,
    authorization_requests: authorizationRequests,
    capabilities,
    arrival_audit_requests: arrivalAuditRequests,
    arrival_checkpoints: arrivalCheckpoints,
    successor_bindings: successorBindings,
    proposals: clone(state?.proposals ?? []),
    work_events: clone(state?.work_events ?? []),
    map_receipts: clone(state?.map_receipts ?? []),
    submaps: clone(submaps),
    timeline: buildTimeline(state),
  };
}

function readRuntimeState(statePath) {
  if (!statePath || !fs.existsSync(statePath)) return { state: null, digest: null };
  const content = fs.readFileSync(statePath, "utf8");
  try {
    const state = JSON.parse(content);
    if (state.event_stream) {
      const eventsPath = path.resolve(path.dirname(path.resolve(statePath)), state.event_stream.path);
      if (!fs.existsSync(eventsPath)) fail(`event stream disappeared: ${eventsPath}`);
      const lines = fs.readFileSync(eventsPath, "utf8").split(/\r?\n/).filter((line) => line.trim() !== "");
      let previous = null;
      const identities = new Set();
      let latestProjection = null;
      let streamIdentity = null;
      for (let index = 0; index < lines.length; index += 1) {
        const event = JSON.parse(lines[index]);
        if (!event || typeof event !== "object" || Array.isArray(event)) fail(`event at seq ${index + 1} must be an object`);
        if (event.schema !== "mapflow.event/v1" || event.specversion !== "1.0") fail(`unsupported event envelope at seq ${index + 1}`);
        for (const field of ["id", "source", "type", "time", "subject", "stream", "base_revision", "actor", "event_digest"]) {
          if (typeof event[field] !== "string" || event[field].trim() === "") fail(`event ${field} is invalid at seq ${index + 1}`);
        }
        const projection = event.data?.projection;
        if (!projection || typeof projection !== "object" || Array.isArray(projection) || projection.event_stream !== undefined) {
          fail(`event projection is invalid at seq ${index + 1}`);
        }
        if (event.source !== `mapflow://${projection.map_id}` || event.stream !== `map/${projection.map_id}`) {
          fail(`event map identity mismatch at seq ${index + 1}`);
        }
        if (!/^mapflow\.[a-z0-9.]+\.v1$/.test(event.type) || Number.isNaN(Date.parse(event.time))) {
          fail(`event type or time is invalid at seq ${index + 1}`);
        }
        if (event.base_revision !== (previous ?? projection.map_digest)) fail(`event base revision mismatch at seq ${index + 1}`);
        const currentIdentity = `${event.source}\0${event.stream}`;
        if (streamIdentity === null) streamIdentity = currentIdentity;
        if (streamIdentity !== currentIdentity) fail(`event stream identity changed at seq ${index + 1}`);
        if (event.seq !== index + 1 || event.previous_digest !== previous || event.event_digest !== eventDigest(event)) {
          fail(`event stream integrity failure at seq ${index + 1}`);
        }
        const identity = `${event.source}\0${event.id}`;
        if (identities.has(identity)) fail(`duplicate event identity at seq ${event.seq}`);
        identities.add(identity);
        previous = event.event_digest;
        latestProjection = projection;
      }
      if (lines.length !== state.event_stream.last_seq || previous !== state.event_stream.head_digest) fail("event projection mismatch");
      const stateProjection = clone(state);
      delete stateProjection.event_stream;
      if (!latestProjection || stableJson(stateProjection) !== stableJson(latestProjection)) fail("state content does not match the event projection");
    }
    return { state, digest: hash(content) };
  } catch (error) {
    fail(`invalid runtime state: ${statePath}: ${error.message}`);
  }
}

function stateMapPath(statePath, state) {
  if (!statePath || !state?.map) return null;
  return path.resolve(path.dirname(path.resolve(statePath)), state.map);
}

function wayfindingPathForState(statePath) {
  if (!statePath) return null;
  return path.join(path.dirname(path.resolve(statePath)), "wayfinding.yaml");
}

export function createBoardSnapshotReader({ mapPath = null, statePath = null } = {}) {
  let lastGood = null;
  let lastBriefs = {};
  let runtimeWasPresent = false;

  let latestContext = null;
  const childLastGood = new Map();
  const childEvolutionReaders = new Map();
  // Evolution is runtime/sidecar truth. A definition-only --map view must not
  // discover adjacent journals and silently mix them into the projection.
  const evolutionDirectory = statePath ? path.dirname(path.resolve(statePath)) : null;
  const wayfindingEventsPath = evolutionDirectory ? path.join(evolutionDirectory, "wayfinding-events.jsonl") : null;
  const runtimeEventsPath = evolutionDirectory ? path.join(evolutionDirectory, "events.jsonl") : null;

  function loadEvolution() {
    const wayfinding = wayfindingEventsPath
      ? readWayfindingEvents(wayfindingEventsPath)
      : { events: [], head_digest: null, coverage: { complete: false, from: null, reason: "Wayfinding history was not recorded" } };
    const runtimeEvents = readRuntimeEvolutionEvents(runtimeEventsPath);
    const currentWayfindingPath = evolutionDirectory ? path.join(evolutionDirectory, "wayfinding.yaml") : null;
    if (wayfinding.events.length) {
      if (!currentWayfindingPath || !fs.existsSync(currentWayfindingPath)) fail("recorded Wayfinding journal has no current draft");
      const actualDraftDigest = hash(fs.readFileSync(currentWayfindingPath, "utf8"));
      if (actualDraftDigest !== wayfinding.events.at(-1).data.draft_digest) {
        fail("current Wayfinding draft does not match the recorded journal head");
      }
    }
    let coverage = clone(wayfinding.coverage);
    let bridge = null;
    if (runtimeEvents.length) {
      bridge = runtimeEvents[0].data?.details?.source_wayfinding ?? null;
      if (wayfinding.events.length) {
        if (!bridge) fail("runtime evolution is missing its Wayfinding digest bridge");
        const wayfindingHead = wayfinding.events.at(-1);
        const expectedCoverage = wayfinding.coverage.complete ? "complete" : "partial";
        if (
          bridge.stream !== wayfindingHead.stream
          || bridge.seq !== wayfinding.events.length
          || bridge.head_digest !== wayfinding.head_digest
          || bridge.draft_digest !== wayfindingHead.data.draft_digest
          || bridge.coverage !== expectedCoverage
        ) {
          fail("runtime evolution Wayfinding digest bridge does not match the recorded journal head");
        }
      } else {
        coverage = {
          complete: false,
          from: "runtime-init",
          reason: "Wayfinding history was not recorded before runtime initialization",
        };
      }
    }
    const frames = [
      ...wayfinding.events.map((event) => ({
        id: `wayfinding:${event.seq}`,
        segment: "wayfinding",
        seq: event.seq,
        digest: event.event_digest,
        at: event.time,
        type: event.type,
        actor: event.actor,
        subject: event.subject,
        phase: event.data.snapshot?.phase ?? "empty",
        summary: event.data.summary,
        reason: event.data.reason,
        target: event.data.target,
        raw: event,
      })),
      ...runtimeEvents.map((event) => ({
        id: `runtime:${event.seq}`,
        segment: "runtime",
        seq: event.seq,
        digest: event.event_digest,
        at: event.time,
        type: event.type,
        actor: event.actor,
        subject: event.subject,
        phase: event.data.projection.phase,
        summary: eventLabel(event.type, event.data.details),
        reason: event.data.details?.reason ?? event.data.details?.answer ?? null,
        target: event.data.details?.edge
          ? { kind: "edge", id: event.data.details.edge }
          : { kind: "map", id: event.data.projection.map_id },
        bridge_from: event.seq === 1 && bridge ? { frame: `wayfinding:${bridge.seq}`, digest: bridge.head_digest } : null,
        raw: event,
      })),
    ];
    return { frames, coverage, bridge, wayfinding, runtimeEvents };
  }

  function publicFrame(frame, index, total) {
    const { raw, ...metadata } = frame;
    return { ...metadata, index, total };
  }

  function evolutionReaderFor(bindingPath, childMapPath, childStatePath) {
    const identity = `${childMapPath}\0${childStatePath}`;
    const cached = childEvolutionReaders.get(bindingPath);
    if (cached?.identity === identity) return cached.reader;
    const reader = createBoardSnapshotReader({ mapPath: childMapPath, statePath: childStatePath });
    childEvolutionReaders.set(bindingPath, { identity, reader });
    return reader;
  }

  function unavailableHistoricalSubmap(binding, bindingPath, receipt, reason, { stale = false } = {}) {
    return {
      ...clone(binding),
      path: bindingPath,
      map_id: binding.expected_map_id,
      phase: "unknown",
      actual_arrival: "not-audited",
      source_status: stale ? "stale" : "historical",
      source_error: reason,
      receipt_status: receipt ? "stale" : "missing",
      receipt_id: receipt?.receipt_id ?? null,
      fog_nodes: 0,
      acceptance_passed: 0,
      acceptance_total: 0,
      revision: hash(`historical-submap:${bindingPath}:${receipt?.child?.state_revision ?? "unbound"}:${reason}`),
      historical_frame: null,
      historical_expandable: false,
      independent_history: true,
      history_path: `/api/submaps/${bindingPath}/evolution`,
    };
  }

  function historicalSubmapSummary(parentMapPath, binding, parentState, bindingPath = binding.id) {
    const receipt = [...(parentState?.map_receipts ?? [])].reverse().find((item) => item.binding_id === binding.id) ?? null;
    if (!receipt) {
      return unavailableHistoricalSubmap(
        binding,
        bindingPath,
        null,
        "父帧当时尚无 Map Receipt；可查看子地图独立历史，但不能把 child 当前态拼入父帧",
      );
    }
    const invalidated = (parentState?.receipt_invalidations ?? []).some((item) => item.receipt_id === receipt.receipt_id);
    if (invalidated) {
      return unavailableHistoricalSubmap(binding, bindingPath, receipt, "父帧中的 Map Receipt 已失效", { stale: true });
    }
    const parentDirectory = path.dirname(parentMapPath);
    const childMapPath = path.resolve(parentDirectory, binding.map_ref.replaceAll("/", path.sep));
    const childStatePath = path.resolve(parentDirectory, binding.state_ref.replaceAll("/", path.sep));
    try {
      const childReader = evolutionReaderFor(bindingPath, childMapPath, childStatePath);
      const catalog = childReader.readEvolutionCatalog().model;
      if (catalog.recording_status === "stale") fail(catalog.error ?? "child evolution stream is stale");
      const pinned = catalog.frames.find((candidate) => (
        candidate.segment === "runtime" && candidate.digest === receipt.child.state_revision
      ));
      if (!pinned) fail(`receipt revision ${receipt.child.state_revision} is not present in the child runtime stream`);
      const frame = childReader.readEvolutionFrame(pinned.id).model;
      const child = frame.board;
      const errors = [];
      if (child.map.id !== binding.expected_map_id || child.map.id !== receipt.child.map_id) errors.push("child map identity does not match the binding receipt");
      if (child.projection.map_digest !== binding.expected_map_digest || child.projection.map_digest !== receipt.child.map_digest) errors.push("child Blueprint digest does not match the binding receipt");
      if (errors.length) fail(errors.join("; "));
      return {
        ...clone(binding),
        path: bindingPath,
        map_id: child.map.id,
        phase: child.map.phase,
        actual_arrival: child.map.actual_arrival,
        source_status: "historical",
        source_error: null,
        receipt_status: "pinned",
        receipt_id: receipt.receipt_id,
        fog_nodes: child.nodes.filter((node) => ["fog", "conflict"].includes(node.status)).length,
        acceptance_passed: child.summary.acceptance_passed,
        acceptance_total: child.summary.acceptance_total,
        revision: child.projection.revision,
        historical_frame: pinned.id,
        historical_expandable: true,
        independent_history: true,
        history_path: `/api/submaps/${bindingPath}/evolution`,
        receipt_pin: {
          parent_receipt: receipt.receipt_id,
          child_revision: receipt.child.state_revision,
          child_frame: pinned.id,
        },
      };
    } catch (error) {
      return unavailableHistoricalSubmap(
        binding,
        bindingPath,
        receipt,
        error instanceof Error ? error.message : String(error),
        { stale: true },
      );
    }
  }

  function compileEvolutionFrame(frame) {
    if (frame.segment === "wayfinding") {
      const snapshot = frame.raw.data.snapshot;
      if (snapshot === null) return emptyBoardModel();
      validateWayfinding(clone(snapshot));
      return compileWayfindingBoardModel({
        draft: clone(snapshot),
        digest: frame.raw.data.draft_digest ?? frame.digest,
      });
    }
    const state = clone(frame.raw.data.projection);
    const blueprint = validateBlueprint(clone(state.blueprint_snapshot));
    const resolvedMap = mapPath ? path.resolve(mapPath) : stateMapPath(statePath, state);
    const submaps = resolvedMap ? blueprint.submaps.map((binding) => (
      historicalSubmapSummary(resolvedMap, binding, state, binding.id)
    )) : [];
    return compileBoardModel({
      blueprint,
      digest: state.map_digest,
      briefs: clone(state.brief_snapshots ?? {}),
      state,
      stateDigest: frame.digest,
      submaps,
    });
  }

  function childSnapshot(resolvedMap, binding, parentState, { bindingPath = binding.id, includeSubmaps = false } = {}) {
    const rootDirectory = path.dirname(resolvedMap);
    const childMapPath = path.resolve(rootDirectory, binding.map_ref.replaceAll("/", path.sep));
    const childStatePath = path.resolve(rootDirectory, binding.state_ref.replaceAll("/", path.sep));
    try {
      const loaded = readBlueprint(childMapPath);
      const stateResult = readRuntimeState(childStatePath);
      const childState = stateResult.state;
      const errors = [];
      if (loaded.blueprint.map_id !== binding.expected_map_id) errors.push(`map id ${loaded.blueprint.map_id} != ${binding.expected_map_id}`);
      if (loaded.digest !== binding.expected_map_digest) errors.push("Blueprint digest changed");
      if (!childState) errors.push("runtime state is absent");
      else if (childState.map_digest !== loaded.digest) errors.push("runtime is stale against Blueprint");
      const receipt = [...(parentState?.map_receipts ?? [])].reverse().find((item) => item.binding_id === binding.id) ?? null;
      const childRevision = childState?.event_stream?.head_digest ?? stateResult.digest;
      const invalidated = receipt && (parentState?.receipt_invalidations ?? []).some((item) => item.receipt_id === receipt.receipt_id);
      const receiptStatus = !receipt ? "missing" : invalidated || receipt.child.map_digest !== loaded.digest || receipt.child.state_revision !== childRevision ? "stale" : "current";
      const childSubmaps = includeSubmaps ? loaded.blueprint.submaps.map((childBinding) => childSnapshot(
        childMapPath,
        childBinding,
        childState,
        { bindingPath: `${bindingPath}/${childBinding.id}`, includeSubmaps: false },
      ).summary) : [];
      const model = compileBoardModel({
        blueprint: loaded.blueprint,
        digest: loaded.digest,
        briefs: loaded.briefs,
        state: childState,
        stateDigest: stateResult.digest,
        sourceStatus: errors.length ? "stale" : "current",
        sourceError: errors.join("; ") || null,
        submaps: childSubmaps,
      });
      const summary = {
        ...clone(binding),
        path: bindingPath,
        map_id: loaded.blueprint.map_id,
        phase: childState?.phase ?? "wayfinding",
        actual_arrival: childState?.phase === "arrived" ? "audited" : "not-audited",
        source_status: errors.length ? "stale" : "current",
        source_error: errors.join("; ") || null,
        receipt_status: receiptStatus,
        receipt_id: receipt?.receipt_id ?? null,
        fog_nodes: model.nodes.filter((node) => ["fog", "conflict"].includes(node.status)).length,
        acceptance_passed: model.summary.acceptance_passed,
        acceptance_total: model.summary.acceptance_total,
        revision: model.projection.revision,
      };
      const context = { resolvedMap: childMapPath, resolvedState: childStatePath, blueprint: loaded.blueprint, state: childState };
      childLastGood.set(bindingPath, { model, summary, context });
      return { model, summary, context };
    } catch (error) {
      const previous = childLastGood.get(bindingPath);
      if (!previous) {
        return {
          model: null,
          summary: { ...clone(binding), path: bindingPath, map_id: binding.expected_map_id, phase: "unknown", actual_arrival: "not-audited", source_status: "stale", source_error: error.message, receipt_status: "stale", receipt_id: null, fog_nodes: 0, acceptance_passed: 0, acceptance_total: 0, revision: hash(error.message) },
          context: null,
        };
      }
      const model = clone(previous.model);
      model.projection.source_status = "stale";
      model.projection.source_error = error.message;
      model.projection.revision = hash(`${model.projection.revision}:${error.message}`);
      return {
        model,
        summary: { ...clone(previous.summary), source_status: "stale", source_error: error.message, receipt_status: "stale", revision: model.projection.revision },
        context: previous.context,
      };
    }
  }

  function readSnapshot() {
    try {
      const stateResult = readRuntimeState(statePath);
      if (stateResult.state) runtimeWasPresent = true;
      if (runtimeWasPresent && !stateResult.state) fail(`runtime state disappeared: ${statePath}`);
      const resolvedMap = mapPath
        ? path.resolve(mapPath)
        : stateMapPath(statePath, stateResult.state);
      if (!resolvedMap) {
        const draftPath = wayfindingPathForState(statePath);
        if (draftPath && fs.existsSync(draftPath)) {
          try {
            const loadedDraft = readWayfinding(draftPath);
            const model = compileWayfindingBoardModel({ draft: loadedDraft.draft, digest: loadedDraft.digest });
            lastGood = model;
            latestContext = null;
            return { model, etag: `"${model.projection.revision}"` };
          } catch (error) {
            if (!lastGood) {
              const model = emptyBoardModel();
              model.projection.source_status = "stale";
              model.projection.source_error = error.message;
              model.projection.revision = hash(`empty:stale:${error.message}`);
              return { model, etag: `"${model.projection.revision}"` };
            }
            throw error;
          }
        }
        const model = emptyBoardModel();
        lastGood = model;
        latestContext = null;
        return { model, etag: `"${model.projection.revision}"` };
      }

      let loaded;
      let loadError = null;
      try {
        loaded = readBlueprint(resolvedMap);
      } catch (error) {
        loadError = error;
      }

      const state = stateResult.state;
      const registeredEquivalent = state && loaded && loaded.digest !== state.map_digest
        && registeredBriefFormattingEquivalent({
          mapPath: resolvedMap,
          blueprint: loaded.blueprint,
          briefs: loaded.briefs,
          state,
        });
      const registeredMismatch = state && loaded && loaded.digest !== state.map_digest && !registeredEquivalent;
      if ((loadError || registeredMismatch) && state?.blueprint_snapshot) {
        const snapshot = validateBlueprint(clone(state.blueprint_snapshot));
        const sourceError = loadError
          ? `current Blueprint is invalid: ${loadError.message}`
          : "Blueprint or bound Task Brief has unregistered changes";
        const submaps = snapshot.submaps.map((binding) => childSnapshot(resolvedMap, binding, state, {
          bindingPath: binding.id,
          includeSubmaps: false,
        }).summary);
        const model = compileBoardModel({
          blueprint: snapshot,
          digest: state.map_digest,
          briefs: Object.keys(state.brief_snapshots ?? {}).length ? state.brief_snapshots : lastBriefs,
          state,
          stateDigest: stateResult.digest,
          sourceStatus: "stale",
          sourceError,
          submaps,
        });
        lastGood = model;
        latestContext = { resolvedMap, blueprint: snapshot, state };
        return { model, etag: `"${model.projection.revision}"` };
      }
      if (loadError) throw loadError;

      const projection = registeredEquivalent
        ? {
            ...loaded,
            digest: state.map_digest,
            brief_digests: clone(state.brief_digests),
            briefs: clone(state.brief_snapshots),
          }
        : loaded;

      const submaps = projection.blueprint.submaps.map((binding) => childSnapshot(resolvedMap, binding, state, {
        bindingPath: binding.id,
        includeSubmaps: false,
      }).summary);
      const model = compileBoardModel({
        blueprint: projection.blueprint,
        digest: projection.digest,
        briefs: projection.briefs,
        state,
        stateDigest: stateResult.digest,
        submaps,
      });
      lastBriefs = projection.briefs;
      lastGood = model;
      latestContext = { resolvedMap, blueprint: loaded.blueprint, state };
      return { model, etag: `"${model.projection.revision}"` };
    } catch (error) {
      if (!lastGood) throw error;
      const sourceError = error instanceof Error ? error.message : String(error);
      const model = clone(lastGood);
      model.projection.generated_at = now();
      model.projection.source_status = "stale";
      model.projection.source_error = sourceError;
      model.projection.revision = hash(`${lastGood.projection.revision}:stale:${sourceError}`);
      return { model, etag: `"${model.projection.revision}"` };
    }
  }

  function resolveSubmap(bindingPath) {
    readSnapshot();
    const segments = String(bindingPath).split("/");
    if (!segments.length || segments.some((segment) => !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(segment))) {
      fail(`invalid submap binding path: ${bindingPath}`);
    }
    let context = latestContext;
    let snapshot = null;
    let binding = null;
    const traversed = [];
    for (const segment of segments) {
      if (!context) fail(`submap context is unavailable: ${traversed.join("/") || "root"}`);
      binding = context.blueprint.submaps.find((item) => item.id === segment);
      traversed.push(segment);
      if (!binding) fail(`unknown submap binding: ${traversed.join("/")}`);
      snapshot = childSnapshot(context.resolvedMap, binding, context.state, {
        bindingPath: traversed.join("/"),
        includeSubmaps: traversed.length === segments.length,
      });
      if (!snapshot.model) fail(snapshot.summary.source_error ?? `submap unavailable: ${traversed.join("/")}`);
      context = snapshot.context;
    }
    return { binding, bindingPath: segments.join("/"), context, segments, snapshot };
  }

  function qualifyHistoricalSubmapBoard(model, bindingPath, binding) {
    model.projection.binding_id = binding.id;
    model.projection.binding_path = bindingPath;
    model.projection.parent_edge = binding.parent_edge;
    model.projection.namespace = bindingPath.replaceAll("/", "::");
    const qualify = (candidate) => ({
      ...candidate,
      path: `${bindingPath}/${candidate.path ?? candidate.id}`,
      history_path: `/api/submaps/${bindingPath}/${candidate.path ?? candidate.id}/evolution`,
    });
    model.submaps = (model.submaps ?? []).map(qualify);
    const qualifiedById = new Map(model.submaps.map((candidate) => [candidate.id, candidate]));
    for (const edge of model.edges ?? []) {
      if (edge.submap && qualifiedById.has(edge.submap.id)) edge.submap = clone(qualifiedById.get(edge.submap.id));
    }
    return model;
  }

  readSnapshot.readSubmap = function readSubmap(bindingPath) {
    const { binding, segments, snapshot } = resolveSubmap(bindingPath);
    snapshot.model.projection.binding_id = binding.id;
    snapshot.model.projection.binding_path = segments.join("/");
    snapshot.model.projection.parent_edge = binding.parent_edge;
    snapshot.model.projection.namespace = segments.join("::");
    return { model: snapshot.model, etag: `"${snapshot.model.projection.revision}"` };
  };

  readSnapshot.readSubmapEvolutionCatalog = function readSubmapEvolutionCatalog(bindingPath) {
    const resolved = resolveSubmap(bindingPath);
    const childReader = evolutionReaderFor(
      resolved.bindingPath,
      resolved.context.resolvedMap,
      resolved.context.resolvedState,
    );
    const result = childReader.readEvolutionCatalog();
    result.model.binding = {
      path: resolved.bindingPath,
      id: resolved.binding.id,
      parent_edge: resolved.binding.parent_edge,
      map_id: resolved.context.blueprint.map_id,
      breadcrumbs: resolved.segments,
    };
    return {
      model: result.model,
      etag: `"${hash(`${resolved.bindingPath}:${result.etag}`)}"`,
    };
  };

  readSnapshot.readSubmapEvolutionFrame = function readSubmapEvolutionFrame(bindingPath, frameId) {
    const resolved = resolveSubmap(bindingPath);
    const childReader = evolutionReaderFor(
      resolved.bindingPath,
      resolved.context.resolvedMap,
      resolved.context.resolvedState,
    );
    const result = childReader.readEvolutionFrame(frameId);
    qualifyHistoricalSubmapBoard(result.model.board, resolved.bindingPath, resolved.binding);
    result.model.binding = {
      path: resolved.bindingPath,
      id: resolved.binding.id,
      parent_edge: resolved.binding.parent_edge,
      map_id: resolved.context.blueprint.map_id,
      breadcrumbs: resolved.segments,
    };
    result.model.stream_heads.binding_path = resolved.bindingPath;
    return {
      model: result.model,
      etag: `"${hash(`${resolved.bindingPath}:${result.etag}`)}"`,
    };
  };

  readSnapshot.readEvolutionCatalog = function readEvolutionCatalog() {
    try {
      const loaded = loadEvolution();
      const frames = loaded.frames.map((frame, index) => publicFrame(frame, index, loaded.frames.length));
      const revision = hash(stableJson({
        wayfinding: loaded.wayfinding.head_digest,
        runtime: loaded.runtimeEvents.at(-1)?.event_digest ?? null,
        count: frames.length,
      }));
      return {
        model: {
          schema: 1,
          recording_status: frames.length ? "current" : "not-recorded",
          coverage: loaded.coverage,
          live_frame: frames.at(-1)?.id ?? null,
          total: frames.length,
          frames,
          submaps: {
            mode: "independent-streams",
            policy: "历史父帧不混入子地图当前态；子图按独立事件流和 receipt revision 组合",
          },
          error: null,
        },
        etag: `"${revision}"`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const revision = hash(`evolution-gap:${message}`);
      return {
        model: {
          schema: 1,
          recording_status: "stale",
          coverage: { complete: false, from: null, reason: message },
          live_frame: null,
          total: 0,
          frames: [],
          submaps: { mode: "independent-streams", policy: "完整性恢复前不提供历史子图" },
          error: message,
        },
        etag: `"${revision}"`,
      };
    }
  };

  readSnapshot.readEvolutionFrame = function readEvolutionFrame(frameId) {
    const loaded = loadEvolution();
    const index = loaded.frames.findIndex((frame) => frame.id === frameId);
    if (index < 0) fail(`unknown evolution frame: ${frameId}`);
    const frame = loaded.frames[index];
    const model = compileEvolutionFrame(frame);
    const previousModel = index > 0 ? compileEvolutionFrame(loaded.frames[index - 1]) : null;
    const diff = evolutionDiff(previousModel, model);
    markEvolutionChanges(model, diff);
    const pinnedChildren = Object.fromEntries((model.submaps ?? [])
      .filter((binding) => binding.receipt_pin)
      .map((binding) => [binding.path, {
        frame: binding.receipt_pin.child_frame,
        digest: binding.receipt_pin.child_revision,
        basis: { kind: "receipt-pin", parent_frame: frame.id, receipt: binding.receipt_pin.parent_receipt },
      }]));
    model.evolution = {
      historical: true,
      frame: frame.id,
      index,
      total: loaded.frames.length,
      coverage: clone(loaded.coverage),
      submaps: {
        mode: "independent-streams",
        historical_expansion: (model.submaps ?? []).some((binding) => binding.historical_expandable),
        reason: "有 receipt pin 时展开精确 child 帧；无回执时只进入子地图独立历史，绝不读取 child 当前态",
      },
    };
    return {
      model: {
        schema: 1,
        frame: publicFrame(frame, index, loaded.frames.length),
        event: {
          type: frame.type,
          at: frame.at,
          actor: frame.actor,
          subject: frame.subject,
          summary: frame.summary,
          reason: frame.reason,
          target: frame.target,
          bridge_from: frame.bridge_from,
        },
        board: model,
        diff,
        stream_heads: {
          root: { segment: frame.segment, seq: frame.seq, digest: frame.digest },
          children: pinnedChildren,
        },
      },
      etag: `"${frame.digest}"`,
    };
  };
  return readSnapshot;
}
