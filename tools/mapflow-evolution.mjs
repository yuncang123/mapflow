import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { readWayfinding, validateWayfinding } from "./mapflow-wayfinding.mjs";

export const WAYFINDING_EVENT_SCHEMA = "mapflow.wayfinding-event/v1";

export class EvolutionError extends Error {}

function fail(message) {
  throw new EvolutionError(message);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function eventDigest(event) {
  const payload = structuredClone(event);
  delete payload.event_digest;
  return digest(stableJson(payload));
}

function requiredString(value, label) {
  if (typeof value !== "string" || value.trim() === "") fail(`${label} is invalid`);
  return value;
}

function validateSnapshot(snapshot, seq) {
  if (snapshot === null) return null;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    fail(`wayfinding event snapshot is invalid at seq ${seq}`);
  }
  return validateWayfinding(structuredClone(snapshot));
}

export function semanticWayfindingDigest(draft) {
  const snapshot = structuredClone(validateWayfinding(structuredClone(draft)));
  delete snapshot.updated_at;
  return digest(stableJson(snapshot));
}

export function readWayfindingEvents(eventsPath) {
  if (!fs.existsSync(eventsPath)) {
    return {
      events: [],
      head_digest: null,
      coverage: { complete: false, from: null, reason: "Wayfinding history was not recorded" },
    };
  }
  const lines = fs.readFileSync(eventsPath, "utf8").split(/\r?\n/).filter((line) => line.trim() !== "");
  const events = [];
  let previous = null;
  let stream = null;
  const identities = new Set();
  let complete = true;
  let partialReason = null;
  for (let index = 0; index < lines.length; index += 1) {
    const seq = index + 1;
    let event;
    try {
      event = JSON.parse(lines[index]);
    } catch (error) {
      fail(`invalid wayfinding event JSON at line ${seq}: ${error.message}`);
    }
    if (!event || typeof event !== "object" || Array.isArray(event)) fail(`wayfinding event at seq ${seq} must be an object`);
    if (event.schema !== WAYFINDING_EVENT_SCHEMA || event.specversion !== "1.0") fail(`unsupported wayfinding event envelope at seq ${seq}`);
    for (const field of ["id", "source", "stream", "type", "time", "actor", "subject", "base_revision", "event_digest"]) {
      requiredString(event[field], `wayfinding event ${field} at seq ${seq}`);
    }
    if (event.seq !== seq) fail(`wayfinding event sequence gap at line ${seq}: found ${event.seq}`);
    if (event.previous_digest !== previous) fail(`wayfinding event hash chain is broken at seq ${seq}`);
    if (event.event_digest !== eventDigest(event)) fail(`wayfinding event digest mismatch at seq ${seq}`);
    if (Number.isNaN(Date.parse(event.time))) fail(`wayfinding event time is invalid at seq ${seq}`);
    if (!/^mapflow\.(?:workspace|wayfinding)\.[a-z0-9.]+\.v1$/.test(event.type)) fail(`wayfinding event type is invalid at seq ${seq}`);
    if (!event.data || typeof event.data !== "object" || Array.isArray(event.data)) fail(`wayfinding event data is invalid at seq ${seq}`);
    requiredString(event.data.summary, `wayfinding event summary at seq ${seq}`);
    const streamPrefix = "wayfinding/";
    if (!event.stream.startsWith(streamPrefix)) fail(`wayfinding event stream is invalid at seq ${seq}`);
    const workspaceId = requiredString(event.stream.slice(streamPrefix.length), `wayfinding workspace identity at seq ${seq}`);
    if (event.source !== `mapflow://${workspaceId}/wayfinding`) fail(`wayfinding event source does not match its stream at seq ${seq}`);
    const expectedGenesis = digest(`mapflow-wayfinding:${workspaceId}`);
    if (event.data.genesis_digest !== expectedGenesis) fail(`wayfinding event genesis digest mismatch at seq ${seq}`);
    const snapshot = validateSnapshot(event.data.snapshot, seq);
    if (snapshot) {
      if (!/^[a-f0-9]{64}$/.test(event.data.draft_digest ?? "")) fail(`wayfinding event draft digest is invalid at seq ${seq}`);
      if (event.data.semantic_digest !== semanticWayfindingDigest(snapshot)) fail(`wayfinding event semantic digest mismatch at seq ${seq}`);
    } else if (event.data.draft_digest !== null || event.data.semantic_digest !== null) {
      fail(`blank wayfinding event cannot claim a draft digest at seq ${seq}`);
    }
    const identity = `${event.source}\0${event.stream}`;
    if (stream === null) stream = identity;
    if (stream !== identity) fail(`wayfinding event stream identity changed at seq ${seq}`);
    const eventIdentity = `${event.source}\0${event.id}`;
    if (identities.has(eventIdentity)) fail(`duplicate wayfinding event identity at seq ${seq}`);
    identities.add(eventIdentity);
    if (event.base_revision !== (previous ?? event.data.genesis_digest)) fail(`wayfinding event base revision mismatch at seq ${seq}`);
    if (event.coverage !== "complete" && event.coverage !== "partial") fail(`wayfinding event coverage is invalid at seq ${seq}`);
    if (event.coverage === "partial") {
      complete = false;
      partialReason ??= event.data.coverage_reason ?? "Wayfinding history starts at a migration anchor";
    }
    previous = event.event_digest;
    events.push(event);
  }
  if (events.length && events[0].type !== "mapflow.workspace.enabled.v1") {
    complete = false;
    partialReason ??= "Wayfinding history starts after the workspace was enabled";
  }
  return {
    events,
    head_digest: previous,
    coverage: {
      complete: events.length > 0 && complete,
      from: events[0]?.type ?? null,
      reason: events.length > 0 && complete ? null : partialReason ?? "Wayfinding history was not recorded",
    },
  };
}

