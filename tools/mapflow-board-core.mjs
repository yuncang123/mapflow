import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  STATE_SCHEMA_VERSION,
  deriveSatisfiedNodes,
  edgeReadiness,
  initialFacts,
  predicateSatisfied,
  proveBlueprint,
  readBlueprint,
  validateBlueprint,
} from "./mapflow-core.mjs";

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

function stateFacts(state, blueprint) {
  if (!state) return initialFacts(blueprint);
  return clone(asObject(state.facts, "state.facts"));
}

function validateRuntimeState(state, blueprint) {
  if (!state) return;
  asObject(state, "state");
  if (state.schema !== STATE_SCHEMA_VERSION) fail(`unsupported state schema: ${state.schema}`);
  if (state.map_id !== blueprint.map_id) fail(`state map_id ${state.map_id} does not match ${blueprint.map_id}`);
  asObject(state.facts, "state.facts");
  asArray(state.verified_edges, "state.verified_edges");
  asArray(state.evidence, "state.evidence");
  asArray(state.history, "state.history");
  asObject(state.loop_iterations, "state.loop_iterations");
  if (state.active_edge !== null && typeof state.active_edge !== "string") fail("state.active_edge must be a string or null");
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
    && record.checks?.some((check) => check.result === "pass")
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

function nodeStatus(node, predicateViews, satisfied, arrived) {
  if (arrived && node.kind === "destination") return "arrived";
  if (predicateViews.some((predicate) => predicate.actual === "conflict")) return "conflict";
  if (predicateViews.some((predicate) => predicate.actual === "unknown")) return "fog";
  return satisfied ? "satisfied" : "unsatisfied";
}

function edgeStatus({ edge, activeEdge, verifiedEdges, readiness, proofGaps, proven }) {
  if (activeEdge === edge.id) return "active";
  if (verifiedEdges.has(edge.id)) return "verified";
  if (proofGaps.some((gap) => gap.at_edge === edge.id)) return "blocked";
  if (readiness.ready && proven) return "ready";
  if (readiness.ready) return "candidate";
  return "blocked";
}

function buildTimeline(state) {
  if (!state) return [];
  const history = state.history.map((entry, index) => ({
    id: `history:${index}`,
    kind: "history",
    at: entry.at ?? null,
    label: entry.event ?? "runtime event",
    details: clone(entry),
  }));
  const evidence = state.evidence.map((entry, index) => ({
    id: `evidence:${index}`,
    kind: "evidence",
    at: entry.recorded_at ?? null,
    label: entry.claim ?? `Evidence for ${entry.edge}`,
    edge: entry.edge,
    details: clone(entry),
  }));
  return [...history, ...evidence].sort((left, right) => (
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
}) {
  validateBlueprint(blueprint);
  validateRuntimeState(state, blueprint);
  const facts = stateFacts(state, blueprint);
  const loopIterations = state?.loop_iterations ?? Object.fromEntries(blueprint.loops.map((loop) => [loop.id, 0]));
  const proof = proveBlueprint(blueprint, facts, { loopIterations });
  const satisfiedNodeIds = new Set(deriveSatisfiedNodes(blueprint, facts));
  const verifiedEdges = new Set(state?.verified_edges ?? []);
  const evidence = clone(state?.evidence ?? []);
  const acceptance = blueprint.destination.acceptance.map((item) => acceptanceView(item, evidence));
  const proofGaps = clone(proof.proof_gaps);
  const candidateEdges = new Set(proof.candidate_edges);
  const provenEdges = new Set(proof.proven_edges);
  const actualArrival = state?.phase === "arrived" ? "audited" : "not-audited";
  const predicates = blueprint.predicates.map((predicate) => ({
    ...clone(predicate),
    actual: factValue(facts, predicate.fact) ?? "unknown",
    satisfied: predicateSatisfied(predicate.id, facts, blueprint),
    evidence: factEvidence(facts, predicate.fact),
  }));
  const predicateMap = new Map(predicates.map((predicate) => [predicate.id, predicate]));

  const nodes = blueprint.nodes.map((node) => {
    const nodePredicates = node.predicates.map((predicateId) => clone(predicateMap.get(predicateId)));
    const satisfied = satisfiedNodeIds.has(node.id);
    return {
      ...clone(node),
      satisfied,
      status: nodeStatus(node, nodePredicates, satisfied, actualArrival === "audited"),
      predicates: nodePredicates,
      proof_gaps: proofGaps.filter((gap) => node.predicates.includes(gap.missing)),
    };
  });

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
      }),
      candidate: candidateEdges.has(edge.id),
      proven: provenEdges.has(edge.id),
      ready: readiness.ready,
      missing: clone(readiness.missing),
      brief: brief ? clone(brief) : { ref: edge.brief_ref, metadata: null, content: null },
      applicable_invariants: clone(invariants),
      loops,
      evidence: edgeEvidence,
      acceptance: edgeAcceptance,
      proof_gaps: proofGaps.filter((gap) => gap.at_edge === edge.id),
    };
  });

  const factCounts = { true: 0, false: 0, unknown: 0, conflict: 0 };
  for (const fact of Object.values(facts)) {
    const value = typeof fact === "string" ? fact : fact?.value;
    if (value in factCounts) factCounts[value] += 1;
  }
  const revision = hash(`${digest}:${stateDigest ?? "definition"}:${sourceStatus}:${sourceError ?? ""}`);
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
      destination: clone(blueprint.destination),
      boundaries: clone(blueprint.boundaries),
      phase: state?.phase ?? "wayfinding",
      destination_status: state?.destination_status ?? "draft",
      actual_arrival: actualArrival,
    },
    summary: {
      structural: proof.structural,
      reachability: proof.reachability,
      nodes: nodes.length,
      satisfied_nodes: nodes.filter((node) => node.satisfied).length,
      edges: edges.length,
      verified_edges: edges.filter((edge) => edge.status === "verified").length,
      active_edge: state?.active_edge ?? null,
      proof_gaps: proofGaps.length,
      acceptance_passed: acceptance.filter((item) => item.status === "passed").length,
      acceptance_total: acceptance.length,
      facts: factCounts,
    },
    proof: clone(proof),
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
    timeline: buildTimeline(state),
  };
}

