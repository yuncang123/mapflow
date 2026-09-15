#!/usr/bin/env node

import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  ModelError,
  STATE_SCHEMA_VERSION,
  TRUTH_VALUES,
  arrivalCheckpointDigest,
  arrivalEvidenceDigest,
  createArrivalCheckpoint,
  deriveSatisfiedNodes,
  edgeReadiness,
  ensureArrivalCheckpoints,
  initialFacts,
  predicateSatisfied,
  proveBlueprint,
  readBlueprint,
  registeredBriefFormattingEquivalent,
  validateSubmapTree,
} from "./mapflow-core.mjs";
import { WorkspaceError, resolveWorkspace } from "./mapflow-workspace.mjs";
import { WayfindingError, answerWayfindingQuestion, initialWayfindingDraft, readWayfinding, writeWayfinding } from "./mapflow-wayfinding.mjs";
import {
  certificateDigest,
  createProofCertificate,
  normalizeCausalContract,
  verifyProofCertificate,
} from "./mapflow-proof.mjs";
import {
  EvolutionError,
  appendWayfindingEvent,
  ensureWayfindingMigrationAnchor,
  fileCheckpoint,
  readWayfindingEvents,
  restoreFileCheckpoint,
  semanticWayfindingDigest,
  workspaceIdentityForState,
} from "./mapflow-evolution.mjs";

const PHASES = new Set(["wayfinding", "implementation", "arrived"]);
const DESTINATION_STATES = new Set(["draft", "confirmed", "approved", "changed"]);
const EVIDENCE_KINDS = new Set(["git", "document", "command", "receipt", "meeting", "note", "observation", "external"]);
const EVIDENCE_STRENGTHS = new Set(["asserted", "observed", "corroborated"]);
const RUN_STATES = new Set(["active", "waiting", "blocked", "passed", "failed", "cancelled"]);
const PROPOSAL_STATES = new Set(["pending", "confirmed", "rejected", "stale"]);
const AUTHORIZATION_REQUEST_STATES = new Set(["pending", "granted", "declined", "stale"]);
const ARRIVAL_AUDIT_REQUEST_STATES = new Set(["pending", "granted", "declined", "stale"]);
const PENDING_EVENTS = new WeakMap();
const CAPABILITY_ACTIONS = new Set(["read_workspace", "write_artifact", "run_verifier"]);

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
  if (value.strength !== undefined && !EVIDENCE_STRENGTHS.has(value.strength)) fail(`${label} has invalid strength: ${value.strength}`);
}

function normalizeRuntimeState(state) {
  state.work_events ??= [];
  state.proposals ??= [];
  state.decisions ??= [];
  state.edge_runs ??= [];
  state.authorization_requests ??= [];
  state.arrival_audit_requests ??= [];
  state.arrival_checkpoints ??= [];
  state.successor_bindings ??= [];
  state.map_receipts ??= [];
  state.receipt_invalidations ??= [];
  state.brief_snapshots ??= {};
  state.active_run ??= null;
  state.runtime_status ??= state.phase === "arrived" ? "arrived" : state.active_edge ? "running" : state.phase === "wayfinding" ? "wayfinding" : "idle";
  state.event_stream ??= null;
  state.capabilities ??= [];
  ensureArrivalCheckpoints(state, state.blueprint_snapshot);
  if (state.active_edge && !state.active_run) {
    const runId = `${state.active_edge}-legacy-run`;
    if (!state.edge_runs.some((run) => run.id === runId)) {
      state.edge_runs.push({
        id: runId,
        edge: state.active_edge,
        status: "active",
        attempt: 1,
        decision: null,
        authorization_request: null,
        started_at: state.updated_at,
        updated_at: state.updated_at,
        legacy_inferred: true,
      });
    }
    state.active_run = runId;
  }
  for (const run of state.edge_runs) run.authorization_request ??= null;
  for (const decision of state.decisions) decision.authorization_request ??= null;
  return state;
}

function validateState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) fail("state root must be a JSON object");
  normalizeRuntimeState(state);
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
  for (const field of ["verified_edges", "satisfied_nodes", "evidence", "history", "work_events", "proposals", "decisions", "edge_runs", "authorization_requests", "arrival_audit_requests", "arrival_checkpoints", "successor_bindings", "map_receipts", "receipt_invalidations"]) {
    if (!Array.isArray(state[field])) fail(`${field} must be a list`);
  }
  for (const legacyField of ["route_approval_requests", "route_approvals"]) {
    if (state[legacyField] !== undefined && !Array.isArray(state[legacyField])) fail(`${legacyField} must be a list when present`);
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
  if (!state.brief_snapshots || typeof state.brief_snapshots !== "object" || Array.isArray(state.brief_snapshots)) {
    fail("brief_snapshots must be an object");
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
  for (const evidence of state.evidence) {
    if (evidence?.proof_certificate !== undefined) {
      if (!evidence.proof_certificate || evidence.proof_certificate.schema !== "mapflow.proof-certificate/v1") {
        fail(`evidence ${evidence.id ?? "unknown"} has an invalid proof certificate`);
      }
      if (evidence.proof_certificate.certificate_digest !== certificateDigest(evidence.proof_certificate)) {
        fail(`evidence ${evidence.id ?? "unknown"} proof certificate digest mismatch`);
      }
      if (evidence.proof_certificate.edge !== evidence.edge
        || evidence.proof_certificate.evidence !== evidence.id
        || evidence.proof_certificate.run !== evidence.run
        || evidence.proof_certificate.brief_digest !== state.brief_digests[evidence.edge]) {
        fail(`evidence ${evidence.id ?? "unknown"} proof certificate binding mismatch`);
      }
    }
  }
  if (state.active_run !== null && typeof state.active_run !== "string") fail("active_run must be a string or null");
  if (state.active_run !== null && !state.edge_runs.some((run) => run.id === state.active_run && run.status === "active")) {
    fail(`active_run does not name an active Edge Run: ${state.active_run}`);
  }
  const activeRuns = state.edge_runs.filter((run) => run?.status === "active");
  if (activeRuns.length > 1) fail("runtime allows at most one active Edge Run");
  for (const run of state.edge_runs) {
    if (!run || typeof run.id !== "string" || typeof run.edge !== "string" || !RUN_STATES.has(run.status)) fail("edge_runs contains an invalid Edge Run");
    if (run.authorization_request !== null && typeof run.authorization_request !== "string") fail(`Edge Run ${run.id} has an invalid authorization_request`);
  }
  if (!Array.isArray(state.capabilities)) fail("capabilities must be a list");
  for (const capability of state.capabilities) {
    if (!capability || typeof capability !== "object" || typeof capability.id !== "string" || typeof capability.token_hash !== "string") {
      fail("capabilities contains an invalid Action Contract");
    }
    if (typeof capability.edge !== "string" || typeof capability.run !== "string" || typeof capability.map_digest !== "string" || typeof capability.brief_digest !== "string") {
      fail(`capability ${capability.id} is incomplete`);
    }
    if (capability.allowed_actions.includes("run_verifier") && (typeof capability.verifier !== "string" || typeof capability.verifier_digest !== "string")) {
      fail(`capability ${capability.id} lacks a frozen verifier binding`);
    }
    if (!Array.isArray(capability.allowed_actions) || capability.allowed_actions.some((action) => !CAPABILITY_ACTIONS.has(action))) {
      fail(`capability ${capability.id} has invalid allowed_actions`);
    }
    if (!Array.isArray(capability.brief_allowed_actions) || capability.brief_allowed_actions.some((action) => typeof action !== "string" || action.trim() === "")) {
      fail(`capability ${capability.id} lacks Task Brief action boundaries`);
    }
    if (!new Set(["active", "consumed", "expired", "revoked"]).has(capability.status)) fail(`capability ${capability.id} has invalid status`);
    if (Number.isNaN(Date.parse(capability.expires_at))) fail(`capability ${capability.id} has invalid expires_at`);
  }
  if (state.current_route_approval !== undefined && state.current_route_approval !== null && typeof state.current_route_approval !== "string") fail("current_route_approval must be a string or null when present");
  if (state.current_route_approval && !(state.route_approvals ?? []).some((approval) => approval.id === state.current_route_approval)) {
    fail(`current_route_approval does not name a Route Approval: ${state.current_route_approval}`);
  }
  for (const approval of state.route_approvals ?? []) {
    if (!approval || typeof approval.id !== "string" || typeof approval.map_digest !== "string" || typeof approval.actor !== "string") {
      fail("route_approvals contains an invalid Route Approval");
    }
  }
  for (const request of state.route_approval_requests ?? []) {
    if (!request || typeof request.id !== "string" || typeof request.map_digest !== "string" || !AUTHORIZATION_REQUEST_STATES.has(request.status)) {
      fail("route_approval_requests contains an invalid request");
    }
    if (typeof request.proof_digest !== "string" || typeof request.question !== "string" || typeof request.requested_by !== "string") {
      fail(`route approval request ${request.id} is incomplete`);
    }
    if (request.decision_owner !== undefined && (typeof request.decision_owner !== "string" || !/^(?:human|agent):/.test(request.decision_owner))) {
      fail(`route approval request ${request.id} has an invalid decision_owner`);
    }
  }
  if ((state.route_approval_requests ?? []).filter((request) => request.status === "pending").length > 1) {
    fail("runtime allows at most one pending route approval request");
  }
  for (const request of state.authorization_requests) {
    if (!request || typeof request.id !== "string" || typeof request.edge !== "string" || !AUTHORIZATION_REQUEST_STATES.has(request.status)) {
      fail("authorization_requests contains an invalid request");
    }
    if ((request.route_approval !== undefined && request.route_approval !== null && typeof request.route_approval !== "string") || typeof request.question !== "string" || typeof request.requested_by !== "string") {
      fail(`authorization request ${request.id} is incomplete`);
    }
    if (request.decision_owner !== undefined && (typeof request.decision_owner !== "string" || !/^(?:human|agent):/.test(request.decision_owner))) {
      fail(`authorization request ${request.id} has an invalid decision_owner`);
    }
  }
  if (state.authorization_requests.filter((request) => request.status === "pending").length > 1) {
    fail("runtime allows at most one pending edge authorization request");
  }
  for (const request of state.arrival_audit_requests) {
    if (!request || typeof request.id !== "string" || typeof request.map_digest !== "string" || !ARRIVAL_AUDIT_REQUEST_STATES.has(request.status)) {
      fail("arrival_audit_requests contains an invalid request");
    }
    if ((request.route_approval !== undefined && request.route_approval !== null && typeof request.route_approval !== "string") || !Number.isInteger(request.state_revision) || request.state_revision < 1) {
      fail(`arrival audit request ${request.id} has an invalid legacy route reference or state revision`);
    }
    if (typeof request.evidence_digest !== "string" || !Array.isArray(request.acceptance) || typeof request.question !== "string" || typeof request.requested_by !== "string") {
      fail(`arrival audit request ${request.id} is incomplete`);
    }
    if (request.decision_owner !== undefined && (typeof request.decision_owner !== "string" || !/^(?:human|agent):/.test(request.decision_owner))) {
      fail(`arrival audit request ${request.id} has an invalid decision_owner`);
    }
  }
  if (state.arrival_audit_requests.filter((request) => request.status === "pending").length > 1) {
    fail("runtime allows at most one pending arrival audit request");
  }
  const checkpointIds = new Set();
  const checkpointReceipts = new Set();
  for (const checkpoint of state.arrival_checkpoints) {
    if (!checkpoint || checkpoint.schema !== "mapflow.arrival-checkpoint/v1" || typeof checkpoint.id !== "string") {
      fail("arrival_checkpoints contains an invalid checkpoint");
    }
    if (checkpoint.map_id !== state.map_id || typeof checkpoint.map_digest !== "string" || !Number.isInteger(checkpoint.state_revision) || checkpoint.state_revision < 1) {
      fail(`Arrival Checkpoint ${checkpoint.id} has an invalid map or event binding`);
    }
    if (!checkpoint.destination || !checkpoint.destination_node || !checkpoint.destination_facts || !checkpoint.audit || !Array.isArray(checkpoint.acceptance)) {
      fail(`Arrival Checkpoint ${checkpoint.id} is incomplete`);
    }
    if (checkpoint.receipt_digest !== arrivalCheckpointDigest(checkpoint)) {
      fail(`Arrival Checkpoint ${checkpoint.id} receipt digest mismatch`);
    }
    if (checkpointIds.has(checkpoint.id) || checkpointReceipts.has(checkpoint.receipt_digest)) {
      fail(`Arrival Checkpoint is duplicated: ${checkpoint.id}`);
    }
    checkpointIds.add(checkpoint.id);
    checkpointReceipts.add(checkpoint.receipt_digest);
  }
  for (const binding of state.successor_bindings) {
    if (!binding || binding.schema !== "mapflow.successor-binding/v1" || typeof binding.id !== "string") {
      fail("successor_bindings contains an invalid binding");
    }
    const checkpoint = state.arrival_checkpoints.find((item) => item.id === binding.predecessor_checkpoint);
    if (!checkpoint || checkpoint.receipt_digest !== binding.predecessor_receipt_digest) {
      fail(`Successor Binding ${binding.id} does not resolve its predecessor Arrival Checkpoint`);
    }
    if (binding.map_id !== state.map_id || typeof binding.map_digest !== "string" || typeof binding.origin_node !== "string") {
      fail(`Successor Binding ${binding.id} has an invalid map or origin binding`);
    }
    if (!Array.isArray(binding.imported_predicates) || !Array.isArray(binding.revalidated_predicates) || !binding.origin_snapshot) {
      fail(`Successor Binding ${binding.id} is incomplete`);
    }
  }
  for (const proposal of state.proposals) {
    if (!proposal || typeof proposal.id !== "string" || !PROPOSAL_STATES.has(proposal.status)) fail("proposals contains an invalid Proposal");
  }
  if (state.event_stream !== null) {
    if (!state.event_stream || typeof state.event_stream.path !== "string" || !Number.isInteger(state.event_stream.last_seq) || state.event_stream.last_seq < 0) {
      fail("event_stream has an invalid shape");
    }
    if (state.event_stream.last_seq > 0 && !/^[a-f0-9]{64}$/.test(state.event_stream.head_digest ?? "")) fail("event_stream.head_digest is invalid");
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
  verifyEventStream(statePath, state);
  return state;
}

function eventsPathForState(statePath, state) {
  return path.resolve(path.dirname(path.resolve(statePath)), state.event_stream?.path ?? "events.jsonl");
}

function eventDigest(event) {
  const payload = structuredClone(event);
  delete payload.event_digest;
  return crypto.createHash("sha256").update(stableJson(payload)).digest("hex");
}

function readEventStream(eventsPath) {
  if (!fs.existsSync(eventsPath)) return [];
  const content = fs.readFileSync(eventsPath, "utf8");
  const lines = content.split(/\r?\n/).filter((line) => line.trim() !== "");
  const events = [];
  const identities = new Set();
  let previous = null;
  let streamIdentity = null;
  for (let index = 0; index < lines.length; index += 1) {
    let event;
    try {
      event = JSON.parse(lines[index]);
    } catch (error) {
      fail(`invalid event JSON at line ${index + 1}: ${error.message}`);
    }
    const expectedSeq = index + 1;
    if (!event || typeof event !== "object" || Array.isArray(event)) fail(`event at line ${expectedSeq} must be an object`);
    if (event.schema !== "mapflow.event/v1" || event.specversion !== "1.0") fail(`unsupported event envelope at seq ${expectedSeq}`);
    for (const field of ["id", "source", "type", "time", "subject", "stream", "base_revision", "actor", "event_digest"]) {
      if (typeof event[field] !== "string" || event[field].trim() === "") fail(`event ${field} is invalid at seq ${expectedSeq}`);
    }
    if (!event.data || typeof event.data !== "object" || Array.isArray(event.data)) fail(`event data is invalid at seq ${expectedSeq}`);
    if (!event.data.projection || typeof event.data.projection !== "object" || Array.isArray(event.data.projection)) {
      fail(`event projection is invalid at seq ${expectedSeq}`);
    }
    if ("event_stream" in event.data.projection) fail(`event projection must not contain event_stream at seq ${expectedSeq}`);
    const eventProjection = structuredClone(event.data.projection);
    validateState(eventProjection);
    const expectedSource = `mapflow://${eventProjection.map_id}`;
    const expectedStream = `map/${eventProjection.map_id}`;
    if (event.source !== expectedSource || event.stream !== expectedStream) fail(`event map identity mismatch at seq ${expectedSeq}`);
    if (!/^mapflow\.[a-z0-9.]+\.v1$/.test(event.type)) fail(`event type is invalid at seq ${expectedSeq}`);
    if (Number.isNaN(Date.parse(event.time))) fail(`event time is invalid at seq ${expectedSeq}`);
    if (event.base_revision !== (previous ?? eventProjection.map_digest)) fail(`event base revision mismatch at seq ${expectedSeq}`);
    const identity = `${event.source}\0${event.id}`;
    if (streamIdentity === null) streamIdentity = `${event.source}\0${event.stream}`;
    if (streamIdentity !== `${event.source}\0${event.stream}`) fail(`event stream identity changed at seq ${expectedSeq}`);
    if (event.seq !== expectedSeq) fail(`event sequence gap at line ${expectedSeq}: found ${event.seq}`);
    if (event.previous_digest !== previous) fail(`event hash chain is broken at seq ${event.seq}`);
    if (event.event_digest !== eventDigest(event)) fail(`event digest mismatch at seq ${event.seq}`);
    if (identities.has(identity)) fail(`duplicate event identity at seq ${event.seq}: ${event.source} ${event.id}`);
    identities.add(identity);
    previous = event.event_digest;
    events.push(event);
  }
  return events;
}

function verifyEventStream(statePath, state) {
  if (state.event_stream === null) return;
  const eventsPath = eventsPathForState(statePath, state);
  const events = readEventStream(eventsPath);
  const head = events.at(-1)?.event_digest ?? null;
  if (events.length !== state.event_stream.last_seq || head !== state.event_stream.head_digest) {
    fail(`event projection mismatch; run rebuild --events ${eventsPath}`);
  }
  const latestProjection = events.at(-1)?.data?.projection ?? null;
  const normalizedLatest = latestProjection ? structuredClone(latestProjection) : null;
  if (normalizedLatest) validateState(normalizedLatest);
  if (!normalizedLatest || stableJson(projectionSnapshot(state)) !== stableJson(projectionSnapshot(normalizedLatest))) {
    fail(`state content does not match the event projection; run rebuild --events ${eventsPath}`);
  }
}

function projectionSnapshot(state) {
  const snapshot = structuredClone(state);
  delete snapshot.event_stream;
  return snapshot;
}

function appendPendingEvent(statePath, state) {
  const pending = PENDING_EVENTS.get(state);
  if (!pending) return null;
  const previous = state.event_stream?.head_digest ?? null;
  const seq = (state.event_stream?.last_seq ?? 0) + 1;
  const source = `mapflow://${state.map_id}`;
  const subjectValue = pending.details.proposal ?? pending.details.run ?? pending.details.request ?? pending.details.approval ?? pending.details.edge ?? pending.details.binding ?? state.map_id;
  const envelope = {
    schema: "mapflow.event/v1",
    specversion: "1.0",
    id: `${state.map_id}-${seq}-${pending.event.replaceAll("_", "-")}`,
    source,
    type: `mapflow.${pending.event.replaceAll("_", ".")}.v1`,
    time: pending.at,
    subject: String(subjectValue),
    stream: `map/${state.map_id}`,
    seq,
    base_revision: previous ?? state.map_digest,
    previous_digest: previous,
    actor: pending.details.actor ?? pending.details.executor ?? pending.details.by ?? "system:mapflow",
    ...(pending.details.causation_id ? { causation_id: pending.details.causation_id } : {}),
    data: {
      details: pending.details,
      projection: projectionSnapshot(state),
    },
  };
  envelope.event_digest = eventDigest(envelope);
  const eventsPath = eventsPathForState(statePath, state);
  const checkpoint = fileCheckpoint(eventsPath);
  fs.mkdirSync(path.dirname(eventsPath), { recursive: true });
  fs.appendFileSync(eventsPath, `${JSON.stringify(envelope)}\n`, "utf8");
  state.event_stream = {
    path: path.relative(path.dirname(path.resolve(statePath)), eventsPath).replaceAll("\\", "/") || "events.jsonl",
    last_seq: seq,
    head_digest: envelope.event_digest,
  };
  return { eventsPath, checkpoint };
}

function saveState(statePath, state, { appendEvent = true } = {}) {
  validateState(state);
  const previousEventStream = structuredClone(state.event_stream);
  const temporary = `${statePath}.tmp-${process.pid}`;
  let eventAppend = null;
  try {
    if (appendEvent) eventAppend = appendPendingEvent(statePath, state);
    validateState(state);
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    fs.renameSync(temporary, statePath);
    PENDING_EVENTS.delete(state);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    if (eventAppend) restoreFileCheckpoint(eventAppend.eventsPath, eventAppend.checkpoint);
    state.event_stream = previousEventStream;
    throw error;
  }
}

function record(state, event, details = {}) {
  const timestamp = now();
  if (!new Set(["arrival_audit_requested", "arrival_audited", "decision_owner_assigned", "replan_requested"]).has(event)) {
    let invalidatedArrivalRequest = false;
    for (const request of state.arrival_audit_requests.filter((item) => item.status === "pending")) {
      request.status = "stale";
      request.stale_at = timestamp;
      request.stale_reason = `runtime event ${event} occurred after the request`;
      invalidatedArrivalRequest = true;
    }
    if (invalidatedArrivalRequest) state.runtime_status = dormantRuntimeStatus(state);
  }
  state.updated_at = timestamp;
  const entry = { at: state.updated_at, event, ...details };
  state.history.push(entry);
  PENDING_EVENTS.set(state, { event, details: structuredClone(details), at: state.updated_at });
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
  if (loaded.digest !== state.map_digest && registeredBriefFormattingEquivalent({
    mapPath: absolute,
    blueprint: loaded.blueprint,
    briefs: loaded.briefs,
    state,
  })) {
    return {
      ...loaded,
      absolute,
      digest: state.map_digest,
      brief_digests: structuredClone(state.brief_digests),
      briefs: structuredClone(state.brief_snapshots),
    };
  }
  return { ...loaded, absolute };
}

function assertMapUnchanged(statePath, state, digest) {
  if (digest !== state.map_digest) fail(`Blueprint or bound Task Brief changed after approval: ${resolveStateMap(statePath, state)}; use replan`);
}

function currentDestinationView(state, blueprint) {
  const invariantMap = new Map(blueprint.invariants.map((invariant) => [invariant.id, invariant]));
  const required = [...new Set([
    ...blueprint.destination.requires,
    ...blueprint.destination.invariants.flatMap((invariantId) => invariantMap.get(invariantId)?.requires ?? []),
  ])];
  const missing = required.filter((predicateId) => !predicateSatisfied(predicateId, state.facts, blueprint));
  const observed = missing.length === 0;
  return {
    status: observed
      ? state.phase === "arrived" ? "arrived" : "satisfied"
      : state.phase === "arrived" && state.arrival_checkpoints.length > 0 ? "drifted" : "unsatisfied",
    observed,
    required,
    missing,
  };
}

function refreshDerivedState(state, blueprint) {
  state.loop_iterations = Object.fromEntries(blueprint.loops.map((loop) => [
    loop.id,
    state.loop_iterations?.[loop.id] ?? 0,
  ]));
  state.satisfied_nodes = deriveSatisfiedNodes(blueprint, state.facts);
  state.last_proof = proveBlueprint(blueprint, state.facts, { loopIterations: state.loop_iterations });
  state.current_destination = currentDestinationView(state, blueprint);
  if (state.phase === "arrived") state.runtime_status = state.current_destination.observed ? "arrived" : "drifted";
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
    submap: structuredClone(blueprint.submaps.find((binding) => binding.parent_edge === edgeId) ?? null),
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
      fail(`verified edge contract cannot be removed or redefined: ${edgeId}; preserve its accepted child version or initialize a successor map`);
    }
  }
}

