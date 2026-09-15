import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { readBlueprint, registeredBriefFormattingEquivalent } from "./mapflow-core.mjs";
import { readWayfindingEvents, workspaceIdentityForState } from "./mapflow-evolution.mjs";
import { runtimeIdentity, runtimeIdentityMatches } from "./mapflow-runtime.mjs";
import { readWayfinding } from "./mapflow-wayfinding.mjs";

export const WORKSPACE_HEAD_SCHEMA = "mapflow.workspace-head/v1";

export class WorkspaceHeadError extends Error {}

function fail(message) {
  throw new WorkspaceHeadError(message);
}

function fileDigest(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function requiredDigest(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) fail(`${label} is invalid`);
  return value;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(`invalid ${label} ${filePath}: ${error.message}`);
  }
}

function relativeFromCurrent(statePath, targetPath) {
  return path.relative(path.dirname(path.resolve(statePath)), path.resolve(targetPath)).replaceAll("\\", "/") || ".";
}

export function workspaceHeadPathForState(statePath) {
  return path.join(path.dirname(path.resolve(statePath)), "head.json");
}

export function workspaceWriteLockPathForState(statePath) {
  return path.join(path.dirname(path.resolve(statePath)), "write.lock");
}

function deriveWayfindingHead(statePath, identity) {
  const directory = path.dirname(path.resolve(statePath));
  const draftPath = path.join(directory, "wayfinding.yaml");
  const eventsPath = path.join(directory, "wayfinding-events.jsonl");
  const loaded = readWayfinding(draftPath);
  const journal = readWayfindingEvents(eventsPath);
  if (!journal.events.length) fail("Workspace Head requires a recorded Wayfinding journal");
  const eventHead = journal.events.at(-1);
  if (eventHead.data.draft_digest !== loaded.digest) {
    fail("current Wayfinding draft does not match the recorded journal head");
  }
  return {
    schema: WORKSPACE_HEAD_SCHEMA,
    workspace_id: workspaceIdentityForState(statePath),
    revision: requiredDigest(journal.head_digest, "Wayfinding head revision"),
    phase: "wayfinding",
    source: {
      kind: "wayfinding",
      map: relativeFromCurrent(statePath, draftPath),
      map_digest: loaded.digest,
      events: relativeFromCurrent(statePath, eventsPath),
      events_digest: fileDigest(eventsPath),
      event_head: journal.head_digest,
    },
    runtime: identity,
    updated_at: eventHead.time,
  };
}

function deriveRuntimeHead(statePath, identity) {
  const absoluteStatePath = path.resolve(statePath);
  const directory = path.dirname(absoluteStatePath);
  const state = readJson(absoluteStatePath, "runtime state");
  const mapPath = path.resolve(directory, state.map ?? "blueprint.yaml");
  const loaded = readBlueprint(mapPath);
  if (loaded.blueprint.map_id !== state.map_id) {
    fail(`runtime map identity changed from ${state.map_id} to ${loaded.blueprint.map_id}`);
  }
  if (
    loaded.digest !== state.map_digest
    && !registeredBriefFormattingEquivalent({
      mapPath,
      blueprint: loaded.blueprint,
      briefs: loaded.briefs,
      state,
    })
  ) {
    fail(`current Blueprint or bound Task Brief does not match runtime state: ${mapPath}`);
  }
  const eventStream = state.event_stream;
  if (!eventStream || !Number.isInteger(eventStream.last_seq) || eventStream.last_seq < 1) {
    fail("runtime state has no committed event head");
  }
  const eventsPath = path.resolve(directory, eventStream.path ?? "events.jsonl");
  const lines = fs.readFileSync(eventsPath, "utf8").split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length !== eventStream.last_seq) fail("runtime event count does not match state event head");
  const lastEvent = readJsonLine(lines.at(-1), eventsPath, lines.length);
  if (lastEvent.seq !== eventStream.last_seq) fail("runtime event sequence does not match state event head");
  if (lastEvent.event_digest !== eventStream.head_digest) fail("runtime event file does not match state event head");
  const stateProjection = structuredClone(state);
  delete stateProjection.event_stream;
  if (!lastEvent.data?.projection || stableJson(lastEvent.data.projection) !== stableJson(stateProjection)) {
    fail("runtime state does not match the latest event projection");
  }
  return {
    schema: WORKSPACE_HEAD_SCHEMA,
    workspace_id: workspaceIdentityForState(statePath),
    revision: requiredDigest(eventStream.head_digest, "runtime head revision"),
    phase: "runtime",
    source: {
      kind: "runtime",
      map: relativeFromCurrent(statePath, mapPath),
      map_digest: requiredDigest(state.map_digest, "runtime map digest"),
      state: relativeFromCurrent(statePath, absoluteStatePath),
      state_digest: fileDigest(absoluteStatePath),
      events: relativeFromCurrent(statePath, eventsPath),
      events_digest: fileDigest(eventsPath),
      event_head: eventStream.head_digest,
    },
    runtime: identity,
    updated_at: lastEvent.time ?? state.updated_at,
  };
}