function readRuntimeState(statePath) {
  if (!statePath || !fs.existsSync(statePath)) return { state: null, digest: null };
  const content = fs.readFileSync(statePath, "utf8");
  try {
    return { state: JSON.parse(content), digest: hash(content) };
  } catch (error) {
    fail(`invalid runtime state: ${statePath}: ${error.message}`);
  }
}

function stateMapPath(statePath, state) {
  if (!statePath || !state?.map) return null;
  return path.resolve(path.dirname(path.resolve(statePath)), state.map);
}

export function createBoardSnapshotReader({ mapPath = null, statePath = null } = {}) {
  let lastGood = null;
  let lastBriefs = {};
  let runtimeWasPresent = false;

  return function readSnapshot() {
    try {
      const stateResult = readRuntimeState(statePath);
      if (stateResult.state) runtimeWasPresent = true;
      if (runtimeWasPresent && !stateResult.state) fail(`runtime state disappeared: ${statePath}`);
      const resolvedMap = mapPath
        ? path.resolve(mapPath)
        : stateMapPath(statePath, stateResult.state);
      if (!resolvedMap) fail("board requires --map when runtime state is absent");

      let loaded;
      let loadError = null;
      try {
        loaded = readBlueprint(resolvedMap);
      } catch (error) {
        loadError = error;
      }

      const state = stateResult.state;
      const registeredMismatch = state && loaded && loaded.digest !== state.map_digest;
      if ((loadError || registeredMismatch) && state?.blueprint_snapshot) {
        const snapshot = validateBlueprint(clone(state.blueprint_snapshot));
        const sourceError = loadError
          ? `current Blueprint is invalid: ${loadError.message}`
          : "Blueprint or bound Task Brief has unregistered changes";
        const model = compileBoardModel({
          blueprint: snapshot,
          digest: state.map_digest,
          briefs: lastBriefs,
          state,
          stateDigest: stateResult.digest,
          sourceStatus: "stale",
          sourceError,
        });
        lastGood = model;
        return { model, etag: `"${model.projection.revision}"` };
      }
      if (loadError) throw loadError;

      const model = compileBoardModel({
        blueprint: loaded.blueprint,
        digest: loaded.digest,
        briefs: loaded.briefs,
        state,
        stateDigest: stateResult.digest,
      });
      lastBriefs = loaded.briefs;
      lastGood = model;
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
  };
}
