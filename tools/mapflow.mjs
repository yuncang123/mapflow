#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  ModelError,
  STATE_SCHEMA_VERSION,
  TRUTH_VALUES,
  deriveSatisfiedNodes,
  edgeReadiness,
  initialFacts,
  predicateSatisfied,
  proveBlueprint,
  readBlueprint,
} from "./mapflow-core.mjs";

const DEFAULT_STATE = path.join(".mapflow", "state.json");
const PHASES = new Set(["wayfinding", "implementation", "arrived"]);
const DESTINATION_STATES = new Set(["draft", "approved", "changed"]);
const EVIDENCE_KINDS = new Set(["git", "document", "command", "receipt", "meeting", "note", "observation", "external"]);

class CliError extends Error {}

function fail(message) {
  throw new CliError(message);
}
function now() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function required(options, name) {
  const value = options.get(name);
  if (typeof value !== "string" || value.trim() === "") fail(`${name} is required`);
  return value;
}

function csv(options, name) {
  const value = options.get(name);
  if (value === undefined || value === true) return [];
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function outcomeRefs(options) {
  return csv(options, "outcome-ref").map((entry) => {
    const separator = entry.indexOf(":");
    if (separator < 1 || separator === entry.length - 1) fail(`invalid outcome-ref: ${entry}; use kind:ref`);
    const kind = entry.slice(0, separator);
    const ref = entry.slice(separator + 1);
    if (!EVIDENCE_KINDS.has(kind)) fail(`invalid outcome-ref kind: ${kind}`);
    return { kind, ref };
  });
}

function parseOptions(values) {
  const options = new Map();
  for (let index = 0; index < values.length; index += 1) {
    const token = values[index];
    if (!token.startsWith("--")) fail(`unexpected argument: ${token}`);
    const name = token.slice(2);
    if (name === "force" || name === "json") {
      options.set(name, true);
      continue;
    }
    const value = values[index + 1];
    if (!value || value.startsWith("--")) fail(`value is required for --${name}`);
    options.set(name, value);
    index += 1;
  }
  return options;
}

function validateEvidenceRef(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  if (typeof value.kind !== "string" || typeof value.ref !== "string") fail(`${label} must include kind and ref`);
  if (!EVIDENCE_KINDS.has(value.kind)) fail(`${label} has invalid kind: ${value.kind}`);
}

function validateState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) fail("state root must be a JSON object");
  if (state.schema !== STATE_SCHEMA_VERSION) {
    const suffix = state.schema === 1 ? "; v0.2 node state is archived and must be re-initialized" : "";
    fail(`unsupported state schema: ${state.schema}${suffix}`);
  }
  const requiredFields = [
    "schema", "phase", "destination_status", "map", "map_digest", "map_id", "active_edge",
    "verified_edges", "verified_edge_contracts", "blueprint_snapshot", "facts", "satisfied_nodes",
    "brief_digests", "loop_iterations", "last_proof", "evidence", "updated_at", "history",
  ];
  const missing = requiredFields.filter((field) => !(field in state));
  if (missing.length > 0) fail(`state missing fields: ${missing.join(", ")}`);
  if (!PHASES.has(state.phase)) fail(`invalid phase: ${state.phase}`);
  if (!DESTINATION_STATES.has(state.destination_status)) fail(`invalid destination_status: ${state.destination_status}`);
  if (typeof state.map !== "string" || state.map.trim() === "") fail("map must be a non-empty string");
  if (typeof state.map_digest !== "string" || state.map_digest.trim() === "") fail("map_digest must be a non-empty string");
  if (typeof state.map_id !== "string" || state.map_id.trim() === "") fail("map_id must be a non-empty string");
  if (state.active_edge !== null && typeof state.active_edge !== "string") fail("active_edge must be a string or null");
  for (const field of ["verified_edges", "satisfied_nodes", "evidence", "history"]) {
    if (!Array.isArray(state[field])) fail(`${field} must be a list`);
  }
  if (!state.verified_edge_contracts || typeof state.verified_edge_contracts !== "object" || Array.isArray(state.verified_edge_contracts)) {
    fail("verified_edge_contracts must be an object");
  }
  if (!state.blueprint_snapshot || typeof state.blueprint_snapshot !== "object" || Array.isArray(state.blueprint_snapshot)) {
    fail("blueprint_snapshot must be an object");
  }
  if (!state.brief_digests || typeof state.brief_digests !== "object" || Array.isArray(state.brief_digests)) {
    fail("brief_digests must be an object");
  }
  if (!state.loop_iterations || typeof state.loop_iterations !== "object" || Array.isArray(state.loop_iterations)) {
    fail("loop_iterations must be an object");
  }
  for (const [loopId, count] of Object.entries(state.loop_iterations)) {
    if (!Number.isInteger(count) || count < 0) fail(`loop ${loopId} has invalid iteration count: ${count}`);
  }
  if (!state.facts || typeof state.facts !== "object" || Array.isArray(state.facts)) fail("facts must be an object");
  for (const [factId, fact] of Object.entries(state.facts)) {
    if (!fact || typeof fact !== "object" || !TRUTH_VALUES.has(fact.value) || !Array.isArray(fact.evidence)) {
      fail(`fact ${factId} has invalid runtime shape`);
    }
    fact.evidence.forEach((entry, index) => validateEvidenceRef(entry, `fact ${factId}.evidence[${index}]`));
  }
}