function assertPredecessorCollectionsPreserved(state, blueprint, briefDigests, revalidatedPredicateIds) {
  const previous = state.blueprint_snapshot;
  const labels = {
    predicates: "predicate",
    assumptions: "assumption",
    invariants: "invariant",
    nodes: "node",
    edges: "edge",
    loops: "loop",
    submaps: "submap",
  };
  for (const [collection, label] of Object.entries(labels)) {
    const current = new Map((blueprint[collection] ?? []).map((item) => [item.id, item]));
    for (const item of previous[collection] ?? []) {
      if (!current.has(item.id) || stableJson(current.get(item.id)) !== stableJson(item)) {
        fail(`predecessor ${label} cannot be removed or redefined: ${item.id}`);
      }
    }
  }
  for (const edgeId of Object.keys(state.brief_digests)) {
    if (briefDigests[edgeId] !== state.brief_digests[edgeId]) {
      fail(`predecessor Task Brief cannot be removed or redefined: ${edgeId}`);
    }
  }
  for (const boundary of ["in_scope", "out_of_scope", "authorization"]) {
    const current = new Set(blueprint.boundaries[boundary]);
    const removed = previous.boundaries[boundary].filter((entry) => !current.has(entry));
    if (removed.length > 0) fail(`predecessor boundary cannot be removed: ${boundary}`);
  }
  for (const [key, value] of Object.entries(previous.extensions ?? {})) {
    if (stableJson(blueprint.extensions?.[key]) !== stableJson(value)) {
      fail(`predecessor extension cannot be removed or redefined: ${key}`);
    }
  }
  const revalidatedFacts = new Set(revalidatedPredicateIds.map((predicateId) => (
    blueprint.predicates.find((predicate) => predicate.id === predicateId).fact
  )));
  const currentFacts = new Map(blueprint.initial_state.facts.map((fact) => [fact.id, fact]));
  for (const fact of previous.initial_state.facts) {
    const current = currentFacts.get(fact.id);
    if (!current) fail(`predecessor initial Fact cannot be removed: ${fact.id}`);
    if (!revalidatedFacts.has(fact.id) && stableJson(current) !== stableJson(fact)) {
      fail(`predecessor initial Fact can change only through continuity.revalidate: ${fact.id}`);
    }
  }
}

function mergeSuccessorFacts(state, blueprint, revalidatedPredicateIds) {
  const merged = initialFacts(blueprint);
  const revalidatedFacts = new Set(revalidatedPredicateIds.map((predicateId) => (
    blueprint.predicates.find((predicate) => predicate.id === predicateId).fact
  )));
  for (const [factId, fact] of Object.entries(state.facts)) {
    if (factId in merged && !revalidatedFacts.has(factId)) merged[factId] = structuredClone(fact);
  }
  return merged;
}