function readJsonLine(content, filePath, lineNumber) {
  try {
    return JSON.parse(content);
  } catch (error) {
    fail(`invalid runtime event JSON at ${filePath}:${lineNumber}: ${error.message}`);
  }
}

export function deriveWorkspaceHead(statePath, { identity = runtimeIdentity() } = {}) {
  const absoluteStatePath = path.resolve(statePath);
  if (fs.existsSync(absoluteStatePath)) return deriveRuntimeHead(absoluteStatePath, identity);
  const wayfindingPath = path.join(path.dirname(absoluteStatePath), "wayfinding.yaml");
  if (fs.existsSync(wayfindingPath)) return deriveWayfindingHead(absoluteStatePath, identity);
  fail(`workspace has no current Wayfinding or runtime source beside ${absoluteStatePath}`);
}

function validateStoredHead(head, headPath) {
  if (!head || typeof head !== "object" || Array.isArray(head)) fail(`Workspace Head must be an object: ${headPath}`);
  if (head.schema !== WORKSPACE_HEAD_SCHEMA) fail(`unsupported Workspace Head schema: ${head.schema ?? "missing"}`);
  if (typeof head.workspace_id !== "string" || !head.workspace_id) fail("Workspace Head workspace_id is invalid");
  requiredDigest(head.revision, "Workspace Head revision");
  if (!new Set(["wayfinding", "runtime"]).has(head.phase)) fail(`Workspace Head phase is invalid: ${head.phase}`);
  if (!head.source || head.source.kind !== head.phase) fail("Workspace Head source does not match its phase");
  requiredDigest(head.source.map_digest, "Workspace Head map digest");
  requiredDigest(head.source.events_digest, "Workspace Head events digest");
  requiredDigest(head.source.event_head, "Workspace Head event revision");
  if (typeof head.source.map !== "string" || typeof head.source.events !== "string") fail("Workspace Head source paths are invalid");
  if (head.phase === "runtime") {
    if (typeof head.source.state !== "string") fail("runtime Workspace Head state path is invalid");
    requiredDigest(head.source.state_digest, "Workspace Head state digest");
  }
  if (head.source.event_head !== head.revision) fail("Workspace Head revision must equal its event head");
  if (!head.runtime || typeof head.runtime.version !== "string") fail("Workspace Head runtime identity is missing");
  requiredDigest(head.runtime.build_digest, "Workspace Head runtime build digest");
  return head;
}

function sourceIdentity(head) {
  return JSON.stringify({
    workspace_id: head.workspace_id,
    revision: head.revision,
    phase: head.phase,
    source: head.source,
    updated_at: head.updated_at,
  });
}

export function readWorkspaceHead(statePath, { identity = runtimeIdentity() } = {}) {
  const headPath = workspaceHeadPathForState(statePath);
  if (!fs.existsSync(headPath)) fail(`Workspace Head is missing: ${headPath}; run enable before reading or writing this workspace`);
  const stored = validateStoredHead(readJson(headPath, "Workspace Head"), headPath);
  const actual = deriveWorkspaceHead(statePath, { identity: stored.runtime });
  if (sourceIdentity(stored) !== sourceIdentity(actual)) {
    fail(`Workspace Head does not match current source files: ${headPath}`);
  }
  return {
    head: structuredClone(stored),
    path: headPath,
    runtime: identity,
    runtime_compatible: runtimeIdentityMatches(stored.runtime, identity),
  };
}

export function writeWorkspaceHead(statePath, { identity = runtimeIdentity() } = {}) {
  const head = deriveWorkspaceHead(statePath, { identity });
  const headPath = workspaceHeadPathForState(statePath);
  fs.mkdirSync(path.dirname(headPath), { recursive: true });
  const temporary = `${headPath}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(head, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, headPath);
  return readWorkspaceHead(statePath, { identity });
}

export function assertExpectedWorkspaceRevision(statePath, expectedRevision, { identity = runtimeIdentity() } = {}) {
  const current = readWorkspaceHead(statePath, { identity });
  if (!current.runtime_compatible) {
    fail(`runtime ${identity.version}/${identity.build_digest.slice(0, 12)} does not match Workspace Head runtime ${current.head.runtime.version}/${current.head.runtime.build_digest.slice(0, 12)}; install and use one runtime build`);
  }
  if (typeof expectedRevision !== "string" || expectedRevision.trim() === "") {
    fail("expected-revision is required; run snapshot --root immediately before this write");
  }
  if (expectedRevision !== current.head.revision) {
    fail(`expected revision is stale: expected ${expectedRevision}, current ${current.head.revision}; reload snapshot --root before writing`);
  }
  return current;
}

export function acquireWorkspaceWriteLock(statePath) {
  const lockPath = workspaceWriteLockPathForState(statePath);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  let descriptor;
  try {
    descriptor = fs.openSync(lockPath, "wx");
    fs.writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, acquired_at: new Date().toISOString() })}\n`, "utf8");
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (error.code === "EEXIST") fail(`workspace write is already in progress: ${lockPath}`);
    throw error;
  }
  return {
    path: lockPath,
    release() {
      if (descriptor !== undefined) {
        fs.closeSync(descriptor);
        descriptor = undefined;
      }
      fs.rmSync(lockPath, { force: true });
    },
  };
}