function loadState(statePath) {
  if (!fs.existsSync(statePath)) fail(`state file not found: ${statePath}`);
  let state;
  try {
    state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) fail(`invalid state JSON: ${statePath}: ${error.message}`);
    throw error;
  }
  validateState(state);
  return state;
}

function saveState(statePath, state) {
  validateState(state);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const temporary = `${statePath}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, statePath);
}

function record(state, event, details = {}) {
  state.updated_at = now();
  state.history.push({ at: state.updated_at, event, ...details });
}

function mapPathForState(statePath, absoluteMapPath) {
  return path.relative(path.dirname(path.resolve(statePath)), absoluteMapPath).replaceAll("\\", "/") || ".";
}

function resolveStateMap(statePath, state) {
  return path.resolve(path.dirname(path.resolve(statePath)), state.map);
}

function readStateBlueprint(statePath, state) {
  const absolute = resolveStateMap(statePath, state);
  const loaded = readBlueprint(absolute);
  if (loaded.blueprint.map_id !== state.map_id) {
    fail(`map identity changed from ${state.map_id} to ${loaded.blueprint.map_id}; use replan`);
  }
  return { ...loaded, absolute };
}

function assertMapUnchanged(statePath, state, digest) {
  if (digest !== state.map_digest) fail(`Blueprint or bound Task Brief changed after approval: ${resolveStateMap(statePath, state)}; use replan`);
}

function refreshDerivedState(state, blueprint) {
  state.loop_iterations = Object.fromEntries(blueprint.loops.map((loop) => [
    loop.id,
    state.loop_iterations?.[loop.id] ?? 0,
  ]));
  state.satisfied_nodes = deriveSatisfiedNodes(blueprint, state.facts);
  state.last_proof = proveBlueprint(blueprint, state.facts, { loopIterations: state.loop_iterations });
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function frozenEdgeContract(blueprint, briefDigests, edgeId) {
  const edge = blueprint.edges.find((item) => item.id === edgeId);
  if (!edge) return null;
  const nodes = [edge.from, edge.to]
    .map((nodeId) => blueprint.nodes.find((item) => item.id === nodeId))
    .filter(Boolean)
    .sort((left, right) => left.id.localeCompare(right.id));
  const applicableInvariantIds = new Set(edge.invariants);
  for (const invariantId of blueprint.destination.invariants) {
    const invariant = blueprint.invariants.find((item) => item.id === invariantId);
    if (invariant?.applies_to.includes(edgeId)) applicableInvariantIds.add(invariantId);
  }
  const invariants = [...applicableInvariantIds]
    .map((invariantId) => blueprint.invariants.find((item) => item.id === invariantId))
    .filter(Boolean)
    .sort((left, right) => left.id.localeCompare(right.id));
  const loops = loopsForEdge(blueprint, edgeId)
    .slice()
    .sort((left, right) => left.id.localeCompare(right.id));
  const predicateIds = new Set([
    ...nodes.flatMap((node) => node.predicates),
    ...edge.preconditions,
    ...edge.effects,
    ...invariants.flatMap((invariant) => invariant.requires),
    ...loops.flatMap((loop) => [loop.progress_predicate, loop.exit_predicate]),
  ]);
  const predicates = [...predicateIds]
    .map((predicateId) => blueprint.predicates.find((item) => item.id === predicateId))
    .filter(Boolean)
    .sort((left, right) => left.id.localeCompare(right.id));
  return {
    edge: structuredClone(edge),
    nodes: structuredClone(nodes),
    predicates: structuredClone(predicates),
    invariants: structuredClone(invariants),
    loops: structuredClone(loops),
    brief_digest: briefDigests[edgeId],
  };
}

function assertVerifiedEdgesPreserved(state, blueprint, briefDigests) {
  for (const edgeId of state.verified_edges) {
    const expected = state.verified_edge_contracts[edgeId];
    const actual = frozenEdgeContract(blueprint, briefDigests, edgeId);
    if (!expected || !actual || stableJson(expected) !== stableJson(actual)) {
      fail(`verified edge contract cannot be removed or redefined: ${edgeId}`);
    }
  }
}

function changedBlueprintRefs(previous, next, previousBriefDigests = {}, nextBriefDigests = {}) {
  const refs = [];
  const collections = ["predicates", "assumptions", "invariants", "nodes", "edges", "loops"];
  for (const collection of collections) {
    const before = new Map(previous[collection].map((item) => [item.id, item]));
    const after = new Map(next[collection].map((item) => [item.id, item]));
    for (const id of new Set([...before.keys(), ...after.keys()])) {
      if (stableJson(before.get(id)) !== stableJson(after.get(id))) {
        refs.push(`${collection.replace(/s$/, "")}:${id}`);
      }
    }
  }
  if (previous.destination.statement !== next.destination.statement) refs.push("destination:statement");
  for (const predicateId of new Set([...previous.destination.requires, ...next.destination.requires])) {
    if (previous.destination.requires.includes(predicateId) !== next.destination.requires.includes(predicateId)) {
      refs.push(`destination:predicate:${predicateId}`);
    }
  }
  for (const invariantId of new Set([...previous.destination.invariants, ...next.destination.invariants])) {
    if (previous.destination.invariants.includes(invariantId) !== next.destination.invariants.includes(invariantId)) {
      refs.push(`destination:invariant:${invariantId}`);
    }
  }
  for (const collection of ["acceptance"]) {
    const before = new Map(previous.destination[collection].map((item) => [item.id, item]));
    const after = new Map(next.destination[collection].map((item) => [item.id, item]));
    for (const id of new Set([...before.keys(), ...after.keys()])) {
      if (stableJson(before.get(id)) !== stableJson(after.get(id))) refs.push(`acceptance:${id}`);
    }
  }
  const previousFacts = new Map(previous.initial_state.facts.map((fact) => [fact.id, fact]));
  const nextFacts = new Map(next.initial_state.facts.map((fact) => [fact.id, fact]));
  for (const factId of new Set([...previousFacts.keys(), ...nextFacts.keys()])) {
    if (stableJson(previousFacts.get(factId)) !== stableJson(nextFacts.get(factId))) refs.push(`fact:${factId}`);
  }
  for (const boundary of ["in_scope", "out_of_scope", "authorization"]) {
    if (stableJson(previous.boundaries[boundary]) !== stableJson(next.boundaries[boundary])) {
      refs.push(`boundary:${boundary.replaceAll("_", "-")}`);
    }
  }
  const previousExtensions = previous.extensions ?? {};
  const nextExtensions = next.extensions ?? {};
  for (const key of new Set([...Object.keys(previousExtensions), ...Object.keys(nextExtensions)])) {
    if (stableJson(previousExtensions[key]) !== stableJson(nextExtensions[key])) refs.push(`extension:${key}`);
  }
  for (const edgeId of new Set([...Object.keys(previousBriefDigests), ...Object.keys(nextBriefDigests)])) {
    if (previousBriefDigests[edgeId] !== nextBriefDigests[edgeId]) refs.push(`brief:${edgeId}`);
  }
  return refs.sort();
}

function assertChangesWithinScope(scope, changedRefs, previous, next) {
  if (changedRefs.length === 0) return;
  const [kind, ...parts] = scope.split(":");
  const allowed = new Set();
  const versions = [previous, next];
  const addPredicateNeighborhood = (predicateId) => {
    allowed.add(`predicate:${predicateId}`);
    for (const blueprint of versions) {
      const predicate = blueprint.predicates.find((item) => item.id === predicateId);
      if (predicate) allowed.add(`fact:${predicate.fact}`);
      if (blueprint.destination.requires.includes(predicateId)) allowed.add(`destination:predicate:${predicateId}`);
      for (const acceptance of blueprint.destination.acceptance) {
        if (acceptance.proves.includes(predicateId)) allowed.add(`acceptance:${acceptance.id}`);
      }
      for (const assumption of blueprint.assumptions) {
        if (assumption.predicate === predicateId) allowed.add(`assumption:${assumption.id}`);
      }
      for (const invariant of blueprint.invariants) {
        if (invariant.requires.includes(predicateId)) {
          allowed.add(`invariant:${invariant.id}`);
          if (blueprint.destination.invariants.includes(invariant.id)) allowed.add(`destination:invariant:${invariant.id}`);
        }
      }
      for (const node of blueprint.nodes) {
        if (node.predicates.includes(predicateId)) allowed.add(`node:${node.id}`);
      }
      for (const edge of blueprint.edges) {
        if ([...edge.preconditions, ...edge.effects].includes(predicateId)) {
          allowed.add(`edge:${edge.id}`);
          allowed.add(`brief:${edge.id}`);
        }
      }
    }
  };
  const addEdgeNeighborhood = (edgeId) => {
    allowed.add(`edge:${edgeId}`);
    allowed.add(`brief:${edgeId}`);
    for (const blueprint of versions) {
      const edge = blueprint.edges.find((item) => item.id === edgeId);
      if (!edge) continue;
      allowed.add(`node:${edge.from}`);
      allowed.add(`node:${edge.to}`);
      for (const invariantId of edge.invariants) allowed.add(`invariant:${invariantId}`);
      for (const loop of blueprint.loops) {
        if (loop.edges.includes(edgeId)) allowed.add(`loop:${loop.id}`);
      }
      for (const predicateId of [...edge.preconditions, ...edge.effects]) addPredicateNeighborhood(predicateId);
    }
  };
  const pathMembers = (blueprint, from, to) => {
    const forward = new Map();
    const reverse = new Map();
    for (const edge of blueprint.edges) {
      if (!forward.has(edge.from)) forward.set(edge.from, []);
      if (!reverse.has(edge.to)) reverse.set(edge.to, []);
      forward.get(edge.from).push(edge.to);
      reverse.get(edge.to).push(edge.from);
    }
    const visit = (start, adjacency) => {
      const seen = new Set([start]);
      const queue = [start];
      while (queue.length > 0) {
        for (const nextId of adjacency.get(queue.shift()) ?? []) {
          if (!seen.has(nextId)) {
            seen.add(nextId);
            queue.push(nextId);
          }
        }
      }
      return seen;
    };
    const reachableFrom = visit(from, forward);
    const reachesTo = visit(to, reverse);
    return new Set([...reachableFrom].filter((nodeId) => reachesTo.has(nodeId)));
  };
  const addSubgraph = (from, to, includeReturn) => {
    for (const blueprint of versions) {
      const nodes = pathMembers(blueprint, from, to);
      if (includeReturn) {
        for (const nodeId of pathMembers(blueprint, to, from)) nodes.add(nodeId);
      }
      nodes.add(from);
      nodes.add(to);
      for (const nodeId of nodes) allowed.add(`node:${nodeId}`);
      for (const edge of blueprint.edges) {
        if (nodes.has(edge.from) && nodes.has(edge.to)) addEdgeNeighborhood(edge.id);
      }
    }
  };

  if (kind === "edge") addEdgeNeighborhood(parts[0]);
  else if (kind === "predicate") addPredicateNeighborhood(parts[0]);
  else if (kind === "between") parts.forEach(addEdgeNeighborhood);
  else if (kind === "subgraph") addSubgraph(parts[0], parts[1], false);
  else if (kind === "cycle") addSubgraph(parts[0], parts[1], true);
  else if (kind === "observation") {
    for (const blueprint of versions) {
      for (const predicate of blueprint.predicates) {
        allowed.add(`predicate:${predicate.id}`);
        allowed.add(`fact:${predicate.fact}`);
      }
      for (const assumption of blueprint.assumptions) allowed.add(`assumption:${assumption.id}`);
    }
  } else if (kind === "destination") {
    allowed.add("destination:statement");
    for (const blueprint of versions) {
      for (const predicateId of blueprint.destination.requires) {
        allowed.add(`destination:predicate:${predicateId}`);
        addPredicateNeighborhood(predicateId);
      }
      for (const invariantId of blueprint.destination.invariants) {
        allowed.add(`destination:invariant:${invariantId}`);
        allowed.add(`invariant:${invariantId}`);
      }
      for (const acceptance of blueprint.destination.acceptance) allowed.add(`acceptance:${acceptance.id}`);
    }
  } else if (kind === "boundary") {
    allowed.add(`boundary:${parts[0]}`);
  }

  const outside = changedRefs.filter((ref) => !allowed.has(ref));
  if (outside.length > 0) {
    fail(`replan changes fall outside repair scope ${scope}: ${outside.join(",")}`);
  }
}

function loopsForEdge(blueprint, edgeId) {
  return blueprint.loops.filter((loop) => loop.edges.includes(edgeId));
}

function assertLoopMayExecute(blueprint, state, edgeId) {
  for (const loop of loopsForEdge(blueprint, edgeId)) {
    if (predicateSatisfied(loop.exit_predicate, state.facts, blueprint)) {
      fail(`loop ${loop.id} already satisfies exit predicate: ${loop.exit_predicate}`);
    }
    const count = state.loop_iterations[loop.id] ?? 0;
    if (count >= loop.max_iterations) {
      fail(`loop budget exhausted: ${loop.id} (${count}/${loop.max_iterations})`);
    }
  }
}

function printHelp() {
  process.stdout.write("usage: mapflow [--state STATE] <command> [options]\n\n");
  process.stdout.write("Evidence-driven state-node/work-edge map runtime\n\n");
  process.stdout.write("commands:\n");
  process.stdout.write("  validate   validate a Blueprint definition\n");
  process.stdout.write("  init       initialize runtime state from a Blueprint\n");
  process.stdout.write("  status     show the current runtime projection\n");
  process.stdout.write("  prove      run backward closure and forward reachability proof\n");
  process.stdout.write("  approve    approve the destination and activate one ready edge\n");
  process.stdout.write("  select     activate the next ready edge\n");
  process.stdout.write("  gate       check whether the active edge may execute\n");
  process.stdout.write("  verify     record evidence and apply proven edge effects\n");
  process.stdout.write("  replan     preserve evidence and return to wayfinding\n");
  process.stdout.write("  arrive     audit actual destination predicates and acceptance evidence\n");
  process.stdout.write("  board      serve a read-only dynamic map (--map MAP, --port PORT)\n");
}

function commandValidate(options) {
  const mapPath = path.resolve(process.cwd(), required(options, "map"));
  const { blueprint, digest } = readBlueprint(mapPath);
  const summary = {
    map_id: blueprint.map_id,
    schema_version: blueprint.schema_version,
    nodes: blueprint.nodes.length,
    edges: blueprint.edges.length,
    digest,
  };
  process.stdout.write(options.has("json") ? `${JSON.stringify(summary, null, 2)}\n` : `valid blueprint: ${blueprint.map_id} (${blueprint.nodes.length} nodes, ${blueprint.edges.length} edges)\n`);
}

function commandInit(statePath, options) {
  if (fs.existsSync(statePath) && !options.has("force")) fail(`state already exists: ${statePath} (use --force to replace)`);
  const absoluteMap = path.resolve(process.cwd(), required(options, "map"));
  const { blueprint, digest, brief_digests: briefDigests } = readBlueprint(absoluteMap);
  const state = {
    schema: STATE_SCHEMA_VERSION,
    phase: "wayfinding",
    destination_status: "draft",
    map: mapPathForState(statePath, absoluteMap),
    map_digest: digest,
    map_id: blueprint.map_id,
    active_edge: null,
    verified_edges: [],
    verified_edge_contracts: {},
    blueprint_snapshot: structuredClone(blueprint),
    brief_digests: { ...briefDigests },
    loop_iterations: Object.fromEntries(blueprint.loops.map((loop) => [loop.id, 0])),
    facts: initialFacts(blueprint),
    satisfied_nodes: [],
    last_proof: null,
    evidence: [],
    updated_at: now(),
    history: [],
  };
  refreshDerivedState(state, blueprint);
  record(state, "initialized", { structural: state.last_proof.structural, reachability: state.last_proof.reachability });
  saveState(statePath, state);
  process.stdout.write(`initialized ${statePath} from ${blueprint.map_id}\n`);
}

function commandStatus(statePath, options) {
  const state = loadState(statePath);
  const { blueprint, digest } = readStateBlueprint(statePath, state);
  const projectionBlueprint = digest === state.map_digest ? blueprint : state.blueprint_snapshot;
  const projection = {
    ...state,
    map_changed: digest !== state.map_digest,
    actual_arrival: state.phase === "arrived" ? "audited" : "not-audited",
    satisfied_nodes: deriveSatisfiedNodes(projectionBlueprint, state.facts),
  };
  if (options.has("json")) {
    process.stdout.write(`${JSON.stringify(projection, null, 2)}\n`);
    return;
  }
  process.stdout.write(`phase: ${projection.phase}\n`);
  process.stdout.write(`destination: ${projection.destination_status}\n`);
  process.stdout.write(`map: ${projection.map_id}${projection.map_changed ? " (changed)" : ""}\n`);
  process.stdout.write(`proof: ${projection.last_proof.structural}/${projection.last_proof.reachability}\n`);
  process.stdout.write(`actual_arrival: ${projection.actual_arrival}\n`);
  process.stdout.write(`active_edge: ${projection.active_edge ?? "-"}\n`);
  process.stdout.write(`verified_edges: ${projection.verified_edges.join(", ") || "-"}\n`);
  process.stdout.write(`satisfied_nodes: ${projection.satisfied_nodes.join(", ") || "-"}\n`);
  process.stdout.write(`evidence_records: ${projection.evidence.length}\n`);
}

function commandProve(statePath, options) {
  if (options.has("map")) {
    const absoluteMap = path.resolve(process.cwd(), required(options, "map"));
    const { blueprint } = readBlueprint(absoluteMap);
    const proof = proveBlueprint(blueprint);
    process.stdout.write(options.has("json") ? `${JSON.stringify(proof, null, 2)}\n` : `proof: ${proof.structural}/${proof.reachability}; gaps: ${proof.proof_gaps.length}\n`);
    return;
  }
  const state = loadState(statePath);
  if (state.phase === "arrived") fail("cannot refresh proof for an arrived map; start a new map");
  const { blueprint, digest, brief_digests: briefDigests } = readStateBlueprint(statePath, state);
  assertMapUnchanged(statePath, state, digest);
  assertVerifiedEdgesPreserved(state, blueprint, briefDigests);
  refreshDerivedState(state, blueprint);
  record(state, "reachability_proved", { structural: state.last_proof.structural, reachability: state.last_proof.reachability, gaps: state.last_proof.proof_gaps.length });
  saveState(statePath, state);
  process.stdout.write(options.has("json") ? `${JSON.stringify(state.last_proof, null, 2)}\n` : `proof: ${state.last_proof.structural}/${state.last_proof.reachability}; gaps: ${state.last_proof.proof_gaps.length}\n`);
}

function ensureApprovableProof(state) {
  if (state.last_proof.structural !== "complete") fail("approval requires a structurally complete map");
  if (state.last_proof.reachability === "unreachable") fail("approval requires a logical or conditional route");
}

function ensureReadyEdge(blueprint, state, edgeId) {
  assertLoopMayExecute(blueprint, state, edgeId);
  if (!state.last_proof.proven_edges.includes(edgeId)) fail(`edge is not on a destination-reaching route in the current proof: ${edgeId}`);
  const readiness = edgeReadiness(blueprint, state.facts, edgeId);
  if (!readiness.ready) {
    const missing = readiness.missing.map((item) => `${item.kind}:${item.predicate}`).join(", ");
    fail(`edge is not ready: ${edgeId}; missing ${missing}`);
  }
  return readiness.edge;
}

function commandApprove(statePath, options) {
  const state = loadState(statePath);
  if (state.phase !== "wayfinding" || !new Set(["draft", "changed"]).has(state.destination_status)) {
    fail("approve requires wayfinding phase and a draft/changed destination");
  }
  const { blueprint, digest, brief_digests: briefDigests } = readStateBlueprint(statePath, state);
  assertMapUnchanged(statePath, state, digest);
  assertVerifiedEdgesPreserved(state, blueprint, briefDigests);
  refreshDerivedState(state, blueprint);
  ensureApprovableProof(state);
  const edgeId = required(options, "edge");
  if (state.verified_edges.includes(edgeId) && loopsForEdge(blueprint, edgeId).length === 0) {
    fail(`edge already verified: ${edgeId}`);
  }
  ensureReadyEdge(blueprint, state, edgeId);
  state.phase = "implementation";
  state.destination_status = "approved";
  state.active_edge = edgeId;
  record(state, "destination_approved", { edge: edgeId });
  saveState(statePath, state);
  process.stdout.write(`approved destination; active edge: ${edgeId}\n`);
}

function commandSelect(statePath, options) {
  const state = loadState(statePath);
  if (state.phase !== "implementation" || state.destination_status !== "approved") {
    fail("select requires an approved destination in implementation phase");
  }
  if (state.active_edge !== null) fail(`active edge is still running: ${state.active_edge}`);
  const { blueprint, digest } = readStateBlueprint(statePath, state);
  assertMapUnchanged(statePath, state, digest);
  const edgeId = required(options, "edge");
  if (state.verified_edges.includes(edgeId) && loopsForEdge(blueprint, edgeId).length === 0) {
    fail(`edge already verified: ${edgeId}`);
  }
  ensureReadyEdge(blueprint, state, edgeId);
  state.active_edge = edgeId;
  record(state, "edge_selected", { edge: edgeId });
  saveState(statePath, state);
  process.stdout.write(`selected edge: ${edgeId}\n`);
}

function commandGate(statePath) {
  const state = loadState(statePath);
  if (state.phase !== "implementation" || state.destination_status !== "approved" || state.active_edge === null) {
    process.stderr.write("write gate blocked: approve a destination and select one active edge\n");
    return 1;
  }
  const { blueprint, digest } = readStateBlueprint(statePath, state);
  assertMapUnchanged(statePath, state, digest);
  ensureReadyEdge(blueprint, state, state.active_edge);
  process.stdout.write(`write gate passed for edge: ${state.active_edge}\n`);
  return 0;
}

function commandVerify(statePath, options) {
  const state = loadState(statePath);
  if (state.phase !== "implementation" || state.destination_status !== "approved") {
    fail("verify requires an approved destination in implementation phase");
  }
  const edgeId = required(options, "edge");
  if (state.active_edge !== edgeId) fail(`verify must name active edge ${JSON.stringify(state.active_edge)}`);
  const { blueprint, digest, brief_digests: briefDigests } = readStateBlueprint(statePath, state);
  assertMapUnchanged(statePath, state, digest);
  const edge = ensureReadyEdge(blueprint, state, edgeId);
  const claim = required(options, "evidence");
  const command = required(options, "command");
  const observed = required(options, "observed");
  const executor = required(options, "executor");
  const actualModel = options.get("model");
  const actualReasoning = options.get("reasoning");
  if ((actualModel === undefined) !== (actualReasoning === undefined)) {
    fail("model and reasoning must be provided together");
  }
  if (executor.startsWith("agent:") && actualModel === undefined) {
    fail("agent executor requires model and reasoning");
  }
  const proves = csv(options, "proves");
  if (proves.length === 0) fail("proves is required");
  const unknownProves = proves.filter((predicateId) => !edge.effects.includes(predicateId));
  if (unknownProves.length > 0) fail(`evidence claims predicates outside edge effects: ${unknownProves.join(", ")}`);
  const requiredProofs = new Set(edge.evidence_contract.filter((contract) => contract.required).flatMap((contract) => contract.proves));
  const missingProofs = [...requiredProofs].filter((predicateId) => !proves.includes(predicateId));
  if (missingProofs.length > 0) fail(`required evidence predicates are missing: ${missingProofs.join(", ")}`);

  const acceptanceIds = csv(options, "acceptance");
  const acceptanceMap = new Map(blueprint.destination.acceptance.map((item) => [item.id, item]));
  for (const acceptanceId of acceptanceIds) {
    const acceptance = acceptanceMap.get(acceptanceId);
    if (!acceptance) fail(`unknown acceptance id: ${acceptanceId}`);
    if (!acceptance.proves.some((predicateId) => proves.includes(predicateId))) {
      fail(`edge evidence does not contribute to acceptance: ${acceptanceId}`);
    }
  }

  const result = options.get("result") ?? "pass";
  if (!new Set(["pass", "fail", "blocked", "skipped"]).has(result)) fail(`invalid verification result: ${result}`);
  const limits = {
    simulated: csv(options, "simulated"),
    inferred: csv(options, "inferred"),
    unverified: csv(options, "unverified"),
    product_unknowns: csv(options, "product-unknown"),
  };
  const realizedBy = outcomeRefs(options);
  const recordedAt = now();
  const evidence = {
    edge: edgeId,
    claim,
    proves,
    acceptance_ids: acceptanceIds,
    outcome_refs: realizedBy,
    checks: [{ command, result, observed }],
    limits,
    executor,
    ...(actualModel === undefined ? {} : { agent: { model: actualModel, reasoning: actualReasoning } }),
    recorded_at: recordedAt,
  };
  state.evidence.push(evidence);
  if (result !== "pass" || limits.unverified.length > 0) {
    record(state, "edge_verification_incomplete", { edge: edgeId, result, unverified: limits.unverified });
    saveState(statePath, state);
    fail(result === "pass" ? `edge verification has unverified limits: ${edgeId}` : `edge verification did not pass: ${edgeId}`);
  }

  const predicateMap = new Map(blueprint.predicates.map((predicate) => [predicate.id, predicate]));
  for (const predicateId of proves) {
    const predicate = predicateMap.get(predicateId);
    const previousEvidence = state.facts[predicate.fact]?.evidence ?? [];
    state.facts[predicate.fact] = {
      value: predicate.equals,
      evidence: [
        ...previousEvidence,
        { kind: "command", ref: `${command} -> ${observed}`, observed_at: recordedAt },
        ...realizedBy.map((entry) => ({ ...entry, observed_at: recordedAt })),
      ],
    };
  }
  if (!state.verified_edges.includes(edgeId)) state.verified_edges.push(edgeId);
  state.verified_edge_contracts[edgeId] = frozenEdgeContract(blueprint, briefDigests, edgeId);
  for (const loop of loopsForEdge(blueprint, edgeId)) state.loop_iterations[loop.id] += 1;
  state.active_edge = null;
  refreshDerivedState(state, blueprint);
  record(state, "edge_verified", { edge: edgeId, proves, acceptance: acceptanceIds });
  saveState(statePath, state);
  process.stdout.write(`verified edge: ${edgeId}; satisfied nodes: ${state.satisfied_nodes.join(", ") || "-"}\n`);
}

function commandReplan(statePath, options) {
  const state = loadState(statePath);
  if (state.phase === "arrived") fail("cannot replan an arrived map; start a new map");
  const reason = required(options, "reason");
  const scope = required(options, "scope");
  if (!/^(?:predicate|edge|between|cycle|subgraph|observation|destination|boundary):[a-z0-9][a-z0-9:-]*$/.test(scope)) {
    fail("scope must be a proof-gap repair_scope or observation:<semantic-slug>");
  }
  const absoluteMap = options.has("map")
    ? path.resolve(process.cwd(), required(options, "map"))
    : resolveStateMap(statePath, state);
  const { blueprint, digest, brief_digests: briefDigests } = readBlueprint(absoluteMap);
  if (blueprint.map_id !== state.map_id) fail(`replan cannot change map identity from ${state.map_id} to ${blueprint.map_id}; initialize a new map`);
  assertVerifiedEdgesPreserved(state, blueprint, briefDigests);
  const changedRefs = changedBlueprintRefs(state.blueprint_snapshot, blueprint, state.brief_digests, briefDigests);
  const changesOption = required(options, "changes");
  const declaredChanges = changesOption === "none" ? [] : csv(options, "changes").sort();
  if (declaredChanges.includes("none")) fail("changes must be 'none' or a comma-separated entity list");
  if (stableJson(changedRefs) !== stableJson([...new Set(declaredChanges)])) {
    fail(`replan change set mismatch (actual: ${changedRefs.join(",") || "-"}; declared: ${declaredChanges.join(",") || "-"})`);
  }
  assertChangesWithinScope(scope, changedRefs, state.blueprint_snapshot, blueprint);
  state.phase = "wayfinding";
  state.destination_status = "changed";
  state.map = mapPathForState(statePath, absoluteMap);
  state.map_id = blueprint.map_id;
  state.map_digest = digest;
  state.blueprint_snapshot = structuredClone(blueprint);
  state.brief_digests = { ...briefDigests };
  state.active_edge = null;
  refreshDerivedState(state, blueprint);
  record(state, "replan_requested", { reason, scope, changed_refs: changedRefs, preserved_edges: [...state.verified_edges] });
  saveState(statePath, state);
  process.stdout.write(`returned to wayfinding; evidence preserved; proof: ${state.last_proof.structural}/${state.last_proof.reachability}\n`);
}

function commandArrive(statePath, options) {
  const state = loadState(statePath);
  if (state.phase !== "implementation" || state.destination_status !== "approved") {
    fail("arrive requires an approved destination in implementation phase");
  }
  if (state.active_edge !== null) fail(`cannot arrive while edge is active: ${state.active_edge}`);
  const { blueprint, digest } = readStateBlueprint(statePath, state);
  assertMapUnchanged(statePath, state, digest);
  const missingDestination = blueprint.destination.requires.filter((predicateId) => !predicateSatisfied(predicateId, state.facts, blueprint));
  if (missingDestination.length > 0) fail(`cannot arrive; destination predicates are not observed: ${missingDestination.join(", ")}`);
  const invariantMap = new Map(blueprint.invariants.map((invariant) => [invariant.id, invariant]));
  const missingInvariants = blueprint.destination.invariants.flatMap((invariantId) => (
    invariantMap.get(invariantId).requires.filter((predicateId) => !predicateSatisfied(predicateId, state.facts, blueprint))
      .map((predicateId) => `${invariantId}:${predicateId}`)
  ));
  if (missingInvariants.length > 0) fail(`cannot arrive; destination invariants are not observed: ${missingInvariants.join(", ")}`);

  const requestedAcceptance = csv(options, "acceptance");
  if (requestedAcceptance.length === 0) fail("acceptance is required");
  const declaredIds = blueprint.destination.acceptance.map((item) => item.id);
  const missingIds = declaredIds.filter((item) => !requestedAcceptance.includes(item));
  const unknownIds = requestedAcceptance.filter((item) => !declaredIds.includes(item));
  if (missingIds.length > 0 || unknownIds.length > 0) {
    fail(`acceptance ids do not match the destination contract (missing: ${missingIds.join(", ") || "-"}; unknown: ${unknownIds.join(", ") || "-"})`);
  }
  for (const acceptance of blueprint.destination.acceptance) {
    const records = state.evidence.filter((recordEntry) => (
      recordEntry.acceptance_ids.includes(acceptance.id)
      && recordEntry.checks.some((check) => check.result === "pass")
      && recordEntry.limits.unverified.length === 0
    ));
    const proven = new Set(records.flatMap((recordEntry) => recordEntry.proves));
    const missingPredicates = acceptance.proves.filter((predicateId) => !proven.has(predicateId));
    if (missingPredicates.length > 0) {
      fail(`acceptance lacks edge evidence: ${acceptance.id} -> ${missingPredicates.join(", ")}`);
    }
  }

  const confirm = required(options, "confirm");
  state.phase = "arrived";
  state.last_proof = proveBlueprint(blueprint, state.facts, { loopIterations: state.loop_iterations });
  state.arrival_audit = {
    acceptance: requestedAcceptance,
    non_goals: csv(options, "non-goals"),
    risks: csv(options, "risks"),
    confirm,
    recorded_at: now(),
  };
  record(state, "arrival_audited", { acceptance: requestedAcceptance, evidence: confirm });
  saveState(statePath, state);
  process.stdout.write("arrival audited from observed facts and edge evidence\n");
}

export async function main(argv) {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return 0;
  }
  let statePath = DEFAULT_STATE;
  const args = [...argv];
  if (args[0] === "--state") {
    statePath = args[1] ?? fail("value is required for --state");
    args.splice(0, 2);
  }
  const command = args.shift();
  const options = parseOptions(args);
  switch (command) {
    case "validate": commandValidate(options); return 0;
    case "init": commandInit(statePath, options); return 0;
    case "status": commandStatus(statePath, options); return 0;
    case "prove": commandProve(statePath, options); return 0;
    case "approve": commandApprove(statePath, options); return 0;
    case "select": commandSelect(statePath, options); return 0;
    case "gate": return commandGate(statePath);
    case "verify": commandVerify(statePath, options); return 0;
    case "replan": commandReplan(statePath, options); return 0;
    case "arrive": commandArrive(statePath, options); return 0;
    case "board": {
      const { startBoardServer } = await import("./mapflow-board.mjs");
      await startBoardServer({
        mapPath: options.has("map") ? path.resolve(process.cwd(), required(options, "map")) : null,
        statePath: path.resolve(process.cwd(), statePath),
        port: options.get("port") ?? 4173,
      });
      return 0;
    }
    default: fail(`unknown command: ${command}`);
  }
}

if (path.resolve(process.argv[1] ?? "") === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = error instanceof CliError || error instanceof ModelError ? 1 : 2;
  }
}