function changedBlueprintRefs(previous, next, previousBriefDigests = {}, nextBriefDigests = {}) {
  const refs = [];
  const collections = ["predicates", "assumptions", "invariants", "nodes", "edges", "loops", "submaps"];
  for (const collection of collections) {
    const before = new Map(previous[collection].map((item) => [item.id, item]));
    const after = new Map(next[collection].map((item) => [item.id, item]));
    for (const id of new Set([...before.keys(), ...after.keys()])) {
      if (stableJson(before.get(id)) !== stableJson(after.get(id))) {
        refs.push(`${collection.replace(/s$/, "")}:${id}`);
      }
    }
  }
  if (stableJson(previous.intent) !== stableJson(next.intent)) refs.push("intent:definition");
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
      for (const binding of blueprint.submaps) {
        if (binding.parent_edge === edgeId) allowed.add(`submap:${binding.id}`);
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
    allowed.add("intent:definition");
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

function activeRun(state) {
  return state.active_run === null ? null : state.edge_runs.find((run) => run.id === state.active_run) ?? null;
}

function dormantRuntimeStatus(state) {
  if (activeRun(state)) return "running";
  if (state.arrival_audit_requests.some((request) => request.status === "pending")) return "arrival-audit-required";
  if (state.authorization_requests.some((request) => request.status === "pending")) return "authorization-required";
  if (state.edge_runs.some((run) => run.status === "blocked")) return "blocked";
  if (state.edge_runs.some((run) => run.status === "waiting")) return "waiting";
  return "idle";
}

function destinationConfirmed(state) {
  return new Set(["confirmed", "approved"]).has(state.destination_status);
}

function capabilityDigest(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function capabilityFor(state, token, edgeId, action, verifier) {
  if (typeof token !== "string" || token.trim() === "") fail("capability token is required");
  const capability = state.capabilities.find((entry) => entry.token_hash === capabilityDigest(token));
  if (!capability) fail("capability token is invalid");
  if (capability.status !== "active") fail(`capability is ${capability.status}`);
  if (Date.parse(capability.expires_at) <= Date.now()) {
    capability.status = "expired";
    fail(`capability expired: ${capability.id}`);
  }
  if (capability.edge !== edgeId || capability.run !== state.active_run) fail("capability is not bound to the active Edge Run");
  if (capability.map_digest !== state.map_digest || capability.brief_digest !== state.brief_digests[edgeId]) {
    fail("capability is stale because the map or Task Brief changed");
  }
  if (!capability.allowed_actions.includes(action)) fail(`capability does not allow action: ${action}`);
  if (action === "run_verifier" && (capability.verifier !== verifier.id || capability.verifier_digest !== verifierDigest(verifier))) {
    fail("capability is not bound to this frozen verifier");
  }
  capability.status = "consumed";
  capability.consumed_at = now();
  return capability;
}

function verifierDigest(verifier) {
  return crypto.createHash("sha256").update(stableJson(verifier)).digest("hex");
}

function verifierDisplay(verifier) {
  return [verifier.program, ...verifier.args].map((part) => JSON.stringify(part)).join(" ");
}

function runVerifier(verifier, workspaceRoot, mapDirectory) {
  const cwd = verifier.cwd === "workspace" ? workspaceRoot : mapDirectory;
  const startedAt = now();
  const result = spawnSync(verifier.program, verifier.args, {
    cwd,
    encoding: "utf8",
    shell: false,
    timeout: verifier.timeout_seconds * 1000,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  const exitCode = typeof result.status === "number" ? result.status : 1;
  const signal = result.signal ?? null;
  const stdout = String(result.stdout ?? "");
  const stderr = String(result.stderr ?? result.error?.message ?? "");
  return {
    command: verifierDisplay(verifier),
    program: verifier.program,
    args: verifier.args,
    cwd,
    result: verifier.success_exit_codes.includes(exitCode) && !result.error ? "pass" : "fail",
    exit_code: exitCode,
    signal,
    stdout,
    stderr,
    stdout_digest: crypto.createHash("sha256").update(stdout).digest("hex"),
    stderr_digest: crypto.createHash("sha256").update(stderr).digest("hex"),
    started_at: startedAt,
    finished_at: now(),
  };
}

function destinationAcceptanceReady(blueprint, state) {
  return blueprint.destination.acceptance.every((acceptance) => {
    const records = state.evidence.filter((entry) => (
      entry.acceptance_ids?.includes(acceptance.id)
      && entry.checks?.some((check) => check.result === "pass" && check.mode !== "reported")
      && (entry.limits?.unverified?.length ?? 0) === 0
    ));
    const proven = new Set(records.flatMap((entry) => entry.proves ?? []));
    return acceptance.proves.every((predicateId) => proven.has(predicateId));
  });
}

function edgeNeedsAuthorization(briefs, edgeId) {
  return (briefs[edgeId]?.metadata?.contract?.authorization?.required ?? []).length > 0;
}

function enterImplementation(state, blueprint) {
  if (state.phase === "implementation") return false;
  if (state.phase !== "wayfinding") fail(`cannot enter implementation from phase: ${state.phase}`);
  if (blueprint.intent.status !== "shaped" || blueprint.intent.open_questions.length > 0) {
    fail("implementation requires a shaped Intent with no open questions");
  }
  refreshDerivedState(state, blueprint);
  ensureApprovableProof(state);
  if (blueprint.schema_version >= 3 && state.last_proof.causal_soundness !== "explicit") {
    fail("implementation requires explicit causal contracts on every destination-relevant edge");
  }
  state.phase = "implementation";
  state.destination_status = "confirmed";
  state.runtime_status = "idle";
  return true;
}

function readyEdgesFor(blueprint, state) {
  return blueprint.edges
    .filter((edge) => !state.verified_edges.includes(edge.id) || loopsForEdge(blueprint, edge.id).length > 0)
    .filter((edge) => state.last_proof.proven_edges.includes(edge.id))
    .map((edge) => ({ edge: edge.id, readiness: edgeReadiness(blueprint, state.facts, edge.id) }))
    .filter((entry) => entry.readiness.ready)
    .map((entry) => ({ edge: entry.edge, missing: [] }));
}

function commandNextActions(statePath, options) {
  if (!fs.existsSync(statePath)) {
    const wayfindingPath = wayfindingPathsForState(statePath).draftPath;
    if (fs.existsSync(wayfindingPath)) {
      const draft = readWayfinding(wayfindingPath).draft;
      const pendingQuestion = draft.questions.find((question) => (question.status ?? "pending") === "pending") ?? null;
      const actions = pendingQuestion
        ? [{ id: "answer-wayfinding-question", question_id: pendingQuestion.id, target: pendingQuestion.target, reason: pendingQuestion.prompt }]
        : [{ id: "continue-wayfinding", command: "wayfinding-write", reason: "shape the destination and regress the route before initializing runtime" }];
      const output = { deterministic: true, phase: "wayfinding", runtime_status: "wayfinding", actions, ready_edges: [] };
      process.stdout.write(options.has("json") ? `${JSON.stringify(output, null, 2)}\n` : `next action: ${actions[0].id}\n`);
      return;
    }
    const output = {
      deterministic: true,
      phase: "uninitialized",
      actions: [{ id: "enable", command: "enable", reason: "workspace sidecar and the blank wayfinding state do not exist" }],
      ready_edges: [],
    };
    process.stdout.write(options.has("json") ? `${JSON.stringify(output, null, 2)}\n` : "next action: enable (workspace sidecar is absent)\n");
    return;
  }
  const state = loadState(statePath);
  if (state.phase === "arrived") {
    const { blueprint } = readStateBlueprint(statePath, state);
    const currentDestination = currentDestinationView(state, blueprint);
    const output = {
      deterministic: true,
      phase: "arrived",
      runtime_status: currentDestination.observed ? "arrived" : "drifted",
      actions: [{
        id: "begin-successor",
        command: "continue",
        reason: "bind a human-confirmed successor Destination to this immutable Arrival Checkpoint",
        checkpoint: state.arrival_checkpoints.at(-1)?.id ?? null,
      }],
      ready_edges: [],
      evidence_levels: runtimeEvidenceLevels(state, blueprint),
      arrival_audit: state.arrival_audit ?? null,
      arrival_checkpoints: structuredClone(state.arrival_checkpoints),
      current_destination: currentDestination,
    };
    process.stdout.write(options.has("json") ? `${JSON.stringify(output, null, 2)}\n` : "next action: continue from the audited Arrival Checkpoint\n");
    return;
  }
  if (state.phase === "wayfinding") {
    const { blueprint, briefs } = readStateBlueprint(statePath, state);
    const wayfindingPath = wayfindingPathsForState(statePath).draftPath;
    const wayfinding = fs.existsSync(wayfindingPath) ? readWayfinding(wayfindingPath).draft : null;
    const pendingQuestion = wayfinding?.questions?.find((question) => (question.status ?? "pending") === "pending") ?? null;
    const actions = [];
    if (pendingQuestion) actions.push({ id: "answer-wayfinding-question", question_id: pendingQuestion.id, target: pendingQuestion.target, reason: pendingQuestion.prompt });
    else if (state.last_proof?.structural === "complete" && new Set(["logical", "conditional"]).has(state.last_proof.reachability)) {
      const readyEdges = readyEdgesFor(blueprint, state);
      readyEdges.forEach((entry) => actions.push(edgeNeedsAuthorization(briefs, entry.edge)
        ? { id: "request-authorization", command: "request-authorization", edge: entry.edge, reason: "edge is proven and ready, and its Task Brief declares an authorization requirement" }
        : { id: "start", command: "start", edge: entry.edge, reason: "edge is proven, ready, and carries no external authorization requirement" }));
      if (readyEdges.length === 0) actions.push({ id: "prove-or-replan", command: "prove or replan", reason: "the map is proven but no first edge is runtime-ready" });
    } else {
      actions.push({ id: "shape-or-replan", command: "wayfinding-write or replan", reason: "the map is not yet structurally and causally ready" });
    }
    const output = {
      deterministic: true,
      phase: state.phase,
      runtime_status: state.runtime_status,
      actions,
      ready_edges: readyEdgesFor(blueprint, state),
      proof: state.last_proof,
      evidence_levels: runtimeEvidenceLevels(state, blueprint),
    };
    process.stdout.write(options.has("json") ? `${JSON.stringify(output, null, 2)}\n` : `next action: ${actions[0]?.id ?? "none"}\n`);
    return;
  }

  const { blueprint, digest, briefs } = readStateBlueprint(statePath, state);
  assertMapUnchanged(statePath, state, digest);
  refreshDerivedState(state, blueprint);
  const readyEdges = readyEdgesFor(blueprint, state);
  const actions = [];
  const pendingAuth = state.authorization_requests.find((request) => request.status === "pending");
  const pendingArrival = state.arrival_audit_requests.find((request) => request.status === "pending");
  if (pendingArrival) {
    actions.push({ id: "await-arrival-audit", request_id: pendingArrival.id, reason: "a human arrival audit is pending" });
  } else if (state.active_run) {
    const activeCapability = state.capabilities.find((entry) => entry.run === state.active_run && entry.status === "active" && Date.parse(entry.expires_at) > Date.now()) ?? null;
    actions.push({ id: "gate", command: "gate", edge: state.active_edge, reason: "recheck the active capability boundary" });
    if (activeCapability) actions.push({ id: "verify-executed", command: "verify-executed", edge: state.active_edge, capability_id: activeCapability.id, verifier: activeCapability.verifier, reason: "consume the issued capability and capture the verifier's actual result" });
    else actions.push({ id: "issue-action", command: "issue-action --actions run_verifier --verifier <brief-verifier-id>", edge: state.active_edge, reason: "issue a one-use capability for a verifier frozen in the Task Brief" });
    actions.push({ id: "wait-or-block", reason: "pause the active run when an external dependency is not ready" });
  } else if (pendingAuth) {
    actions.push({ id: "await-authorization", request_id: pendingAuth.id, edge: pendingAuth.edge, reason: "a human edge authorization is pending" });
  } else if (readyEdges.length > 0) {
    readyEdges.forEach((entry) => actions.push(edgeNeedsAuthorization(briefs, entry.edge)
      ? { id: "request-authorization", command: "request-authorization", edge: entry.edge, reason: "edge is proven and ready, and its Task Brief declares an authorization requirement" }
      : { id: "start", command: "start", edge: entry.edge, reason: "edge is proven, ready, and carries no external authorization requirement" }));
  } else if (blueprint.destination.requires.every((predicateId) => predicateSatisfied(predicateId, state.facts, blueprint)) && destinationAcceptanceReady(blueprint, state)) {
    actions.push({ id: "request-arrival-audit", command: "request-arrival-audit", reason: "destination predicates and acceptance evidence are observed" });
  } else {
    actions.push({ id: "prove-or-replan", command: "prove or replan", reason: "no executable edge is currently ready" });
  }
  const output = {
    deterministic: true,
    phase: state.phase,
    destination_status: state.destination_status,
    runtime_status: state.runtime_status,
    active_edge: state.active_edge,
    active_run: state.active_run,
    actions,
    ready_edges: readyEdges,
    proof: state.last_proof,
    evidence_levels: runtimeEvidenceLevels(state, blueprint),
    pending_human_requests: [
      ...state.authorization_requests,
      ...state.arrival_audit_requests,
    ].filter((request) => request.status === "pending").map((request) => ({ id: request.id, kind: request.id.includes("arrival-audit") ? "arrival-audit" : "authorization", edge: request.edge ?? null, decision_owner: request.decision_owner ?? null })),
  };
  process.stdout.write(options.has("json") ? `${JSON.stringify(output, null, 2)}\n` : `next action(s): ${actions.map((action) => action.id).join(", ") || "none"}\n`);
}

function commandIssueAction(statePath, options) {
  const state = loadState(statePath);
  if (state.phase !== "implementation" || !destinationConfirmed(state) || !state.active_run || !activeRun(state)) {
    fail("issue-action requires one active Edge Run on a confirmed destination map");
  }
  const edgeId = options.get("edge") ?? state.active_edge;
  if (edgeId !== state.active_edge) fail(`issue-action must name active edge ${JSON.stringify(state.active_edge)}`);
  const { blueprint, digest, brief_digests: briefDigests, briefs } = readStateBlueprint(statePath, state);
  assertMapUnchanged(statePath, state, digest);
  ensureReadyEdge(blueprint, state, edgeId);
  const actions = csv(options, "actions");
  const allowedActions = actions.length > 0 ? actions : ["run_verifier"];
  if (allowedActions.some((action) => !CAPABILITY_ACTIONS.has(action))) fail(`invalid capability action; allowed: ${[...CAPABILITY_ACTIONS].join(", ")}`);
  const verifierId = allowedActions.includes("run_verifier") ? required(options, "verifier") : null;
  const verifier = verifierId === null
    ? null
    : briefs[edgeId]?.metadata?.contract?.verification?.commands?.find((entry) => entry.id === verifierId) ?? null;
  if (verifierId !== null && !verifier) fail(`Task Brief for ${edgeId} does not declare verifier: ${verifierId}`);
  for (const entry of state.capabilities.filter((item) => item.run === state.active_run && item.status === "active" && Date.parse(item.expires_at) <= Date.now())) {
    entry.status = "expired";
    entry.expired_at = now();
  }
  const existing = state.capabilities.find((entry) => entry.run === state.active_run && entry.status === "active");
  if (existing) fail(`an active capability already exists for this run: ${existing.id}`);
  const ttlSeconds = Number(options.get("ttl") ?? 900);
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 3600) fail("ttl must be an integer between 1 and 3600 seconds");
  const rawToken = `mfcap_${crypto.randomBytes(24).toString("hex")}`;
  const issuedAt = now();
  const expiresAt = new Date(Date.parse(issuedAt) + ttlSeconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const capability = {
    id: nextSemanticId(state.capabilities, edgeId, "capability"),
    edge: edgeId,
    run: state.active_run,
    map_digest: state.map_digest,
    brief_digest: briefDigests[edgeId],
    allowed_actions: allowedActions,
    brief_allowed_actions: [...briefs[edgeId].metadata.contract.authorization.allowed_actions],
    ...(verifier === null ? {} : { verifier: verifier.id, verifier_digest: verifierDigest(verifier) }),
    token_hash: capabilityDigest(rawToken),
    issued_at: issuedAt,
    expires_at: expiresAt,
    status: "active",
  };
  state.capabilities.push(capability);
  record(state, "action_capability_issued", { capability: capability.id, edge: edgeId, run: state.active_run, allowed_actions: allowedActions, brief_allowed_actions: capability.brief_allowed_actions, verifier: verifier?.id ?? null, expires_at: expiresAt, actor: options.get("actor") ?? "agent:mapflow" });
  saveState(statePath, state);
  const output = { capability_id: capability.id, token: rawToken, edge: edgeId, run: state.active_run, allowed_actions: allowedActions, brief_allowed_actions: capability.brief_allowed_actions, verifier: verifier?.id ?? null, expires_at: expiresAt };
  process.stdout.write(options.has("json") ? `${JSON.stringify(output, null, 2)}\n` : `issued capability ${capability.id}; token: ${rawToken}\n`);
}

function nextSemanticId(items, prefix, suffix) {
  const count = items.filter((item) => item.id.startsWith(`${prefix}-${suffix}-`)).length + 1;
  return `${prefix}-${suffix}-${count}`;
}

function createDecision(state, blueprint, edgeId, reason, actor, authorizationRequest = null) {
  const sourceNode = blueprint.edges.find((edge) => edge.id === edgeId)?.from;
  const alternatives = blueprint.edges.filter((edge) => edge.from === sourceNode && state.last_proof.proven_edges.includes(edge.id)).map((edge) => edge.id);
  const decision = {
    id: nextSemanticId(state.decisions, edgeId, "decision"),
    edge: edgeId,
    at_node: sourceNode,
    alternatives,
    reason,
    actor,
    authorization_request: authorizationRequest?.id ?? null,
    decided_at: now(),
  };
  state.decisions.push(decision);
  return decision;
}

function startEdgeRun(state, edgeId, decision, authorizationRequest = null) {
  const attempt = state.edge_runs.filter((run) => run.edge === edgeId).length + 1;
  const timestamp = now();
  const run = {
    id: `${edgeId}-run-${attempt}`,
    edge: edgeId,
    status: "active",
    attempt,
    decision: decision?.id ?? null,
    authorization_request: authorizationRequest?.id ?? null,
    started_at: timestamp,
    updated_at: timestamp,
  };
  state.edge_runs.push(run);
  state.active_run = run.id;
  state.active_edge = edgeId;
  state.runtime_status = "running";
  return run;
}

function transitionRun(state, status, details = {}) {
  const run = activeRun(state);
  if (!run) fail("no active Edge Run");
  run.status = status;
  run.updated_at = now();
  Object.assign(run, details);
  for (const capability of state.capabilities.filter((entry) => entry.run === run.id && entry.status === "active")) {
    capability.status = "revoked";
    capability.revoked_at = now();
    capability.revoked_reason = `Edge Run transitioned to ${status}`;
  }
  state.active_run = null;
  state.active_edge = null;
  state.runtime_status = dormantRuntimeStatus(state);
  return run;
}

function applyPredicateFacts(state, blueprint, predicateIds, evidenceRefs) {
  const predicateMap = new Map(blueprint.predicates.map((predicate) => [predicate.id, predicate]));
  for (const predicateId of predicateIds) {
    const predicate = predicateMap.get(predicateId);
    if (!predicate) fail(`unknown predicate: ${predicateId}`);
    const previousEvidence = state.facts[predicate.fact]?.evidence ?? [];
    state.facts[predicate.fact] = {
      value: predicate.equals,
      evidence: [...previousEvidence, ...evidenceRefs],
    };
  }
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
  process.stdout.write("workspace options:\n");
  process.stdout.write("  --root PATH          resolve the Git worktree or directory being assisted\n");
  process.stdout.write("  --mapflow-home PATH  override the user state home with an absolute path outside the workspace\n\n");
  process.stdout.write("commands:\n");
  process.stdout.write("  enable     create or restore the current workspace sidecar\n");
  process.stdout.write("  wayfinding-write  validate and atomically replace the modeling draft\n");
  process.stdout.write("  wayfinding-answer  persist one human answer and refresh the modeling draft\n");
  process.stdout.write("  validate   validate a Blueprint definition\n");
  process.stdout.write("  init       initialize runtime state from a Blueprint\n");
  process.stdout.write("  status     show the current runtime projection\n");
  process.stdout.write("  context    disclose bounded context for the current map or edge (--layer focus|work|evidence|history)\n");
  process.stdout.write("  prove      regress from Destination and build the forward derivation graph\n");
  process.stdout.write("  next-actions  derive the complete set of currently allowed moves\n");
  process.stdout.write("  start      activate one proven ready edge with no declared authorization requirement\n");
  process.stdout.write("  request-authorization  ask the declared decision owner for a protected ready edge\n");
  process.stdout.write("  authorize  apply one pending authorization and activate its edge\n");
  process.stdout.write("  decline-authorization  decline one pending edge authorization request\n");
  process.stdout.write("  gate       check whether the active edge may execute\n");
  process.stdout.write("  issue-action  issue a one-use capability for the active Edge Run\n");
  process.stdout.write("  wait       move the active Edge Run to waiting\n");
  process.stdout.write("  block      move the active Edge Run to blocked\n");
  process.stdout.write("  resume     resume a waiting or blocked Edge Run\n");
  process.stdout.write("  cancel     cancel an active, waiting, or blocked Edge Run\n");
  process.stdout.write("  propose    record a Work Event and pending Fact Proposal\n");
  process.stdout.write("  confirm    confirm a Proposal and apply its Fact\n");
  process.stdout.write("  reject     reject a Proposal without changing Facts\n");
  process.stdout.write("  verify     record an explicit pass/fail check and apply proven effects\n");
  process.stdout.write("  verify-executed  run one verifier under a one-use capability and record trusted Evidence\n");
  process.stdout.write("  verify-submap  verify child arrival and accept a Map Receipt\n");
  process.stdout.write("  replan     preserve evidence and return to wayfinding\n");
  process.stdout.write("  continue   bind an audited Arrival to a successor Blueprint in the same navigation field\n");
  process.stdout.write("  request-arrival-audit  freeze completed destination evidence for a human or Agent audit\n");
  process.stdout.write("  arrive     consume one pending audit answer and record Arrival\n");
  process.stdout.write("  rebuild    rebuild state projection from verified events\n");
  process.stdout.write("  board      serve a read-only dynamic map (--map MAP, --port PORT)\n");
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function wayfindingPathsForState(statePath) {
  const directory = path.dirname(path.resolve(statePath));
  return {
    draftPath: path.join(directory, "wayfinding.yaml"),
    eventsPath: path.join(directory, "wayfinding-events.jsonl"),
  };
}

function assertWayfindingJournalMatchesCurrent(eventsPath, draftPath) {
  const journal = readWayfindingEvents(eventsPath);
  if (!journal.events.length || !fs.existsSync(draftPath)) return journal;
  const recorded = journal.events.at(-1).data.draft_digest;
  const actual = sha256File(draftPath);
  if (recorded !== actual) {
    fail(`wayfinding draft does not match the event journal head: ${draftPath}`);
  }
  return journal;
}

function mutateWayfindingWithEvent(statePath, event, mutate) {
  if (fs.existsSync(statePath)) {
    fail("formal runtime already exists; preserve the bridged Wayfinding segment and register bounded changes with replan");
  }
  const { draftPath, eventsPath } = wayfindingPathsForState(statePath);
  const draftCheckpoint = fileCheckpoint(draftPath);
  const journalCheckpoint = fileCheckpoint(eventsPath);
  const workspaceId = workspaceIdentityForState(statePath);
  try {
    ensureWayfindingMigrationAnchor({ eventsPath, wayfindingPath: draftPath, workspaceId });
    assertWayfindingJournalMatchesCurrent(eventsPath, draftPath);
    const result = mutate(draftPath);
    const loaded = readWayfinding(draftPath);
    appendWayfindingEvent(eventsPath, {
      workspaceId,
      ...event(result, loaded),
      snapshot: loaded.draft,
      draftDigest: loaded.digest,
      coverage: readWayfindingEvents(eventsPath).coverage.complete ? "complete" : "partial",
      coverageReason: readWayfindingEvents(eventsPath).coverage.reason,
    });
    return { result, loaded };
  } catch (error) {
    restoreFileCheckpoint(draftPath, draftCheckpoint);
    restoreFileCheckpoint(eventsPath, journalCheckpoint);
    throw error;
  }
}

function sourceWayfindingBridge(statePath) {
  const { draftPath, eventsPath } = wayfindingPathsForState(statePath);
  if (!fs.existsSync(draftPath)) return null;
  const workspaceId = workspaceIdentityForState(statePath);
  ensureWayfindingMigrationAnchor({ eventsPath, wayfindingPath: draftPath, workspaceId });
  const journal = assertWayfindingJournalMatchesCurrent(eventsPath, draftPath);
  return {
    stream: journal.events.at(-1).stream,
    seq: journal.events.length,
    head_digest: journal.head_digest,
    draft_digest: sha256File(draftPath),
    coverage: journal.coverage.complete ? "complete" : "partial",
  };
}

function commandEnable(options) {
  const workspace = resolveWorkspace({
    root: options.get("root") ?? process.cwd(),
    mapflowHome: options.get("mapflow-home") ?? null,
    create: true,
  });
  let wayfindingInitialized = false;
  if (
    !fs.existsSync(workspace.mapPath)
    && !fs.existsSync(workspace.statePath)
    && !fs.existsSync(workspace.wayfindingPath)
  ) {
    const draftCheckpoint = fileCheckpoint(workspace.wayfindingPath);
    const journalCheckpoint = fileCheckpoint(workspace.wayfindingEventsPath);
    try {
      appendWayfindingEvent(workspace.wayfindingEventsPath, {
        workspaceId: workspace.workspace_id,
        type: "mapflow.workspace.enabled.v1",
        actor: "system:mapflow",
        subject: `workspace/${workspace.workspace_id}`,
        summary: "启用 Mapflow；此时尚无地图",
        reason: "为真实演化建立可验证的空白起点",
        target: { kind: "workspace", id: workspace.workspace_id },
        snapshot: null,
        coverage: "complete",
        details: { formal_nodes: 0, formal_edges: 0, sidecar_truth: "absent-before-enable" },
      });
      const written = writeWayfinding(workspace.wayfindingPath, initialWayfindingDraft());
      appendWayfindingEvent(workspace.wayfindingEventsPath, {
        workspaceId: workspace.workspace_id,
        type: "mapflow.wayfinding.initialized.v1",
        actor: "system:mapflow",
        subject: "node/workspace-origin-fog",
        summary: "建立始发地迷雾与目的地迷雾",
        reason: "从现场勘探问题开始，而不是预设正式地图",
        target: { kind: "node", id: "workspace-origin-fog" },
        snapshot: written.draft,
        draftDigest: written.digest,
        coverage: "complete",
      });
      wayfindingInitialized = true;
    } catch (error) {
      restoreFileCheckpoint(workspace.wayfindingPath, draftCheckpoint);
      restoreFileCheckpoint(workspace.wayfindingEventsPath, journalCheckpoint);
      throw error;
    }
  } else if (
    fs.existsSync(workspace.wayfindingPath)
    && !fs.existsSync(workspace.statePath)
    && !fs.existsSync(workspace.wayfindingEventsPath)
  ) {
    ensureWayfindingMigrationAnchor({
      eventsPath: workspace.wayfindingEventsPath,
      wayfindingPath: workspace.wayfindingPath,
      workspaceId: workspace.workspace_id,
    });
  }
  const wayfinding = fs.existsSync(workspace.wayfindingPath)
    ? readWayfinding(workspace.wayfindingPath).draft
    : null;
  const pendingQuestion = wayfinding?.questions.find((question) => (question.status ?? "pending") === "pending") ?? null;
  const summary = {
    schema: workspace.schema,
    workspace_id: workspace.workspace_id,
    workspace_root: workspace.workspace_root,
    workspace_kind: workspace.workspace_kind,
    sidecar: workspace.directory,
    created: workspace.created,
    map_exists: fs.existsSync(workspace.mapPath),
    wayfinding_exists: Boolean(wayfinding),
    wayfinding_initialized: wayfindingInitialized,
    state_exists: fs.existsSync(workspace.statePath),
    formal_topology: {
      present: fs.existsSync(workspace.mapPath),
      nodes: fs.existsSync(workspace.mapPath) ? null : 0,
      edges: fs.existsSync(workspace.mapPath) ? null : 0,
    },
    wayfinding: wayfinding ? {
      phase: wayfinding.phase,
      draft_nodes: 1 + (wayfinding.destination ? 1 : 0) + wayfinding.nodes.length,
      draft_edges: wayfinding.edges.length,
      current_question: pendingQuestion ? {
        id: pendingQuestion.id,
        prompt: pendingQuestion.prompt,
        target: pendingQuestion.target,
      } : null,
    } : null,
    paths: {
      manifest: workspace.manifestPath,
      map: workspace.mapPath,
      wayfinding: workspace.wayfindingPath,
      briefs: workspace.briefsPath,
      state: workspace.statePath,
      events: workspace.eventsPath,
      wayfinding_events: workspace.wayfindingEventsPath,
    },
    legacy_project_state: workspace.legacy_project_state,
  };
  if (options.has("json")) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${workspace.created ? "created" : "restored"} workspace sidecar: ${workspace.directory}\n`);
  process.stdout.write(`workspace root: ${workspace.workspace_root}\n`);
  process.stdout.write(`map: ${workspace.mapPath}${summary.map_exists ? "" : " (not shaped yet)"}\n`);
  if (wayfinding) {
    process.stdout.write(`wayfinding: ${workspace.wayfindingPath}${wayfindingInitialized ? " (initialized with origin and destination fog)" : ""}\n`);
    if (pendingQuestion) process.stdout.write(`current question: ${pendingQuestion.target.kind}:${pendingQuestion.target.id} - ${pendingQuestion.prompt}\n`);
  }
  if (workspace.legacy_project_state) {
    process.stdout.write("legacy .mapflow detected in the project; it was not imported or modified\n");
  }
}

function commandWayfindingAnswer(statePath, options) {
  const { draftPath } = wayfindingPathsForState(statePath);
  if (!fs.existsSync(draftPath)) fail(`wayfinding draft is missing: ${draftPath}`);
  const refs = options.get("evidence-ref")
    ? outcomeRefs(new Map([["outcome-ref", options.get("evidence-ref")]]))
    : [];
  const questionId = required(options, "question");
  const answer = required(options, "answer");
  const { result } = mutateWayfindingWithEvent(
    statePath,
    (answered) => ({
      type: "mapflow.wayfinding.question.answered.v1",
      actor: options.get("actor") ?? "human:owner",
      subject: `question/${answered.question.id}`,
      summary: `回答建模问题：${answered.question.prompt}`,
      reason: answered.question.answer,
      target: answered.question.target,
      details: {
        question_id: answered.question.id,
        answer: answered.question.answer,
        evidence_refs: answered.question.evidence_refs,
        applied_updates: answered.appliedUpdates,
        pending_updates: answered.pendingUpdates,
      },
    }),
    (targetPath) => answerWayfindingQuestion(targetPath, { questionId, answer, evidenceRefs: refs }),
  );
  process.stdout.write(`answered wayfinding question: ${result.question.id}; target: ${result.question.target.kind}:${result.question.target.id}\n`);
  process.stdout.write(`automatically advanced: ${result.appliedUpdates.join(", ") || "question status only"}\n`);
  process.stdout.write(`still requires modeling confirmation: ${result.pendingUpdates.join(", ") || "none"}\n`);
  process.stdout.write(`wayfinding draft refreshed: ${draftPath}\n`);
}

function isExplicitConfirmation(answer) {
  const value = String(answer ?? "").trim();
  if (!value || /(?:暂不|不|拒绝|取消)(?:确认|批准|同意|接受)|\b(?:do not|don't|reject|decline)\b/i.test(value)) return false;
  return /(?:确认|批准|同意|接受|是这样的|就是这样|就按这个)|\b(?:confirm|approve|agree|accept)(?:ed)?\b/i.test(value);
}

function assertAnsweredHumanConfirmation(current, candidate, { kind, id: targetId, label }) {
  const answered = [...(current?.questions ?? [])].reverse().find((question) => (
    question.target?.kind === kind
    && question.target.id === targetId
    && question.status === "answered"
  ));
  if (!answered) {
    fail(`${label} confirmation requires an answered wayfinding question for ${targetId}; record the later human answer with wayfinding-answer first`);
  }
  if (!answered.evidence_refs?.length) {
    fail(`${label} confirmation requires a source reference on answered question ${answered.id}`);
  }
  if (!isExplicitConfirmation(answered.answer)) {
    fail(`${label} confirmation requires an explicit human confirmation in answered question ${answered.id}; factual constraints or candidate revisions are not confirmation`);
  }
  const candidateAnswer = candidate.questions.find((question) => question.id === answered.id);
  if (candidateAnswer?.status !== "answered" || candidateAnswer.answer !== answered.answer) {
    fail(`${label} confirmation answer changed outside wayfinding-answer: ${answered.id}`);
  }
}

function assertDestinationConfirmationTransition(current, candidate) {
  const candidateDestinationConfirmed = new Set(["confirmed", "destination"]).has(candidate.destination?.status);
  const currentDestinationConfirmed = new Set(["confirmed", "destination"]).has(current?.destination?.status);
  if (candidateDestinationConfirmed && !currentDestinationConfirmed) {
    assertAnsweredHumanConfirmation(current, candidate, {
      kind: "destination",
      id: candidate.destination.id,
      label: "destination",
    });
  }

}

function commandWayfindingWrite(statePath, options) {
  if (fs.existsSync(statePath)) {
    fail("formal runtime already exists; preserve the bridged Wayfinding segment and register bounded changes with replan");
  }
  const { draftPath, eventsPath } = wayfindingPathsForState(statePath);
  const sourcePath = path.resolve(process.cwd(), required(options, "draft-file"));
  if (path.resolve(sourcePath) === path.resolve(draftPath)) fail("draft-file must be a separate candidate file");
  const { draft } = readWayfinding(sourcePath);
  const current = fs.existsSync(draftPath) ? readWayfinding(draftPath).draft : null;
  assertDestinationConfirmationTransition(current, draft);
  if (current && semanticWayfindingDigest(current) === semanticWayfindingDigest(draft)) {
    assertWayfindingJournalMatchesCurrent(eventsPath, draftPath);
    const digest = sha256File(draftPath);
    const summary = {
      path: path.resolve(draftPath),
      digest,
      phase: current.phase,
      nodes: current.nodes.length,
      edges: current.edges.length,
      questions: current.questions.length,
      changed: false,
    };
    process.stdout.write(options.has("json") ? `${JSON.stringify(summary, null, 2)}\n` : `wayfinding draft unchanged: ${draftPath}\n`);
    return;
  }
  const previousPhase = current?.phase ?? "empty";
  const { loaded: { digest } } = mutateWayfindingWithEvent(
    statePath,
    () => ({
      type: "mapflow.wayfinding.draft.written.v1",
      actor: options.get("actor") ?? "agent:codex",
      subject: `wayfinding/${draft.destination?.id ?? draft.origin.id}`,
      summary: `更新建模草稿：${previousPhase} → ${draft.phase}`,
      reason: options.get("reason") ?? "将已确认的建模结果投影到画板",
      target: draft.questions.find((question) => (question.status ?? "pending") === "pending")?.target
        ?? { kind: "destination", id: draft.destination.id },
      details: {
        previous_phase: previousPhase,
        phase: draft.phase,
        candidate_nodes: draft.nodes.length,
        candidate_edges: draft.edges.length,
      },
    }),
    (targetPath) => writeWayfinding(targetPath, draft),
  );
  const summary = {
    path: path.resolve(draftPath),
    digest,
    phase: draft.phase,
    nodes: draft.nodes.length,
    edges: draft.edges.length,
    questions: draft.questions.length,
    changed: true,
  };
  process.stdout.write(options.has("json") ? `${JSON.stringify(summary, null, 2)}\n` : `wrote validated wayfinding draft: ${draftPath}\n`);
}

function commandValidate(options) {
  const mapPath = path.resolve(process.cwd(), required(options, "map"));
  const { blueprint, digest, maps, bindings } = validateSubmapTree(mapPath);
  const summary = {
    map_id: blueprint.map_id,
    schema_version: blueprint.schema_version,
    nodes: blueprint.nodes.length,
    edges: blueprint.edges.length,
    maps,
    submap_bindings: bindings,
    digest,
  };
  process.stdout.write(options.has("json") ? `${JSON.stringify(summary, null, 2)}\n` : `valid blueprint: ${blueprint.map_id} (${blueprint.nodes.length} nodes, ${blueprint.edges.length} edges)\n`);
}

function commandInit(statePath, options) {
  if (fs.existsSync(statePath) && !options.has("force")) fail(`state already exists: ${statePath} (use --force to replace)`);
  const absoluteMap = path.resolve(process.cwd(), required(options, "map"));
  const { blueprint, digest, brief_digests: briefDigests, briefs } = validateSubmapTree(absoluteMap);
  const sourceWayfinding = sourceWayfindingBridge(statePath);
  const state = {
    schema: STATE_SCHEMA_VERSION,
    phase: "wayfinding",
    destination_status: "draft",
    map: mapPathForState(statePath, absoluteMap),
    map_digest: digest,
    map_id: blueprint.map_id,
    active_edge: null,
    active_run: null,
    runtime_status: "wayfinding",
    edge_runs: [],
    decisions: [],
    authorization_requests: [],
    arrival_audit_requests: [],
    arrival_checkpoints: [],
    successor_bindings: [],
    work_events: [],
    proposals: [],
    map_receipts: [],
    receipt_invalidations: [],
    event_stream: { path: "events.jsonl", last_seq: 0, head_digest: null },
    verified_edges: [],
    verified_edge_contracts: {},
    blueprint_snapshot: structuredClone(blueprint),
    brief_digests: { ...briefDigests },
    brief_snapshots: structuredClone(briefs),
    loop_iterations: Object.fromEntries(blueprint.loops.map((loop) => [loop.id, 0])),
    facts: initialFacts(blueprint),
    satisfied_nodes: [],
    last_proof: null,
    evidence: [],
    updated_at: now(),
    history: [],
  };
  const initialEventsPath = eventsPathForState(statePath, state);
  if (fs.existsSync(initialEventsPath)) {
    if (!options.has("force")) fail(`event stream already exists: ${initialEventsPath} (use --force to replace)`);
    fs.rmSync(initialEventsPath, { force: true });
  }
  refreshDerivedState(state, blueprint);
  record(state, "initialized", {
    structural: state.last_proof.structural,
    reachability: state.last_proof.reachability,
    ...(sourceWayfinding ? { source_wayfinding: sourceWayfinding } : {}),
  });
  saveState(statePath, state);
  process.stdout.write(`initialized ${statePath} from ${blueprint.map_id}\n`);
}

function commandStatus(statePath, options) {
  const state = loadState(statePath);
  const { blueprint, digest, briefs } = readStateBlueprint(statePath, state);
  const projectionBlueprint = digest === state.map_digest ? blueprint : state.blueprint_snapshot;
  const projection = {
    ...state,
    map_changed: digest !== state.map_digest,
    actual_arrival: state.phase === "arrived" ? "audited" : "not-audited",
    satisfied_nodes: deriveSatisfiedNodes(projectionBlueprint, state.facts),
    evidence_levels: runtimeEvidenceLevels(state, projectionBlueprint),
  };
  if (options.has("json")) {
    process.stdout.write(`${JSON.stringify(projection, null, 2)}\n`);
    return;
  }
  process.stdout.write(`phase: ${projection.phase}\n`);
  process.stdout.write(`destination: ${projection.destination_status}\n`);
  process.stdout.write(`map: ${projection.map_id}${projection.map_changed ? " (changed)" : ""}\n`);
  process.stdout.write(`proof: ${projection.last_proof.structural}/${projection.last_proof.reachability}\n`);
  process.stdout.write(`evidence_levels: ${Object.entries(projection.evidence_levels).map(([id, level]) => `${id}=${level.status}`).join(", ")}\n`);
  process.stdout.write(`actual_arrival: ${projection.actual_arrival}\n`);
  process.stdout.write(`active_edge: ${projection.active_edge ?? "-"}\n`);
  process.stdout.write(`active_run: ${projection.active_run ?? "-"}; runtime: ${projection.runtime_status}\n`);
  process.stdout.write(`pending_arrival_audits: ${projection.arrival_audit_requests.filter((request) => request.status === "pending").length}\n`);
  process.stdout.write(`verified_edges: ${projection.verified_edges.join(", ") || "-"}\n`);
  process.stdout.write(`satisfied_nodes: ${projection.satisfied_nodes.join(", ") || "-"}\n`);
  process.stdout.write(`evidence_records: ${projection.evidence.length}\n`);
}

function runtimeEvidenceLevels(state, blueprint) {
  const destinationObserved = blueprint.destination.requires.every((predicateId) => predicateSatisfied(predicateId, state.facts, blueprint));
  const acceptanceObserved = destinationAcceptanceReady(blueprint, state);
  const executedComplete = destinationObserved && acceptanceObserved;
  const readyEdges = readyEdgesFor(blueprint, state);
  return {
    ...structuredClone(state.last_proof.evidence_levels ?? {}),
    runtime_readiness: {
      status: state.active_run ? "active" : readyEdges.length > 0 ? "ready" : executedComplete ? "complete" : "blocked",
      ready_edges: readyEdges.map((entry) => entry.edge),
      active_edge: state.active_edge,
      basis: "observed facts, current proof, loop budget, and active run state",
    },
    executed_derivation: {
      status: executedComplete ? "complete" : state.verified_edges.length > 0 ? "partial" : "not-observed",
      verified_edges: [...state.verified_edges],
      basis: "trusted edge evidence has applied observed effects",
    },
    audited_arrival: {
      status: state.phase === "arrived" ? "established" : "not-observed",
      request: state.arrival_audit?.request ?? null,
      basis: "a designated human or Agent consumed the frozen arrival audit request",
    },
  };
}

function commandContext(statePath, options) {
  const state = loadState(statePath);
  const { blueprint, digest, briefs } = readStateBlueprint(statePath, state);
  assertMapUnchanged(statePath, state, digest);
  refreshDerivedState(state, blueprint);
  const layer = options.get("layer") ?? "focus";
  if (!new Set(["focus", "work", "evidence", "history"]).has(layer)) fail("context layer must be focus, work, evidence, or history");
  const readyEdges = readyEdgesFor(blueprint, state);
  const edgeId = options.get("edge") ?? state.active_edge ?? (readyEdges.length === 1 ? readyEdges[0].edge : null);
  const edge = edgeId === null ? null : blueprint.edges.find((item) => item.id === edgeId);
  if (edgeId !== null && !edge) fail(`unknown context edge: ${edgeId}`);
  const brief = edge ? briefs[edge.id] : null;
  const handoff = brief?.metadata?.contract?.handoff ?? null;
  const disclosure = brief?.metadata?.contract?.context ?? null;
  const budget = structuredClone(disclosure?.budget ?? { max_files: 8, max_chars: 50000 });
  const output = {
    schema: "mapflow.context-pack/v1",
    layer,
    map: {
      id: blueprint.map_id,
      destination: blueprint.destination.statement,
      phase: state.phase,
      actual_arrival: state.phase === "arrived" ? "audited" : "not-audited",
    },
    evidence_levels: runtimeEvidenceLevels(state, blueprint),
    focus: edge ? {
      edge: edge.id,
      title: brief?.metadata?.title ?? edge.id,
      from: edge.from,
      to: edge.to,
      effects: [...edge.effects],
      status: state.active_edge === edge.id ? "active" : readyEdges.some((entry) => entry.edge === edge.id) ? "ready" : state.verified_edges.includes(edge.id) ? "verified" : "blocked",
      handoff: structuredClone(handoff),
      context: disclosure ? {
        focus: disclosure.focus,
        load_first: [...disclosure.load_first],
        budget: structuredClone(disclosure.budget),
      } : null,
    } : {
      edge: null,
      ready_edges: readyEdges.map((entry) => entry.edge),
      note: readyEdges.length > 1 ? "choose one ready edge before loading work context" : "no active or uniquely ready edge",
    },
    available_layers: ["focus", "work", "evidence", "history"],
    budget: {
      ...budget,
      declared_load_first: disclosure?.load_first?.length ?? 0,
      included_chars: 0,
      within_budget: true,
    },
  };
  if (layer === "work" && edge) {
    output.work = {
      edge: structuredClone(edge),
      from_node: structuredClone(blueprint.nodes.find((node) => node.id === edge.from)),
      to_node: structuredClone(blueprint.nodes.find((node) => node.id === edge.to)),
      applicable_invariants: structuredClone(blueprint.invariants.filter((invariant) => edge.invariants.includes(invariant.id))),
      brief: structuredClone(brief),
      load_on_demand: structuredClone(disclosure?.load_on_demand ?? []),
    };
  } else if (layer === "evidence") {
    output.evidence = {
      edge: edgeId,
      records: structuredClone(edgeId ? state.evidence.filter((record) => record.edge === edgeId) : state.evidence),
      acceptance: structuredClone(blueprint.destination.acceptance),
      proposals: structuredClone((state.proposals ?? []).filter((proposal) => proposal.status === "pending")),
    };
  } else if (layer === "history") {
    const limit = Number(options.get("limit") ?? 20);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail("context history limit must be an integer from 1 to 100");
    output.history = structuredClone(state.history.filter((entry) => (
      !edgeId
      || (!entry.edge && !entry.details?.edge)
      || entry.edge === edgeId
      || entry.details?.edge === edgeId
    )).slice(-limit));
  }
  for (let pass = 0; pass < 3; pass += 1) {
    output.budget.included_chars = JSON.stringify(output).length;
  }
  output.budget.within_budget = output.budget.included_chars <= output.budget.max_chars;
  if (!output.budget.within_budget) {
    fail(`context ${layer} exceeds ${output.budget.max_chars} chars; narrow the edge/history limit, summarize references, or split the Work Edge`);
  }
  if (options.has("json")) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }
  process.stdout.write(`context ${layer}: ${blueprint.map_id}\n`);
  process.stdout.write(`destination: ${blueprint.destination.statement}\n`);
  process.stdout.write(edge ? `edge: ${edge.id} (${output.focus.status})\n` : `ready edges: ${output.focus.ready_edges.join(", ") || "none"}\n`);
  if (disclosure) process.stdout.write(`focus: ${disclosure.focus}\nload first: ${disclosure.load_first.join(", ")}\n`);
}

function commandProve(statePath, options) {
  if (options.has("map")) {
    const absoluteMap = path.resolve(process.cwd(), required(options, "map"));
      const { blueprint } = validateSubmapTree(absoluteMap);
    const proof = proveBlueprint(blueprint);
    process.stdout.write(options.has("json") ? `${JSON.stringify(proof, null, 2)}\n` : `proof: ${proof.structural}/${proof.reachability}; gaps: ${proof.proof_gaps.length}\n`);
    return;
  }
  const state = loadState(statePath);
  const pendingArrivalAudit = state.arrival_audit_requests.find((request) => request.status === "pending");
  if (pendingArrivalAudit) {
    fail(`cannot refresh proof while arrival audit request is pending: ${pendingArrivalAudit.id}; answer it with arrive --request ${pendingArrivalAudit.id}, or replan explicitly if the audited result is no longer acceptable`);
  }
  const { blueprint, digest, brief_digests: briefDigests } = readStateBlueprint(statePath, state);
  assertMapUnchanged(statePath, state, digest);
  assertVerifiedEdgesPreserved(state, blueprint, briefDigests);
  refreshDerivedState(state, blueprint);
  record(state, "reachability_proved", { structural: state.last_proof.structural, reachability: state.last_proof.reachability, gaps: state.last_proof.proof_gaps.length });
  saveState(statePath, state);
  process.stdout.write(options.has("json") ? `${JSON.stringify(state.last_proof, null, 2)}\n` : `proof: ${state.last_proof.structural}/${state.last_proof.reachability}; gaps: ${state.last_proof.proof_gaps.length}\n`);
}

function ensureApprovableProof(state) {
  if (state.last_proof.structural !== "complete") fail("edge execution requires a structurally complete map");
  if (state.last_proof.reachability === "unreachable") fail("edge execution requires a logical or conditional route");
}

function currentProofDigest(state) {
  return crypto.createHash("sha256").update(stableJson(state.last_proof)).digest("hex");
}

function requestDecisionOwner(options) {
  const owner = options.get("decision-owner") ?? "human:owner";
  if (!/^(?:human|agent):/.test(owner)) fail("decision-owner must use human:<identity> or agent:<identity>");
  return owner;
}

function commandAssignDecisionOwner(statePath, options) {
  const state = loadState(statePath);
  const requestId = required(options, "request");
  const owner = required(options, "decision-owner");
  if (!/^(?:human|agent):/.test(owner)) fail("decision-owner must use human:<identity> or agent:<identity>");
  const actor = options.get("actor") ?? "agent:codex";
  if (!/^(agent|human):/.test(actor)) fail("decision owner assignment actor must use agent:<identity> or human:<identity>");
  const pending = [
    ...state.authorization_requests,
    ...state.arrival_audit_requests,
  ].filter((request) => request.id === requestId && request.status === "pending");
  if (pending.length === 0) fail(`pending human request is missing: ${requestId}`);
  if (pending.length > 1) fail(`pending human request id is ambiguous: ${requestId}`);
  const request = pending[0];
  const previousOwner = request.decision_owner ?? null;
  request.decision_owner = owner;
  if (state.arrival_audit_requests.includes(request)) {
    request.state_revision = (state.event_stream?.last_seq ?? 0) + 1;
  }
  record(state, "decision_owner_assigned", {
    request: request.id,
    previous_owner: previousOwner,
    decision_owner: owner,
    actor,
  });
  saveState(statePath, state);
  const output = { request_id: request.id, previous_owner: previousOwner, decision_owner: owner, status: request.status };
  process.stdout.write(options.has("json") ? `${JSON.stringify(output, null, 2)}\n` : `decision owner assigned for ${request.id}: ${owner}\n`);
}

function assertDecisionOwner(request, actor, label) {
  if (!request.decision_owner) {
    fail(`${label} decision owner is missing; use assign-decision-owner before answering ${request.id}`);
  }
  if (actor !== request.decision_owner) {
    fail(`${label} actor must match decision owner ${request.decision_owner}`);
  }
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

function commandStart(statePath, options) {
  const state = loadState(statePath);
  if (state.phase === "arrived") fail("cannot start an edge on an arrived map");
  if (state.active_edge !== null) fail(`active edge is still running: ${state.active_edge}`);
  if (state.authorization_requests.some((request) => request.status === "pending")) {
    fail("answer the pending edge authorization request before starting another edge");
  }
  const { blueprint, digest, briefs } = readStateBlueprint(statePath, state);
  assertMapUnchanged(statePath, state, digest);
  const entered = enterImplementation(state, blueprint);
  const edgeId = required(options, "edge");
  if (state.verified_edges.includes(edgeId) && loopsForEdge(blueprint, edgeId).length === 0) {
    fail(`edge already verified: ${edgeId}`);
  }
  ensureReadyEdge(blueprint, state, edgeId);
  if (edgeNeedsAuthorization(briefs, edgeId)) {
    fail(`edge ${edgeId} declares an authorization requirement; use request-authorization`);
  }
  const actor = options.get("actor") ?? "agent:codex";
  if (!/^(?:human|agent):/.test(actor)) fail("start actor must use human:<identity> or agent:<identity>");
  const reason = options.get("reason") ?? "selected from the current proven ready edges";
  const decision = createDecision(state, blueprint, edgeId, reason, actor);
  const run = startEdgeRun(state, edgeId, decision);
  if (entered) record(state, "implementation_entered", { proof_digest: currentProofDigest(state), actor });
  record(state, "edge_started", { edge: edgeId, run: run.id, decision: decision.id, reason, actor });
  saveState(statePath, state);
  process.stdout.write(`started ready edge: ${edgeId}; active run: ${run.id}\n`);
}

function commandRequestAuthorization(statePath, options) {
  const state = loadState(statePath);
  if (state.phase === "arrived") fail("cannot authorize an edge on an arrived map");
  if (state.active_edge !== null) fail(`active edge is still running: ${state.active_edge}`);
  if (state.authorization_requests.some((request) => request.status === "pending")) fail("another edge authorization request is pending");
  const { blueprint, digest, briefs } = readStateBlueprint(statePath, state);
  assertMapUnchanged(statePath, state, digest);
  const entered = enterImplementation(state, blueprint);
  const edgeId = required(options, "edge");
  const question = required(options, "question");
  const requester = options.get("requester") ?? "agent:codex";
  const decisionOwner = requestDecisionOwner(options);
  if (state.verified_edges.includes(edgeId) && loopsForEdge(blueprint, edgeId).length === 0) {
    fail(`edge already verified: ${edgeId}`);
  }
  ensureReadyEdge(blueprint, state, edgeId);
  if (!edgeNeedsAuthorization(briefs, edgeId)) {
    fail(`edge ${edgeId} has no declared authorization requirement; use start`);
  }
  const request = {
    id: nextSemanticId(state.authorization_requests, edgeId, "authorization"),
    edge: edgeId,
    question,
    requested_by: requester,
    decision_owner: decisionOwner,
    requested_at: now(),
    status: "pending",
  };
  state.authorization_requests.push(request);
  state.runtime_status = "authorization-required";
  if (entered) record(state, "implementation_entered", { proof_digest: currentProofDigest(state), actor: requester });
  record(state, "edge_authorization_requested", { request: request.id, edge: edgeId, question, decision_owner: decisionOwner, actor: requester });
  saveState(statePath, state);
  const output = { request_id: request.id, edge: edgeId, status: request.status, question, decision_owner: decisionOwner };
  process.stdout.write(options.has("json") ? `${JSON.stringify(output, null, 2)}\n` : `authorization requested for edge ${edgeId}: ${request.id}\n`);
}

function commandAuthorize(statePath, options) {
  const state = loadState(statePath);
  if (state.phase !== "implementation" || !destinationConfirmed(state)) {
    fail("authorize requires a confirmed destination in implementation phase");
  }
  if (state.active_edge !== null) fail(`active edge is still running: ${state.active_edge}`);
  const requestId = required(options, "request");
  const answer = required(options, "answer");
  const actor = options.get("actor") ?? "human:owner";
  if (!/^(?:human|agent):/.test(actor)) fail("edge authorization actor must use human:<identity> or agent:<identity>");
  const request = state.authorization_requests.find((item) => item.id === requestId);
  if (!request) fail(`authorization request is missing: ${requestId}`);
  if (request.status !== "pending") fail(`authorization request is not pending: ${requestId}`);
  assertDecisionOwner(request, actor, "edge authorization");
  const { blueprint, digest } = readStateBlueprint(statePath, state);
  assertMapUnchanged(statePath, state, digest);
  if (state.verified_edges.includes(request.edge) && loopsForEdge(blueprint, request.edge).length === 0) {
    fail(`edge already verified: ${request.edge}`);
  }
  ensureReadyEdge(blueprint, state, request.edge);
  request.status = "granted";
  request.answer = answer;
  request.authorized_by = actor;
  request.authorized_at = now();
  const decision = createDecision(state, blueprint, request.edge, answer, actor, request);
  const run = startEdgeRun(state, request.edge, decision, request);
  record(state, "edge_authorized", { request: request.id, edge: request.edge, run: run.id, decision: decision.id, answer, actor });
  saveState(statePath, state);
  process.stdout.write(`authorized edge: ${request.edge}; active run: ${run.id}\n`);
}

function commandDeclineAuthorization(statePath, options) {
  const state = loadState(statePath);
  const requestId = required(options, "request");
  const reason = required(options, "reason");
  const actor = options.get("actor") ?? "human:owner";
  if (!actor.startsWith("human:")) fail("edge authorization actor must use human:<identity>");
  const request = state.authorization_requests.find((item) => item.id === requestId);
  if (!request) fail(`authorization request is missing: ${requestId}`);
  if (request.status !== "pending") fail(`authorization request is not pending: ${requestId}`);
  assertDecisionOwner(request, actor, "edge authorization");
  request.status = "declined";
  request.answer = reason;
  request.authorized_by = actor;
  request.authorized_at = now();
  state.runtime_status = dormantRuntimeStatus(state);
  record(state, "edge_authorization_declined", { request: request.id, edge: request.edge, reason, actor });
  saveState(statePath, state);
  process.stdout.write(`declined edge authorization: ${request.id}\n`);
}

function commandSelect() {
  fail("select no longer activates work; use start for an unprotected ready edge, or request-authorization for a protected edge");
}

function commandPauseRun(statePath, options, status) {
  const state = loadState(statePath);
  if (state.phase !== "implementation" || !destinationConfirmed(state)) fail(`${status} requires implementation phase`);
  const reason = required(options, "reason");
  const actor = options.get("actor") ?? "human:owner";
  const run = transitionRun(state, status, status === "waiting" ? { waiting_reason: reason } : { blocking_reason: reason });
  record(state, `edge_run_${status}`, { edge: run.edge, run: run.id, reason, actor });
  saveState(statePath, state);
  process.stdout.write(`${status} Edge Run: ${run.id}\n`);
}

function commandResume(statePath, options) {
  const state = loadState(statePath);
  if (state.phase !== "implementation" || !destinationConfirmed(state)) fail("resume requires implementation phase");
  if (state.active_run !== null) fail(`another Edge Run is active: ${state.active_run}`);
  if (state.authorization_requests.some((request) => request.status === "pending")) fail("answer the pending edge authorization request before resuming another run");
  const runId = required(options, "run");
  const reason = required(options, "reason");
  const actor = options.get("actor") ?? "human:owner";
  const run = state.edge_runs.find((item) => item.id === runId);
  if (!run || !new Set(["waiting", "blocked"]).has(run.status)) fail(`run is not waiting or blocked: ${runId}`);
  const authorization = run.authorization_request === null
    ? null
    : state.authorization_requests.find((request) => request.id === run.authorization_request);
  if (run.authorization_request !== null && (!authorization || authorization.status !== "granted")) {
    fail(`run authorization is no longer valid: ${runId}; request fresh authorization`);
  }
  const { blueprint, digest } = readStateBlueprint(statePath, state);
  assertMapUnchanged(statePath, state, digest);
  ensureReadyEdge(blueprint, state, run.edge);
  run.status = "active";
  run.updated_at = now();
  delete run.waiting_reason;
  delete run.blocking_reason;
  state.active_run = run.id;
  state.active_edge = run.edge;
  state.runtime_status = "running";
  record(state, "edge_run_resumed", { edge: run.edge, run: run.id, reason, actor });
  saveState(statePath, state);
  process.stdout.write(`resumed Edge Run: ${run.id}\n`);
}

function commandCancel(statePath, options) {
  const state = loadState(statePath);
  const runId = options.get("run") ?? state.active_run;
  if (!runId) fail("run is required when no Edge Run is active");
  const reason = required(options, "reason");
  const actor = options.get("actor") ?? "human:owner";
  const run = state.edge_runs.find((item) => item.id === runId);
  if (!run || !new Set(["active", "waiting", "blocked"]).has(run.status)) fail(`run cannot be cancelled from status: ${run?.status ?? "missing"}`);
  run.status = "cancelled";
  run.updated_at = now();
  run.cancel_reason = reason;
  if (state.active_run === run.id) {
    state.active_run = null;
    state.active_edge = null;
  }
  state.runtime_status = dormantRuntimeStatus(state);
  record(state, "edge_run_cancelled", { edge: run.edge, run: run.id, reason, actor });
  saveState(statePath, state);
  process.stdout.write(`cancelled Edge Run: ${run.id}\n`);
}

function semanticId(value, label) {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value ?? "")) fail(`${label} must be a semantic slug`);
  return value;
}

function commandPropose(statePath, options) {
  const state = loadState(statePath);
  const proposalId = semanticId(required(options, "id"), "id");
  if (state.proposals.some((proposal) => proposal.id === proposalId)) fail(`proposal already exists: ${proposalId}`);
  const factId = semanticId(required(options, "fact"), "fact");
  const value = required(options, "value");
  if (!TRUTH_VALUES.has(value)) fail(`invalid proposed fact value: ${value}`);
  const { blueprint, digest } = readStateBlueprint(statePath, state);
  assertMapUnchanged(statePath, state, digest);
  if (!blueprint.predicates.some((predicate) => predicate.fact === factId)) fail(`fact is not referenced by the Blueprint: ${factId}`);
  const source = required(options, "source");
  const summary = required(options, "summary");
  const actor = options.get("actor") ?? "human:owner";
  const strength = required(options, "strength");
  if (!EVIDENCE_STRENGTHS.has(strength)) fail(`invalid evidence strength: ${strength}`);
  const refs = outcomeRefs(options).map((ref) => ({ ...ref, strength }));
  if (refs.length === 0) fail("outcome-ref is required for a Fact Proposal");
  const workEvent = {
    id: `${proposalId}-event`,
    source,
    summary,
    actor,
    observed_at: now(),
    evidence_refs: refs,
  };
  const proposal = {
    id: proposalId,
    type: "observe-fact",
    status: "pending",
    fact: factId,
    value,
    strength,
    work_event: workEvent.id,
    base_revision: state.event_stream?.head_digest ?? state.map_digest,
    created_seq: (state.event_stream?.last_seq ?? 0) + 1,
    created_at: now(),
  };
  state.work_events.push(workEvent);
  state.proposals.push(proposal);
  record(state, "proposal_created", { proposal: proposal.id, work_event: workEvent.id, fact: factId, value, source, actor });
  saveState(statePath, state);
  process.stdout.write(`created Proposal: ${proposal.id}; Fact unchanged until confirmation\n`);
}

function commandProposalConfirm(statePath, options) {
  const state = loadState(statePath);
  const proposalId = semanticId(required(options, "proposal"), "proposal");
  const actor = required(options, "by");
  const proposal = state.proposals.find((item) => item.id === proposalId);
  if (!proposal || proposal.status !== "pending") fail(`proposal is not pending: ${proposalId}`);
  if ((state.event_stream?.last_seq ?? 0) !== proposal.created_seq) {
    proposal.status = "stale";
    proposal.reviewed_at = now();
    proposal.reviewed_by = actor;
    record(state, "proposal_stale", { proposal: proposal.id, expected_seq: proposal.created_seq, actual_seq: state.event_stream?.last_seq ?? 0, by: actor });
    saveState(statePath, state);
    fail(`proposal base revision is stale: ${proposalId}`);
  }
  const workEvent = state.work_events.find((item) => item.id === proposal.work_event);
  const recordedAt = now();
  const previousEvidence = state.facts[proposal.fact]?.evidence ?? [];
  state.facts[proposal.fact] = {
    value: proposal.value,
    evidence: [
      ...previousEvidence,
      ...workEvent.evidence_refs.map((ref) => ({ ...ref, observed_at: recordedAt, source_event: workEvent.id })),
    ],
  };
  proposal.status = "confirmed";
  proposal.reviewed_at = recordedAt;
  proposal.reviewed_by = actor;
  const { blueprint, digest } = readStateBlueprint(statePath, state);
  assertMapUnchanged(statePath, state, digest);
  refreshDerivedState(state, blueprint);
  record(state, "proposal_confirmed", { proposal: proposal.id, fact: proposal.fact, value: proposal.value, by: actor });
  saveState(statePath, state);
  process.stdout.write(`confirmed Proposal: ${proposal.id}; Fact ${proposal.fact}=${proposal.value}\n`);
}

function commandProposalReject(statePath, options) {
  const state = loadState(statePath);
  const proposalId = semanticId(required(options, "proposal"), "proposal");
  const reason = required(options, "reason");
  const actor = required(options, "by");
  const proposal = state.proposals.find((item) => item.id === proposalId);
  if (!proposal || proposal.status !== "pending") fail(`proposal is not pending: ${proposalId}`);
  proposal.status = "rejected";
  proposal.reviewed_at = now();
  proposal.reviewed_by = actor;
  proposal.review_reason = reason;
  record(state, "proposal_rejected", { proposal: proposal.id, reason, by: actor });
  saveState(statePath, state);
  process.stdout.write(`rejected Proposal: ${proposal.id}\n`);
}

function commandGate(statePath) {
  const state = loadState(statePath);
  if (state.phase !== "implementation" || !destinationConfirmed(state) || state.active_edge === null || !activeRun(state)) {
    process.stderr.write("write gate blocked: start a proven ready edge, or grant its declared authorization requirement first\n");
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
  if (state.phase !== "implementation" || !destinationConfirmed(state)) {
    fail("verify requires a confirmed destination in implementation phase");
  }
  const edgeId = required(options, "edge");
  if (state.active_edge !== edgeId) fail(`verify must name active edge ${JSON.stringify(state.active_edge)}`);
  const { blueprint, digest, brief_digests: briefDigests, briefs, absolute: mapPath } = readStateBlueprint(statePath, state);
  assertMapUnchanged(statePath, state, digest);
  const edge = ensureReadyEdge(blueprint, state, edgeId);
  const causalContract = normalizeCausalContract(blueprint, edge);
  const mode = options.get("mode") ?? "reported";
  if (!new Set(["reported", "executed"]).has(mode)) fail("verify mode must be reported or executed");
  const claim = required(options, "evidence");
  const executor = required(options, "executor");
  const actualModel = options.get("model");
  const actualReasoning = options.get("reasoning");
  if ((actualModel === undefined) !== (actualReasoning === undefined)) {
    fail("model and reasoning must be provided together");
  }
  if (executor.startsWith("agent:") && actualModel === undefined) {
    fail("agent executor requires model and reasoning");
  }
  let capability = null;
  let executedCheck = null;
  let verifier = null;
  let result;
  let observed;
  let command;
  let declaredProves;
  if (mode === "executed") {
    for (const forbidden of ["command", "observed", "result", "proves", "cwd"]) {
      if (options.has(forbidden)) fail(`executed verification reads ${forbidden} from the frozen Task Brief or process result; --${forbidden} is not accepted`);
    }
    const verifierId = required(options, "verifier");
    verifier = briefs[edgeId]?.metadata?.contract?.verification?.commands?.find((entry) => entry.id === verifierId) ?? null;
    if (!verifier) fail(`Task Brief for ${edgeId} does not declare verifier: ${verifierId}`);
    declaredProves = [...verifier.proves];
    const requiredProofs = new Set(edge.evidence_contract.filter((contract) => contract.required).flatMap((contract) => contract.proves));
    const missingProofs = [...requiredProofs].filter((predicateId) => !declaredProves.includes(predicateId));
    if (missingProofs.length > 0) fail(`verifier does not cover required evidence predicates: ${missingProofs.join(", ")}`);
    const missingConclusions = causalContract.conclusions.filter((predicateId) => !declaredProves.includes(predicateId));
    if (missingConclusions.length > 0) fail(`verifier does not cover causal conclusions: ${missingConclusions.join(", ")}`);
    capability = capabilityFor(state, required(options, "capability"), edgeId, "run_verifier", verifier);
    const workspaceRoot = options.get("_workspace-root") ?? process.cwd();
    executedCheck = runVerifier(verifier, workspaceRoot, path.dirname(mapPath));
    command = executedCheck.command;
    result = executedCheck.result;
    observed = executedCheck.stdout.trim() || executedCheck.stderr.trim() || `exit code ${executedCheck.exit_code}`;
  } else {
    command = required(options, "command");
    result = required(options, "result");
    observed = required(options, "observed");
    if (!new Set(["pass", "fail"]).has(result)) fail(`invalid verification result: ${result}`);
    declaredProves = csv(options, "proves");
    if (result === "pass" && declaredProves.length === 0) fail("proves is required for a passing verification report");
    if (result === "fail" && declaredProves.length > 0) fail("a failed verification report cannot claim edge effects");
    const unknownProves = declaredProves.filter((predicateId) => !edge.effects.includes(predicateId));
    if (unknownProves.length > 0) fail(`evidence claims predicates outside edge effects: ${unknownProves.join(", ")}`);
  }
  const proves = result === "pass" ? declaredProves : [];

  const requestedAcceptanceIds = csv(options, "acceptance");
  const acceptanceMap = new Map(blueprint.destination.acceptance.map((item) => [item.id, item]));
  for (const acceptanceId of requestedAcceptanceIds) {
    const acceptance = acceptanceMap.get(acceptanceId);
    if (!acceptance) fail(`unknown acceptance id: ${acceptanceId}`);
    if (!acceptance.proves.some((predicateId) => declaredProves.includes(predicateId))) {
      fail(`edge evidence does not contribute to acceptance: ${acceptanceId}`);
    }
  }
  const acceptanceIds = result === "pass" ? requestedAcceptanceIds : [];

  const limits = {
    simulated: csv(options, "simulated"),
    inferred: csv(options, "inferred"),
    unverified: csv(options, "unverified"),
    product_unknowns: csv(options, "product-unknown"),
  };
  const realizedBy = outcomeRefs(options);
  const recordedAt = now();
  const evidence = {
    id: `${edgeId}-evidence-${state.evidence.length + 1}`,
    edge: edgeId,
    run: state.active_run,
    claim,
    proves,
    acceptance_ids: acceptanceIds,
    outcome_refs: realizedBy,
    checks: mode === "executed"
      ? [{
        command,
        result,
        observed: observed.slice(0, 2000),
        mode: "executed",
        exit_code: executedCheck.exit_code,
        signal: executedCheck.signal,
        stdout_digest: executedCheck.stdout_digest,
        stderr_digest: executedCheck.stderr_digest,
        started_at: executedCheck.started_at,
        finished_at: executedCheck.finished_at,
      }]
      : [{ command, result, observed, mode: "reported" }],
    limits,
    executor,
    trust: mode === "executed" ? "verified" : "reported",
    ...(capability === null ? {} : { capability: capability.id }),
    ...(actualModel === undefined ? {} : { agent: { model: actualModel, reasoning: actualReasoning } }),
    recorded_at: recordedAt,
  };
  if (mode === "executed" && result === "pass" && limits.unverified.length === 0) {
    const witnesses = [
      ...edge.evidence_contract.filter((contract) => contract.required).map((contract) => contract.id),
      verifier.id,
      ...realizedBy.map((entry) => entry.ref),
    ];
    evidence.proof_certificate = createProofCertificate({
      blueprint,
      edge,
      facts: state.facts,
      run: state.active_run,
      evidence: evidence.id,
      witnesses,
      verifier: { id: verifier.id, digest: verifierDigest(verifier), proves: [...declaredProves] },
      mapDigest: digest,
      briefDigest: briefDigests[edgeId],
      recordedAt,
    });
  }
  state.evidence.push(evidence);
  if (mode === "reported") {
    record(state, "edge_verification_reported", { edge: edgeId, run: state.active_run, evidence: evidence.id, claimed_result: result, claimed_proves: proves, executor });
    saveState(statePath, state);
    process.stdout.write(`recorded untrusted verification report for edge: ${edgeId}; facts unchanged\n`);
    return;
  }
  if (result === "fail") {
    const failedRun = transitionRun(state, "failed", { failure: { claim, observed, action: edge.on_failure.action } });
    if (edge.on_failure.action === "replan") {
      state.phase = "wayfinding";
      state.destination_status = "changed";
      state.runtime_status = "needs-replan";
    } else if (edge.on_failure.action === "stop") {
      state.runtime_status = "stopped";
    } else {
      const branchEdge = edge.on_failure.to;
      try {
        ensureReadyEdge(blueprint, state, branchEdge);
        state.pending_branch = branchEdge;
        state.runtime_status = "authorization-required";
        record(state, "edge_failed_branch_available", { edge: edgeId, run: failedRun.id, branch_edge: branchEdge, actor: "system:mapflow" });
      } catch (error) {
        state.runtime_status = "blocked";
        state.pending_branch = branchEdge;
        record(state, "edge_failed_branch_blocked", { edge: edgeId, run: failedRun.id, branch_edge: branchEdge, reason: error.message, actor: "system:mapflow" });
      }
    }
    if (edge.on_failure.action !== "branch") {
      record(state, `edge_failed_${edge.on_failure.action}`, { edge: edgeId, run: failedRun.id, action: edge.on_failure.action, actor: "system:mapflow" });
    }
    saveState(statePath, state);
    fail(`edge verification failed: ${edgeId}; on_failure ${edge.on_failure.action} applied`);
  }
  if (limits.unverified.length > 0) {
    const blockedRun = transitionRun(state, "blocked", { blocking_reason: `unverified: ${limits.unverified.join(", ")}` });
    record(state, "edge_verification_blocked", { edge: edgeId, run: blockedRun.id, unverified: limits.unverified });
    saveState(statePath, state);
    fail(`edge verification has unverified limits: ${edgeId}`);
  }

  if (mode === "executed") {
    verifyProofCertificate(evidence.proof_certificate, {
      blueprint,
      edge,
      facts: state.facts,
      run: state.active_run,
      evidence: evidence.id,
      mapDigest: digest,
      briefDigest: briefDigests[edgeId],
      verifier: { id: verifier.id, digest: verifierDigest(verifier), proves: [...declaredProves] },
      requiredWitnesses: edge.evidence_contract.filter((contract) => contract.required).map((contract) => contract.id),
    });
  }

  const proofEvidence = evidence.proof_certificate === undefined ? [] : [{
    kind: "observation",
    ref: `proof-certificate:${evidence.proof_certificate.certificate_digest}`,
    observed_at: recordedAt,
    strength: "corroborated",
  }];
  applyPredicateFacts(state, blueprint, proves, [
    { kind: "command", ref: `${command} -> ${observed}`, observed_at: recordedAt, strength: "observed" },
    ...proofEvidence,
    ...realizedBy.map((entry) => ({ ...entry, observed_at: recordedAt, strength: entry.strength ?? "observed" })),
  ]);
  if (!state.verified_edges.includes(edgeId)) state.verified_edges.push(edgeId);
  state.verified_edge_contracts[edgeId] = frozenEdgeContract(blueprint, briefDigests, edgeId);
  for (const loop of loopsForEdge(blueprint, edgeId)) state.loop_iterations[loop.id] += 1;
  const passedRun = transitionRun(state, "passed", { evidence_ids: [evidence.id] });
  refreshDerivedState(state, blueprint);
  record(state, "edge_verified", { edge: edgeId, run: passedRun.id, proves, acceptance: acceptanceIds, executor });
  saveState(statePath, state);
  process.stdout.write(`verified edge by executed check: ${edgeId}; satisfied nodes: ${state.satisfied_nodes.join(", ") || "-"}\n`);
}

function childAcceptanceEvidence(childState, acceptance) {
  const records = childState.evidence.filter((recordEntry) => (
    recordEntry.acceptance_ids?.includes(acceptance.id)
    && recordEntry.checks?.some((check) => check.result === "pass" && check.mode !== "reported")
    && (recordEntry.limits?.unverified?.length ?? 0) === 0
  ));
  const proven = new Set(records.flatMap((recordEntry) => recordEntry.proves ?? []));
  const missing = acceptance.proves.filter((predicateId) => !proven.has(predicateId));
  return { records, missing };
}

function commandVerifySubmap(statePath, options) {
  const state = loadState(statePath);
  if (state.phase !== "implementation" || !destinationConfirmed(state)) fail("verify-submap requires implementation phase");
  const edgeId = required(options, "edge");
  if (state.active_edge !== edgeId || !activeRun(state)) fail(`verify-submap must name active edge ${JSON.stringify(state.active_edge)}`);
  const actor = required(options, "executor");
  const { blueprint, digest, brief_digests: briefDigests, absolute } = readStateBlueprint(statePath, state);
  assertMapUnchanged(statePath, state, digest);
  const edge = ensureReadyEdge(blueprint, state, edgeId);
  const binding = blueprint.submaps.find((item) => item.parent_edge === edgeId);
  if (!binding) fail(`edge has no submap binding: ${edgeId}`);
  const parentDirectory = path.dirname(absolute);
  const childMapPath = path.resolve(parentDirectory, binding.map_ref.replaceAll("/", path.sep));
  const childStatePath = path.resolve(parentDirectory, binding.state_ref.replaceAll("/", path.sep));
  const childLoaded = readBlueprint(childMapPath);
  if (childLoaded.blueprint.map_id !== binding.expected_map_id) {
    fail(`submap identity mismatch: expected ${binding.expected_map_id}, found ${childLoaded.blueprint.map_id}`);
  }
  if (childLoaded.digest !== binding.expected_map_digest) {
    fail(`submap Blueprint is stale: expected ${binding.expected_map_digest}, found ${childLoaded.digest}; restore the pinned child version or initialize a successor parent map`);
  }
  const childState = loadState(childStatePath);
  if (childState.map_id !== binding.expected_map_id || childState.map_digest !== childLoaded.digest) fail("submap runtime is stale against its Blueprint");
  if (childState.phase !== "arrived" || !childState.arrival_audit) fail("submap has not completed an arrival audit");

  const acceptanceMap = new Map(childLoaded.blueprint.destination.acceptance.map((item) => [item.id, item]));
  const receiptAcceptance = [];
  const parentPredicates = new Set();
  for (const exported of binding.exports) {
    const acceptance = acceptanceMap.get(exported.child_acceptance);
    if (!acceptance) fail(`submap export references unknown child acceptance: ${exported.child_acceptance}`);
    if (!childState.arrival_audit.acceptance.includes(acceptance.id)) fail(`submap arrival did not audit acceptance: ${acceptance.id}`);
    const outsideAcceptance = exported.child_predicates.filter((predicateId) => !acceptance.proves.includes(predicateId));
    if (outsideAcceptance.length > 0) fail(`submap export predicates are not covered by acceptance ${acceptance.id}: ${outsideAcceptance.join(", ")}`);
    const unobserved = exported.child_predicates.filter((predicateId) => !predicateSatisfied(predicateId, childState.facts, childLoaded.blueprint));
    if (unobserved.length > 0) fail(`submap export predicates are not observed: ${unobserved.join(", ")}`);
    const acceptanceEvidence = childAcceptanceEvidence(childState, acceptance);
    if (acceptanceEvidence.missing.length > 0) fail(`submap acceptance lacks evidence: ${acceptance.id} -> ${acceptanceEvidence.missing.join(", ")}`);
    receiptAcceptance.push({
      id: acceptance.id,
      evidence_ids: acceptanceEvidence.records.map((recordEntry, index) => recordEntry.id ?? `${acceptance.id}-evidence-${index + 1}`),
    });
    exported.proves_parent.forEach((predicateId) => parentPredicates.add(predicateId));
  }
  const proves = [...parentPredicates];
  const missingEffects = edge.effects.filter((predicateId) => !parentPredicates.has(predicateId));
  if (missingEffects.length > 0) fail(`submap receipt does not prove parent edge effects: ${missingEffects.join(", ")}`);
  const receiptPayload = {
    schema: "mapflow.arrival-receipt/v1",
    receipt_id: `${binding.id}-receipt-${state.map_receipts.length + 1}`,
    binding_id: binding.id,
    parent_edge: edgeId,
    child: {
      map_id: childState.map_id,
      map_digest: childLoaded.digest,
      state_revision: childState.event_stream?.head_digest ?? crypto.createHash("sha256").update(fs.readFileSync(childStatePath)).digest("hex"),
    },
    arrival: {
      audited_at: childState.arrival_audit.recorded_at,
      destination_predicates: [...childLoaded.blueprint.destination.requires],
      acceptance: receiptAcceptance,
      residual_risks: childState.arrival_audit.risks ?? [],
    },
    exports: structuredClone(binding.exports),
    generated_by: {
      run_id: childState.arrival_audit.run_id ?? `${childState.map_id}-arrival`,
      actor,
    },
    accepted_at: now(),
  };
  receiptPayload.receipt_digest = crypto.createHash("sha256").update(stableJson(receiptPayload)).digest("hex");
  state.map_receipts.push(receiptPayload);
  const requestedAcceptance = csv(options, "acceptance");
  const parentAcceptance = requestedAcceptance.length > 0
    ? requestedAcceptance
    : blueprint.destination.acceptance.filter((item) => item.proves.some((predicateId) => parentPredicates.has(predicateId))).map((item) => item.id);
  const unknownAcceptance = parentAcceptance.filter((idValue) => !blueprint.destination.acceptance.some((item) => item.id === idValue));
  if (unknownAcceptance.length > 0) fail(`unknown parent acceptance id: ${unknownAcceptance.join(", ")}`);
  const evidence = {
    id: `${edgeId}-evidence-${state.evidence.length + 1}`,
    edge: edgeId,
    run: state.active_run,
    claim: `child map ${childState.map_id} arrived and receipt was accepted`,
    proves,
    acceptance_ids: parentAcceptance,
    outcome_refs: [{ kind: "receipt", ref: receiptPayload.receipt_id }],
    checks: [{ command: "mapflow verify-submap", result: "pass", observed: receiptPayload.receipt_digest, mode: "readback" }],
    limits: { simulated: [], inferred: [], unverified: [], product_unknowns: [] },
    executor: actor,
    receipt_id: receiptPayload.receipt_id,
    recorded_at: receiptPayload.accepted_at,
  };
  evidence.trust = "corroborated";
  evidence.proof_certificate = createProofCertificate({
    blueprint,
    edge,
    facts: state.facts,
    run: state.active_run,
    evidence: evidence.id,
    witnesses: [
      ...edge.evidence_contract.filter((contract) => contract.required).map((contract) => contract.id),
      binding.id,
      receiptPayload.receipt_id,
    ],
    verifier: { id: "map-receipt", digest: receiptPayload.receipt_digest, proves: [...proves] },
    mapDigest: digest,
    briefDigest: briefDigests[edgeId],
    recordedAt: receiptPayload.accepted_at,
  });
  verifyProofCertificate(evidence.proof_certificate, {
    blueprint,
    edge,
    facts: state.facts,
    run: state.active_run,
    evidence: evidence.id,
    mapDigest: digest,
    briefDigest: briefDigests[edgeId],
    verifier: { id: "map-receipt", digest: receiptPayload.receipt_digest, proves: [...proves] },
    requiredWitnesses: edge.evidence_contract.filter((contract) => contract.required).map((contract) => contract.id),
  });
  state.evidence.push(evidence);
  applyPredicateFacts(state, blueprint, proves, [{
    kind: "receipt",
    ref: receiptPayload.receipt_id,
    observed_at: receiptPayload.accepted_at,
    strength: "corroborated",
  }]);
  if (!state.verified_edges.includes(edgeId)) state.verified_edges.push(edgeId);
  state.verified_edge_contracts[edgeId] = frozenEdgeContract(blueprint, briefDigests, edgeId);
  const run = transitionRun(state, "passed", { evidence_ids: [evidence.id], receipt_id: receiptPayload.receipt_id });
  refreshDerivedState(state, blueprint);
  record(state, "submap_receipt_accepted", { edge: edgeId, run: run.id, binding: binding.id, receipt: receiptPayload.receipt_id, executor: actor });
  saveState(statePath, state);
  process.stdout.write(`accepted submap receipt: ${receiptPayload.receipt_id}; verified edge: ${edgeId}\n`);
}

function commandRebuild(statePath, options) {
  const eventsPath = path.resolve(process.cwd(), options.get("events") ?? path.join(path.dirname(statePath), "events.jsonl"));
  const events = readEventStream(eventsPath);
  if (events.length === 0) fail(`event stream is empty: ${eventsPath}`);
  if (fs.existsSync(statePath) && !options.has("force")) {
    try {
      const current = JSON.parse(fs.readFileSync(statePath, "utf8"));
      if ((current.event_stream?.last_seq ?? 0) > events.length) fail("event stream appears truncated; refusing to roll projection back without --force");
    } catch (error) {
      if (error instanceof CliError) throw error;
    }
  }
  const latest = events.at(-1);
  const state = normalizeRuntimeState(structuredClone(latest.data.projection));
  state.event_stream = {
    path: path.relative(path.dirname(path.resolve(statePath)), eventsPath).replaceAll("\\", "/") || "events.jsonl",
    last_seq: latest.seq,
    head_digest: latest.event_digest,
  };
  saveState(statePath, state, { appendEvent: false });
  process.stdout.write(`rebuilt ${statePath} from ${events.length} verified events\n`);
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
  const { blueprint, digest, brief_digests: briefDigests, briefs } = validateSubmapTree(absoluteMap);
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
  const pinnedInvalidations = (state.blueprint_snapshot.submaps ?? []).flatMap((binding) => {
    if (binding.on_parent_close !== "invalidate") return [];
    return state.map_receipts
      .filter((receipt) => receipt.binding_id === binding.id && !state.receipt_invalidations.some((item) => item.receipt_id === receipt.receipt_id))
      .map((receipt) => receipt.receipt_id);
  });
  if (pinnedInvalidations.length > 0) {
    fail(`replan cannot invalidate accepted submap receipts in place: ${pinnedInvalidations.join(", ")}; initialize a successor parent map`);
  }
  const cancelledRun = activeRun(state) ? transitionRun(state, "cancelled", { cancel_reason: `replan: ${reason}` }) : null;
  const submapDispositions = (state.blueprint_snapshot.submaps ?? []).map((binding) => {
    const disposition = { binding: binding.id, policy: binding.on_parent_close };
    if (binding.on_parent_close === "invalidate") {
      for (const receipt of state.map_receipts.filter((item) => item.binding_id === binding.id && !state.receipt_invalidations.some((entry) => entry.receipt_id === item.receipt_id))) {
        state.receipt_invalidations.push({ receipt_id: receipt.receipt_id, binding_id: binding.id, reason: `parent replan: ${reason}`, invalidated_at: now() });
      }
    }
    return disposition;
  });
  state.phase = "wayfinding";
  state.destination_status = "changed";
  state.runtime_status = "wayfinding";
  for (const request of state.authorization_requests.filter((item) => item.status === "pending")) {
    request.status = "stale";
    request.stale_at = now();
    request.stale_reason = `route changed: ${reason}`;
  }
  for (const request of state.arrival_audit_requests.filter((item) => item.status === "pending")) {
    request.status = "stale";
    request.stale_at = now();
    request.stale_reason = `route changed: ${reason}`;
  }
  state.map = mapPathForState(statePath, absoluteMap);
  state.map_id = blueprint.map_id;
  state.map_digest = digest;
  state.blueprint_snapshot = structuredClone(blueprint);
  state.brief_digests = { ...briefDigests };
  state.brief_snapshots = structuredClone(briefs);
  state.active_edge = null;
  state.active_run = null;
  refreshDerivedState(state, blueprint);
  record(state, "replan_requested", { reason, scope, changed_refs: changedRefs, preserved_edges: [...state.verified_edges], cancelled_run: cancelledRun?.id ?? null, submap_dispositions: submapDispositions });
  saveState(statePath, state);
  process.stdout.write(`returned to wayfinding; evidence preserved; proof: ${state.last_proof.structural}/${state.last_proof.reachability}\n`);
}

function commandContinue(statePath, options) {
  const state = loadState(statePath);
  if (state.phase !== "arrived") fail("a successor leg can start only from an audited Arrival");
  ensureArrivalCheckpoints(state, state.blueprint_snapshot);
  const absoluteMap = path.resolve(process.cwd(), required(options, "map"));
  const reason = required(options, "reason");
  const actor = required(options, "actor");
  if (!/^(?:human|agent):/.test(actor)) fail("successor actor must use human:<identity> or agent:<identity>");
  const { blueprint, digest, brief_digests: briefDigests, briefs } = validateSubmapTree(absoluteMap);
  if (blueprint.map_id !== state.map_id) {
    fail(`successor cannot change map identity from ${state.map_id} to ${blueprint.map_id}`);
  }
  const continuity = blueprint.continuity;
  if (!continuity) fail("successor Blueprint requires a continuity contract");
  const checkpoint = state.arrival_checkpoints.find((item) => item.id === continuity.predecessor.checkpoint);
  if (!checkpoint) fail(`continuity predecessor checkpoint is unknown: ${continuity.predecessor.checkpoint}`);
  if (checkpoint.receipt_digest !== continuity.predecessor.receipt_digest) {
    fail(`continuity predecessor receipt does not match Arrival Checkpoint: ${checkpoint.id}`);
  }
  if (continuity.origin_node !== checkpoint.destination_node.id) {
    fail(`continuity origin must be the predecessor destination node: ${checkpoint.destination_node.id}`);
  }
  const expectedImports = [...checkpoint.destination.requires].sort();
  const actualImports = [...continuity.imported_predicates].sort();
  if (stableJson(expectedImports) !== stableJson(actualImports)) {
    fail(`continuity imported_predicates must exactly match predecessor destination requirements: ${expectedImports.join(", ")}`);
  }
  if (stableJson(blueprint.destination) === stableJson(checkpoint.destination)) {
    fail("successor Destination must differ from the predecessor Arrival Destination");
  }
  for (const predicateId of continuity.revalidate) {
    const predicate = blueprint.predicates.find((item) => item.id === predicateId);
    const observation = blueprint.initial_state.facts.find((fact) => fact.id === predicate.fact);
    if (!observation) fail(`continuity.revalidate requires an initial observation for Fact: ${predicate.fact}`);
    if (observation.value !== "unknown" && observation.evidence.some((ref) => !ref.observed_at)) {
      fail(`continuity.revalidate requires observed_at on fresh evidence for Fact: ${predicate.fact}`);
    }
  }
  assertPredecessorCollectionsPreserved(state, blueprint, briefDigests, continuity.revalidate);
  assertVerifiedEdgesPreserved(state, blueprint, briefDigests);

  const facts = mergeSuccessorFacts(state, blueprint, continuity.revalidate);
  const predicateMap = new Map(blueprint.predicates.map((predicate) => [predicate.id, predicate]));
  const originFacts = {};
  for (const predicateId of continuity.imported_predicates) {
    const factId = predicateMap.get(predicateId).fact;
    originFacts[factId] = structuredClone(facts[factId]);
  }
  const destinationNode = blueprint.nodes.find((node) => (
    node.kind === "destination"
    && blueprint.destination.requires.every((predicateId) => node.predicates.includes(predicateId))
  ));
  const binding = {
    schema: "mapflow.successor-binding/v1",
    id: nextSemanticId(state.successor_bindings, state.map_id, "successor-binding"),
    map_id: state.map_id,
    map_digest: digest,
    predecessor_checkpoint: checkpoint.id,
    predecessor_receipt_digest: checkpoint.receipt_digest,
    origin_node: continuity.origin_node,
    imported_predicates: [...continuity.imported_predicates],
    revalidated_predicates: [...continuity.revalidate],
    origin_snapshot: { facts: originFacts },
    destination: structuredClone(blueprint.destination),
    destination_node: structuredClone(destinationNode),
    reason,
    actor,
    started_at: now(),
  };

  for (const request of state.authorization_requests.filter((item) => item.status === "pending")) {
    request.status = "stale";
    request.stale_at = now();
    request.stale_reason = `successor leg started: ${reason}`;
  }
  for (const request of state.arrival_audit_requests.filter((item) => item.status === "pending")) {
    request.status = "stale";
    request.stale_at = now();
    request.stale_reason = `successor leg started: ${reason}`;
  }
  state.map = mapPathForState(statePath, absoluteMap);
  state.map_digest = digest;
  state.blueprint_snapshot = structuredClone(blueprint);
  state.brief_digests = { ...briefDigests };
  state.brief_snapshots = structuredClone(briefs);
  state.facts = facts;
  state.phase = "implementation";
  state.destination_status = "confirmed";
  state.runtime_status = "idle";
  state.active_edge = null;
  state.active_run = null;
  state.successor_bindings.push(binding);
  refreshDerivedState(state, blueprint);
  ensureApprovableProof(state);
  record(state, "successor_started", {
    binding: binding.id,
    checkpoint: checkpoint.id,
    origin_node: binding.origin_node,
    destination_node: binding.destination_node.id,
    revalidated_predicates: binding.revalidated_predicates,
    reason,
    actor,
  });
  saveState(statePath, state);
  process.stdout.write(`started successor leg ${binding.id} from Arrival Checkpoint ${checkpoint.id}\n`);
}

function assertArrivalReady(statePath, state) {
  if (state.phase !== "implementation" || !destinationConfirmed(state)) {
    fail("arrival audit requires a confirmed destination in implementation phase");
  }
  if (state.active_edge !== null || state.active_run !== null) {
    fail(`cannot audit arrival while an Edge Run is active: ${state.active_run ?? state.active_edge}`);
  }
  if (state.authorization_requests.some((request) => request.status === "pending")) {
    fail("cannot audit arrival while an edge authorization request is pending");
  }
  const { blueprint, digest } = readStateBlueprint(statePath, state);
  assertMapUnchanged(statePath, state, digest);
  for (const receipt of state.map_receipts) {
    if (state.receipt_invalidations.some((item) => item.receipt_id === receipt.receipt_id)) fail(`cannot audit arrival with invalidated submap receipt: ${receipt.receipt_id}`);
    const binding = blueprint.submaps.find((item) => item.id === receipt.binding_id);
    if (!binding) fail(`cannot audit arrival; submap binding is missing for receipt: ${receipt.receipt_id}`);
    const childMapPath = path.resolve(path.dirname(resolveStateMap(statePath, state)), binding.map_ref.replaceAll("/", path.sep));
    const childStatePath = path.resolve(path.dirname(resolveStateMap(statePath, state)), binding.state_ref.replaceAll("/", path.sep));
    const childLoaded = readBlueprint(childMapPath);
    const childState = loadState(childStatePath);
    const revision = childState.event_stream?.head_digest ?? crypto.createHash("sha256").update(fs.readFileSync(childStatePath)).digest("hex");
    if (childLoaded.digest !== receipt.child.map_digest || revision !== receipt.child.state_revision) {
      fail(`cannot audit arrival; submap receipt is stale: ${receipt.receipt_id}; restore the pinned child Blueprint/state revision or initialize a successor parent map`);
    }
  }
  const missingDestination = blueprint.destination.requires.filter((predicateId) => !predicateSatisfied(predicateId, state.facts, blueprint));
  if (missingDestination.length > 0) fail(`cannot audit arrival; destination predicates are not observed: ${missingDestination.join(", ")}`);
  const invariantMap = new Map(blueprint.invariants.map((invariant) => [invariant.id, invariant]));
  const missingInvariants = blueprint.destination.invariants.flatMap((invariantId) => (
    invariantMap.get(invariantId).requires.filter((predicateId) => !predicateSatisfied(predicateId, state.facts, blueprint))
      .map((predicateId) => `${invariantId}:${predicateId}`)
  ));
  if (missingInvariants.length > 0) fail(`cannot audit arrival; destination invariants are not observed: ${missingInvariants.join(", ")}`);

  const declaredIds = blueprint.destination.acceptance.map((item) => item.id);
  for (const acceptance of blueprint.destination.acceptance) {
    const records = state.evidence.filter((recordEntry) => (
      recordEntry.acceptance_ids.includes(acceptance.id)
      && recordEntry.checks.some((check) => check.result === "pass" && check.mode !== "reported")
      && recordEntry.limits.unverified.length === 0
    ));
    const proven = new Set(records.flatMap((recordEntry) => recordEntry.proves));
    const missingPredicates = acceptance.proves.filter((predicateId) => !proven.has(predicateId));
    if (missingPredicates.length > 0) {
      fail(`acceptance lacks edge evidence: ${acceptance.id} -> ${missingPredicates.join(", ")}`);
    }
  }
  refreshDerivedState(state, blueprint);
  return { blueprint, acceptance: declaredIds };
}

function commandRequestArrivalAudit(statePath, options) {
  const state = loadState(statePath);
  const { blueprint, acceptance } = assertArrivalReady(statePath, state);
  const evidenceDigest = arrivalEvidenceDigest(state);
  const currentRevision = state.event_stream?.last_seq ?? 0;
  const existing = state.arrival_audit_requests.find((request) => request.status === "pending");
  if (existing) {
    if (
      existing.map_digest === state.map_digest
      && existing.state_revision === currentRevision
      && existing.evidence_digest === evidenceDigest
    ) {
      fail(`another arrival audit request is pending: ${existing.id}`);
    }
    existing.status = "stale";
    existing.stale_at = now();
    existing.stale_reason = "map, route, evidence, or runtime revision changed";
  }
  const question = required(options, "question");
  const requester = options.get("requester") ?? "agent:codex";
  const decisionOwner = requestDecisionOwner(options);
  const request = {
    id: nextSemanticId(state.arrival_audit_requests, state.map_id, "arrival-audit-request"),
    map_digest: state.map_digest,
    state_revision: currentRevision + 1,
    evidence_digest: evidenceDigest,
    acceptance,
    question,
    requested_by: requester,
    decision_owner: decisionOwner,
    requested_at: now(),
    status: "pending",
  };
  state.arrival_audit_requests.push(request);
  state.runtime_status = "arrival-audit-required";
  record(state, "arrival_audit_requested", { request: request.id, question, acceptance, decision_owner: decisionOwner, actor: requester });
  saveState(statePath, state);
  const output = { request_id: request.id, status: request.status, question, decision_owner: decisionOwner, acceptance };
  process.stdout.write(options.has("json") ? `${JSON.stringify(output, null, 2)}\n` : `arrival audit requested: ${request.id}\n`);
}

function commandArrive(statePath, options) {
  const state = loadState(statePath);
  if (options.has("confirm") || options.has("acceptance")) {
    fail("direct arrive is no longer accepted; use request-arrival-audit, wait for a subsequent human answer, then arrive --request <id> --answer <answer> --actor human:<identity>");
  }
  const requestId = required(options, "request");
  const answer = required(options, "answer");
  const actor = required(options, "actor");
  if (!/^(?:human|agent):/.test(actor)) fail("arrival audit actor must use human:<identity> or agent:<identity>");
  const request = state.arrival_audit_requests.find((item) => item.id === requestId);
  if (!request) fail(`arrival audit request is missing: ${requestId}`);
  if (request.status === "stale") fail(`arrival audit request is stale: ${requestId}; ${request.stale_reason ?? "request inputs changed"}`);
  if (request.status !== "pending") fail(`arrival audit request is not pending: ${requestId}`);
  assertDecisionOwner(request, actor, "arrival audit");
  if (request.map_digest !== state.map_digest) {
    fail(`arrival audit request is stale: ${requestId}; map changed`);
  }
  if (request.state_revision !== (state.event_stream?.last_seq ?? 0)) {
    fail(`arrival audit request is stale: ${requestId}; runtime revision changed after the request`);
  }
  const { blueprint, acceptance } = assertArrivalReady(statePath, state);
  if (request.evidence_digest !== arrivalEvidenceDigest(state) || stableJson(request.acceptance) !== stableJson(acceptance)) {
    fail(`arrival audit request is stale: ${requestId}; evidence or Acceptance changed`);
  }

  const recordedAt = now();
  request.status = "granted";
  request.answer = answer;
  request.audited_by = actor;
  request.audited_at = recordedAt;
  state.phase = "arrived";
  state.runtime_status = "arrived";
  state.arrival_audit = {
    request: request.id,
    acceptance,
    non_goals: csv(options, "non-goals"),
    risks: csv(options, "risks"),
    answer,
    confirm: answer,
    actor,
    recorded_at: recordedAt,
    run_id: `${state.map_id}-arrival-${(state.event_stream?.last_seq ?? 0) + 1}`,
  };
  refreshDerivedState(state, blueprint);
  state.arrival_checkpoints.push(createArrivalCheckpoint({
    state,
    blueprint,
    evidenceDigest: request.evidence_digest,
    stateRevision: (state.event_stream?.last_seq ?? 0) + 1,
  }));
  record(state, "arrival_audited", { request: request.id, acceptance, answer, actor, causation_id: request.id });
  saveState(statePath, state);
  process.stdout.write(`arrival audited from request ${request.id}\n`);
}

export async function main(argv) {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return 0;
  }
  let statePath = null;
  let stateExplicit = false;
  const args = [...argv];
  if (args[0] === "--state") {
    stateExplicit = true;
    statePath = args[1] ?? fail("value is required for --state");
    args.splice(0, 2);
  }
  const command = args.shift();
  const options = parseOptions(args);
  if (command === "enable") {
    commandEnable(options);
    return 0;
  }
  const workspace = stateExplicit ? null : resolveWorkspace({
    root: options.get("root") ?? process.cwd(),
    mapflowHome: options.get("mapflow-home") ?? null,
  });
  if (workspace) options.set("_workspace-root", workspace.workspace_root);
  statePath ??= workspace.statePath;
  if (!stateExplicit && !options.has("map") && new Set(["validate", "init"]).has(command)) {
    options.set("map", workspace.mapPath);
  }
  switch (command) {
    case "wayfinding-write": commandWayfindingWrite(statePath, options); return 0;
    case "wayfinding-answer": commandWayfindingAnswer(statePath, options); return 0;
    case "validate": commandValidate(options); return 0;
    case "init": commandInit(statePath, options); return 0;
    case "status": commandStatus(statePath, options); return 0;
    case "context": commandContext(statePath, options); return 0;
    case "prove": commandProve(statePath, options); return 0;
    case "assign-decision-owner": commandAssignDecisionOwner(statePath, options); return 0;
    case "start": commandStart(statePath, options); return 0;
    case "request-authorization": commandRequestAuthorization(statePath, options); return 0;
    case "authorize": commandAuthorize(statePath, options); return 0;
    case "decline-authorization": commandDeclineAuthorization(statePath, options); return 0;
    case "select": commandSelect(statePath, options); return 0;
    case "gate": return commandGate(statePath);
    case "next-actions": commandNextActions(statePath, options); return 0;
    case "issue-action": commandIssueAction(statePath, options); return 0;
    case "wait": commandPauseRun(statePath, options, "waiting"); return 0;
    case "block": commandPauseRun(statePath, options, "blocked"); return 0;
    case "resume": commandResume(statePath, options); return 0;
    case "cancel": commandCancel(statePath, options); return 0;
    case "propose": commandPropose(statePath, options); return 0;
    case "confirm": commandProposalConfirm(statePath, options); return 0;
    case "reject": commandProposalReject(statePath, options); return 0;
    case "verify": commandVerify(statePath, options); return 0;
    case "verify-executed": options.set("mode", "executed"); commandVerify(statePath, options); return 0;
    case "verify-submap": commandVerifySubmap(statePath, options); return 0;
    case "replan": commandReplan(statePath, options); return 0;
    case "continue": commandContinue(statePath, options); return 0;
    case "request-arrival-audit": commandRequestArrivalAudit(statePath, options); return 0;
    case "arrive": commandArrive(statePath, options); return 0;
    case "rebuild": commandRebuild(statePath, options); return 0;
    case "board": {
      const { startBoardServer } = await import("./mapflow-board.mjs");
      await startBoardServer({
        mapPath: options.has("map") ? path.resolve(process.cwd(), required(options, "map")) : null,
        statePath: options.has("map") && !stateExplicit ? null : path.resolve(process.cwd(), statePath),
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
    process.exitCode = error instanceof CliError || error instanceof ModelError || error instanceof WayfindingError || error instanceof WorkspaceError || error instanceof EvolutionError ? 1 : 2;
  }
}