export function appendWayfindingEvent(eventsPath, {
  workspaceId,
  type,
  actor,
  subject,
  summary,
  reason = null,
  target = null,
  snapshot = null,
  draftDigest = null,
  coverage = "complete",
  coverageReason = null,
  details = {},
  at = null,
}) {
  const journal = readWayfindingEvents(eventsPath);
  const seq = journal.events.length + 1;
  const previous = journal.head_digest;
  const genesis = digest(`mapflow-wayfinding:${workspaceId}`);
  const source = `mapflow://${workspaceId}/wayfinding`;
  const event = {
    schema: WAYFINDING_EVENT_SCHEMA,
    specversion: "1.0",
    id: `${workspaceId}-wayfinding-${seq}`,
    source,
    stream: `wayfinding/${workspaceId}`,
    type: requiredString(type, "wayfinding event type"),
    time: at ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    actor: requiredString(actor, "wayfinding event actor"),
    subject: requiredString(subject, "wayfinding event subject"),
    seq,
    base_revision: previous ?? genesis,
    previous_digest: previous,
    coverage,
    data: {
      genesis_digest: genesis,
      summary: requiredString(summary, "wayfinding event summary"),
      reason,
      target,
      details,
      snapshot: snapshot === null ? null : structuredClone(validateWayfinding(structuredClone(snapshot))),
      draft_digest: draftDigest,
      semantic_digest: snapshot === null ? null : semanticWayfindingDigest(snapshot),
      coverage_reason: coverageReason,
    },
  };
  event.event_digest = eventDigest(event);
  fs.mkdirSync(path.dirname(path.resolve(eventsPath)), { recursive: true });
  fs.appendFileSync(eventsPath, `${JSON.stringify(event)}\n`, "utf8");
  return structuredClone(event);
}

export function fileCheckpoint(filePath) {
  return fs.existsSync(filePath)
    ? { existed: true, content: fs.readFileSync(filePath) }
    : { existed: false, content: null };
}

export function restoreFileCheckpoint(filePath, checkpoint) {
  if (!checkpoint.existed) {
    fs.rmSync(filePath, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  fs.writeFileSync(filePath, checkpoint.content);
}

export function workspaceIdentityForState(statePath) {
  const current = path.dirname(path.resolve(statePath));
  const manifestPath = path.join(path.dirname(current), "workspace.json");
  if (fs.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      if (typeof manifest.workspace_id === "string" && manifest.workspace_id.trim()) return manifest.workspace_id;
    } catch {
      // The workspace resolver reports malformed manifests on normal workspace commands.
    }
  }
  return `sidecar-${digest(current.toLowerCase()).slice(0, 12)}`;
}

export function ensureWayfindingMigrationAnchor({ eventsPath, wayfindingPath, workspaceId }) {
  const journal = readWayfindingEvents(eventsPath);
  if (journal.events.length) return journal;
  if (!fs.existsSync(wayfindingPath)) return journal;
  const content = fs.readFileSync(wayfindingPath, "utf8");
  const snapshot = readWayfinding(wayfindingPath).draft;
  appendWayfindingEvent(eventsPath, {
    workspaceId,
    type: "mapflow.wayfinding.migration.anchored.v1",
    actor: "system:mapflow",
    subject: `workspace/${workspaceId}`,
    summary: "从当前 Wayfinding 草稿开始记录；此前过程不可回放",
    snapshot,
    draftDigest: digest(content),
    coverage: "partial",
    coverageReason: "Wayfinding existed before evolution recording was enabled",
  });
  return readWayfindingEvents(eventsPath);
}
