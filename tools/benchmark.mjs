#!/usr/bin/env node

import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createBoardSnapshotReader } from "./mapflow-board-core.mjs";
import { defaultMapflowHome, resolveWorkspace } from "./mapflow-workspace.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CASES_ROOT = path.join(ROOT, "benchmarks", "cases");
const SUITE_VERSION = "1.6.0";
const MAX_CHILD_OUTPUT_BYTES = 64 * 1024 * 1024;
const RUN_SCHEMA = "mapflow.benchmark-run/v1";
const CASE_SCHEMA = "mapflow.benchmark-case/v1";
const ORACLE_SCHEMA = "mapflow.benchmark-oracle/v1";
const CHECKPOINT_SCHEMA = "mapflow.benchmark-checkpoint/v1";
const IMPACT_SCHEMA = "mapflow.benchmark-impact-map/v1";
const SCORE_FIELDS = ["clarity", "accuracy", "fluency", "control", "usefulness"];
const VERDICTS = new Set(["continue", "hesitate", "leave", "blocked"]);
const SEVERITIES = new Set(["P0", "P1", "P2", "P3"]);
const PROCESS_COACHING_PATTERNS = [
  { label: "reverse from the result", pattern: /从(?:最终结果|结果|目标)[^。\n]*(?:往回|倒推|反推)/g },
  { label: "prescribe backward decomposition", pattern: /(?:反向|往回)[^。\n]*(?:梳理|拆解|推导)/g },
  { label: "prescribe independent work briefs", pattern: /为每(?:段|项)工作留下独立执行说明/g },
  { label: "prescribe reachability proof", pattern: /检查从(?:当前|现状)[^。\n]*(?:走通|可达)/g },
  { label: "prescribe minimal graph repair", pattern: /(?:调整|修改|证明)[^。\n]*最小(?:子图|一段|路线)/g },
  { label: "prescribe stepwise execution", pattern: /逐项执行/g },
  { label: "prescribe route approval", pattern: /先把(?:路线|安排)[^。\n]*确认/g },
];

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const options = {};
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) options[key] = true;
    else {
      options[key] = value;
      index += 1;
    }
  }
  return { command: positional[0] ?? null, options };
}

function readJson(filePath, label = filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(`cannot read ${label}: ${error.message}`);
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function appendJsonl(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

function now() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function run(command, args, { cwd = ROOT, env = process.env, input } = {}) {
  return spawnSync(command, args, { cwd, env, input, encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function runWithHeartbeat(command, args, {
  cwd = ROOT,
  env = process.env,
  input,
  heartbeatLabel = "child process",
  heartbeatMs = 30_000,
  includeProgress = true,
} = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { cwd, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    } catch (error) {
      resolve({ status: null, signal: null, stdout: "", stderr: "", error, heartbeat_count: 0 });
      return;
    }

    const started = Date.now();
    let stdout = "";
    let stderr = "";
    let stdoutLineBuffer = "";
    let outputBytes = 0;
    let heartbeatCount = 0;
    let spawnError = null;
    let settled = false;
    const progress = { turn_started: false, tool_steps: 0, file_changes: 0, agent_updates: 0, turn_completed: false };
    const observeLine = (line) => {
      if (!line.trim()) return;
      try {
        const event = JSON.parse(line);
        if (event.type === "turn.started") progress.turn_started = true;
        if (event.type === "turn.completed") progress.turn_completed = true;
        if (event.type !== "item.completed") return;
        const itemType = event.item?.type ?? event.data?.item?.type;
        if (itemType === "file_change") progress.file_changes += 1;
        else if (itemType === "agent_message") progress.agent_updates += 1;
        else progress.tool_steps += 1;
      } catch {}
    };
    const observeStdout = (value) => {
      stdoutLineBuffer += value;
      const lines = stdoutLineBuffer.split(/\r?\n/);
      stdoutLineBuffer = lines.pop() ?? "";
      for (const line of lines) observeLine(line);
    };
    const heartbeat = setInterval(() => {
      const elapsed = Math.max(1, Math.ceil((Date.now() - started) / 1000));
      heartbeatCount += 1;
      const progressText = includeProgress
        ? `; progress: ${progress.tool_steps} tool steps, ${progress.file_changes} file changes, ${progress.agent_updates} agent updates`
        : "";
      process.stderr.write(`[mapflow benchmark] ${heartbeatLabel} is still running (${elapsed}s)${progressText}\n`);
    }, heartbeatMs);
    heartbeat.unref?.();

    const append = (kind, chunk) => {
      const value = chunk.toString("utf8");
      outputBytes += Buffer.byteLength(value);
      if (outputBytes > MAX_CHILD_OUTPUT_BYTES) {
        spawnError ??= new Error(`child output exceeded ${MAX_CHILD_OUTPUT_BYTES} bytes`);
        child.kill();
        return;
      }
      if (kind === "stdout") {
        stdout += value;
        observeStdout(value);
      }
      else stderr += value;
    };
    const finish = (status, signal = null) => {
      if (settled) return;
      settled = true;
      clearInterval(heartbeat);
      observeLine(stdoutLineBuffer);
      resolve({ status, signal, stdout, stderr, error: spawnError, heartbeat_count: heartbeatCount, progress });
    };

    child.stdout.on("data", (chunk) => append("stdout", chunk));
    child.stderr.on("data", (chunk) => append("stderr", chunk));
    child.on("error", (error) => {
      spawnError = error;
      finish(null);
    });
    child.on("close", (status, signal) => finish(status, signal));
    child.stdin.on("error", () => {});
    child.stdin.end(input ?? "");
  });
}

function git(args, cwd) {
  return run("git", args, { cwd });
}

function relativeInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function defaultBenchmarkHome({ env = process.env } = {}) {
  const explicit = env.MAPFLOW_BENCHMARK_HOME;
  if (explicit) {
    if (!path.isAbsolute(explicit)) fail("MAPFLOW_BENCHMARK_HOME must be an absolute path");
    return path.normalize(explicit);
  }
  const mapflowHome = defaultMapflowHome({ env });
  return path.join(path.dirname(mapflowHome), `${path.basename(mapflowHome)}-benchmark`);
}

function assertBlindStorageIsolation({ target, mapflowHome, benchmarkHome }) {
  if (relativeInside(mapflowHome, benchmarkHome) || relativeInside(benchmarkHome, mapflowHome)) {
    fail("MAPFLOW_BENCHMARK_HOME and MAPFLOW_HOME must be separate, non-overlapping directories");
  }
  if (relativeInside(target, benchmarkHome) || relativeInside(benchmarkHome, target)) {
    fail("benchmark evidence storage must be outside and separate from the tested target");
  }
  const exposed = `${target}\n${mapflowHome}`;
  if (/(?:benchmark|blind(?:-suite)?|oracle|operator|gold(?:en)?)/i.test(exposed)) {
    fail("tested target and MAPFLOW_HOME paths must not reveal benchmark, blind, Oracle, operator, or gold context");
  }
}

function casePath(item, relativePath, label) {
  if (typeof relativePath !== "string" || relativePath.trim() === "") fail(`${label} must be a non-empty relative path`);
  const resolved = path.resolve(item.directory, relativePath);
  if (!relativeInside(item.directory, resolved)) fail(`${label} escapes the case directory: ${relativePath}`);
  return resolved;
}

function walkFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  };
  visit(directory);
  return files;
}

function directoryDigest(directory) {
  const digest = crypto.createHash("sha256");
  for (const filePath of walkFiles(directory)) {
    digest.update(path.relative(directory, filePath).replaceAll(path.sep, "/"));
    digest.update("\0");
    digest.update(fs.readFileSync(filePath));
    digest.update("\0");
  }
  return digest.digest("hex");
}

function valueDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function fileDigest(filePath) {
  return crypto.createHash("sha256").update(fs.existsSync(filePath) ? fs.readFileSync(filePath) : Buffer.alloc(0)).digest("hex");
}

function checkpointContractDigest(item, checkpointId) {
  const checkpoint = item.oracle.checkpoints.find((entry) => entry.id === checkpointId);
  if (!checkpoint) fail(`unknown checkpoint for ${item.id}: ${checkpointId}`);
  return valueDigest(checkpoint);
}

function copyTreeWithoutGit(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    fs.cpSync(path.join(source, entry.name), path.join(target, entry.name), {
      recursive: true,
      errorOnExist: true,
    });
  }
}

function clearTreeWithoutGit(target) {
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    fs.rmSync(path.join(target, entry.name), { recursive: entry.isDirectory(), force: true });
  }
}

function writeJsonl(filePath, entries) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const content = entries.length ? `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n` : "";
  fs.writeFileSync(filePath, content, "utf8");
}

function listCaseIds() {
  if (!fs.existsSync(CASES_ROOT)) return [];
  return fs.readdirSync(CASES_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(CASES_ROOT, entry.name, "case.json")))
    .map((entry) => entry.name)
    .sort();
}

function loadCaseFromDirectory(caseId, directory) {
  if (!caseId || !/^[a-z][a-z0-9-]+$/.test(caseId)) fail(`invalid case id: ${caseId ?? "missing"}`);
  const manifest = readJson(path.join(directory, "case.json"), `case ${caseId}`);
  const oracle = readJson(path.join(directory, "oracle", "checkpoints.json"), `oracle for ${caseId}`);
  if (manifest.schema !== CASE_SCHEMA || manifest.id !== caseId) fail(`case identity mismatch: ${caseId}`);
  if (oracle.schema !== ORACLE_SCHEMA || oracle.case_id !== caseId || oracle.case_version !== manifest.version) {
    fail(`oracle identity mismatch: ${caseId}`);
  }
  return { id: caseId, directory, manifest, oracle };
}

function loadCase(caseId) {
  return loadCaseFromDirectory(caseId, path.join(CASES_ROOT, caseId));
}

function segmentFor(item, segmentId) {
  if (!segmentId) fail("--segment is required");
  const segment = (item.manifest.segments ?? []).find((entry) => entry.id === segmentId);
  if (!segment) fail(`unknown segment for ${item.id}: ${segmentId}; available: ${(item.manifest.segments ?? []).map((entry) => entry.id).join(", ") || "none"}`);
  return segment;
}

function loadCheckpointPackage(directory, item, expectedCheckpoint = null) {
  const resolved = path.resolve(directory);
  const manifestPath = path.join(resolved, "checkpoint.json");
  if (!fs.existsSync(manifestPath)) fail(`checkpoint package is missing: ${manifestPath}`);
  const manifest = readJson(manifestPath, "benchmark checkpoint package");
  if (manifest.schema !== CHECKPOINT_SCHEMA) fail(`unsupported checkpoint package: ${manifest.schema}`);
  if (manifest.case_id !== item.id) fail(`checkpoint case mismatch: ${manifest.case_id} != ${item.id}`);
  if (expectedCheckpoint && manifest.checkpoint !== expectedCheckpoint) {
    fail(`checkpoint id mismatch: ${manifest.checkpoint} != ${expectedCheckpoint}`);
  }
  const fixture = casePath(item, item.manifest.fixture, "fixture");
  if (manifest.fixture_digest !== directoryDigest(fixture)) fail("checkpoint fixture digest does not match the current case");
  if (manifest.checkpoint_contract_digest !== checkpointContractDigest(item, manifest.checkpoint)) {
    fail("checkpoint Oracle contract changed; rebuild the checkpoint package from a passing run");
  }
  const locations = {
    directory: resolved,
    manifest,
    target: path.join(resolved, "target"),
    sidecar: path.join(resolved, "sidecar"),
    checks: path.join(resolved, "context", "checks.jsonl"),
    turns: path.join(resolved, "context", "turns.jsonl"),
  };
  for (const [label, location] of Object.entries({ target: locations.target, sidecar: locations.sidecar })) {
    if (!fs.existsSync(location) || !fs.statSync(location).isDirectory()) fail(`checkpoint ${label} directory is missing: ${location}`);
  }
  const actualDigests = {
    target: directoryDigest(locations.target),
    sidecar: directoryDigest(locations.sidecar),
    checks: fileDigest(locations.checks),
    turns: fileDigest(locations.turns),
  };
  for (const [label, actual] of Object.entries(actualDigests)) {
    if (manifest.digests?.[label] !== actual) fail(`checkpoint ${label} digest mismatch`);
  }
  const eventStream = manifest.event_stream;
  if (!eventStream || typeof eventStream !== "object" || Array.isArray(eventStream)) {
    fail("checkpoint event_stream metadata is missing");
  }
  if (eventStream.path !== "events.jsonl") fail(`checkpoint event_stream path is invalid: ${eventStream.path ?? "missing"}`);
  if (!Number.isInteger(eventStream.last_seq) || eventStream.last_seq < 1) {
    fail(`checkpoint event_stream last_seq is invalid: ${eventStream.last_seq ?? "missing"}`);
  }
  if (typeof eventStream.head_digest !== "string" || !/^[a-f0-9]{64}$/.test(eventStream.head_digest)) {
    fail("checkpoint event_stream head_digest is invalid");
  }
  const checkpointEvents = readJsonl(path.join(locations.sidecar, eventStream.path));
  const eventHead = checkpointEvents.at(-1) ?? null;
  if (eventHead?.seq !== eventStream.last_seq || eventHead?.event_digest !== eventStream.head_digest) {
    fail("checkpoint event_stream metadata does not match the frozen event head");
  }
  const checkpointState = readJson(path.join(locations.sidecar, "state.json"), "checkpoint runtime state");
  const stateEventStream = checkpointState.event_stream ?? {};
  if (stateEventStream.path !== eventStream.path
    || stateEventStream.last_seq !== eventStream.last_seq
    || stateEventStream.head_digest !== eventStream.head_digest) {
    fail("checkpoint event_stream metadata does not match the frozen runtime state");
  }
  return locations;
}

function loadRunCase(directory, manifest) {
  const snapshotDirectory = path.join(directory, "case");
  if (fs.existsSync(path.join(snapshotDirectory, "case.json"))) {
    const snapshot = loadCaseFromDirectory(manifest.case_id, snapshotDirectory);
    if (snapshot.manifest.version !== manifest.case_version) {
      fail(`frozen case version mismatch for run ${manifest.run_id}: ${manifest.case_version} != ${snapshot.manifest.version}`);
    }
    return snapshot;
  }
  const current = loadCase(manifest.case_id);
  if (current.manifest.version !== manifest.case_version) {
    fail(`benchmark run predates frozen case snapshots and its case version drifted: ${manifest.case_version} -> ${current.manifest.version}; preserve the existing report or start a new run`);
  }
  return current;
}

function installedMapflow() {
  const directory = path.join(os.homedir(), ".agents", "skills", "mapflow");
  const manifestPath = path.join(directory, "install-manifest.json");
  const runtimePath = path.join(directory, "runtime", "mapflow.mjs");
  return {
    directory,
    manifest: fs.existsSync(manifestPath) ? readJson(manifestPath, "installed Mapflow manifest") : null,
    runtime_sha256: fs.existsSync(runtimePath) ? crypto.createHash("sha256").update(fs.readFileSync(runtimePath)).digest("hex") : null,
  };
}

function resolveRun(value) {
  if (!value) fail("--run is required");
  const candidate = path.resolve(value);
  const directory = fs.existsSync(path.join(candidate, "run.json"))
    ? candidate
    : path.join(defaultBenchmarkHome(), "runs", value);
  const manifestPath = path.join(directory, "run.json");
  if (!fs.existsSync(manifestPath)) fail(`benchmark run not found: ${value}`);
  const manifest = readJson(manifestPath, "benchmark run");
  if (manifest.schema !== RUN_SCHEMA) fail(`unsupported benchmark run: ${manifest.schema}`);
  return { directory, manifest, case: loadRunCase(directory, manifest) };
}

function commandDoctor({ json = false } = {}) {
  const results = listCaseIds().map((caseId) => {
    const item = loadCase(caseId);
    const fixture = casePath(item, item.manifest.fixture, "fixture");
    const mainline = casePath(item, item.manifest.operator_mainline, "operator_mainline");
    const checkpointIds = item.oracle.checkpoints.map((checkpoint) => checkpoint.id);
    const problems = [];
    const requiredFields = ["title", "tier", "target_user", "core_job", "critical_journey", "expected_first_value", "budget", "primary_risks", "required_checkpoints"];
    for (const field of requiredFields) {
      if (item.manifest[field] === undefined || item.manifest[field] === null) problems.push(`case field is missing: ${field}`);
    }
    if (!new Set(["core", "extended"]).has(item.manifest.tier)) problems.push(`case tier is invalid: ${item.manifest.tier}`);
    if (!fs.existsSync(fixture) || !fs.statSync(fixture).isDirectory()) problems.push("fixture directory is missing");
    if (!fs.existsSync(mainline)) problems.push("operator mainline is missing");
    const mainlineText = fs.existsSync(mainline) ? fs.readFileSync(mainline, "utf8") : "";
    const modelFacingInputs = [...mainlineText.matchAll(/```text\s*([\s\S]*?)```/g)].map((match) => match[1]);
    if (!modelFacingInputs.length) problems.push("operator mainline has no fenced natural-language inputs");
    if (modelFacingInputs.length && !/启用\s*mapflow/i.test(modelFacingInputs[0])) problems.push("first operator input does not use the natural-language Mapflow entry");
    const leakedTerms = modelFacingInputs.flatMap((input) => input.match(/Task Brief|proof gap|Predicate|Evidence|Work Edge|工作边|反向目标回归|正向可达|到达审计/g) ?? []);
    if (leakedTerms.length) problems.push(`model-facing input leaks Mapflow route terms: ${[...new Set(leakedTerms)].join(", ")}`);
    const coaching = PROCESS_COACHING_PATTERNS
      .filter(({ pattern }) => modelFacingInputs.some((input) => {
        pattern.lastIndex = 0;
        return pattern.test(input);
      }))
      .map(({ label }) => label);
    if (coaching.length) problems.push(`model-facing input coaches the expected Mapflow process: ${coaching.join(", ")}`);
    if (new Set(checkpointIds).size !== checkpointIds.length) problems.push("checkpoint ids are not unique");
    if (!checkpointIds.length) problems.push("oracle has no checkpoints");
    let checkpointCursor = -1;
    for (const required of item.manifest.required_checkpoints ?? []) {
      if (!checkpointIds.includes(required)) problems.push(`required checkpoint is absent: ${required}`);
      const position = mainlineText.indexOf(`checkpoint: ${required}`, checkpointCursor + 1);
      if (position < 0) problems.push(`operator mainline does not reference checkpoint in order: ${required}`);
      else checkpointCursor = position;
    }
    for (const smoke of item.manifest.smoke_checkpoints ?? []) {
      if (!checkpointIds.includes(smoke)) problems.push(`smoke checkpoint is absent: ${smoke}`);
      if (!(item.manifest.required_checkpoints ?? []).includes(smoke)) problems.push(`smoke checkpoint is not required: ${smoke}`);
    }
    const segmentIds = new Set();
    for (const segment of item.manifest.segments ?? []) {
      if (!segment.id || !/^[a-z][a-z0-9-]+$/.test(segment.id)) problems.push(`segment id is invalid: ${segment.id ?? "missing"}`);
      else if (segmentIds.has(segment.id)) problems.push(`segment id is duplicated: ${segment.id}`);
      else segmentIds.add(segment.id);
      const fromIndex = checkpointIds.indexOf(segment.from_checkpoint);
      const toIndex = checkpointIds.indexOf(segment.to_checkpoint);
      if (fromIndex < 0) problems.push(`segment start checkpoint is absent: ${segment.from_checkpoint ?? "missing"}`);
      if (toIndex < 0) problems.push(`segment target checkpoint is absent: ${segment.to_checkpoint ?? "missing"}`);
      if (fromIndex >= 0 && toIndex >= 0 && fromIndex >= toIndex) problems.push(`segment must move forward: ${segment.id}`);
      if (typeof segment.operator_input !== "string" || !segment.operator_input.trim()) problems.push(`segment operator_input is missing: ${segment.id}`);
      if (!Number.isFinite(segment.budget?.max_minutes) || segment.budget.max_minutes <= 0) problems.push(`segment max_minutes is invalid: ${segment.id}`);
      if (!Number.isFinite(segment.budget?.max_turns) || segment.budget.max_turns <= 0) problems.push(`segment max_turns is invalid: ${segment.id}`);
      if (!Array.isArray(segment.covers) || !segment.covers.length) problems.push(`segment coverage is missing: ${segment.id}`);
      if (!Array.isArray(segment.expected_event_types) || !segment.expected_event_types.length
        || segment.expected_event_types.some((type) => typeof type !== "string" || !type.trim())) {
        problems.push(`segment expected_event_types is missing or invalid: ${segment.id}`);
      }
      if (typeof segment.snapshot !== "string" || !segment.snapshot.trim()) problems.push(`segment snapshot is missing: ${segment.id}`);
      else {
        try {
          loadCheckpointPackage(casePath(item, segment.snapshot, `snapshot for ${segment.id}`), item, segment.from_checkpoint);
        } catch (error) {
          problems.push(`segment snapshot is invalid: ${segment.id}: ${error.message}`);
        }
      }
    }
    for (const checkpoint of item.oracle.checkpoints) {
      if (!checkpoint.id || typeof checkpoint.description !== "string") problems.push(`checkpoint id or description is missing: ${checkpoint.id ?? "unknown"}`);
      if (!Array.isArray(checkpoint.assertions)) problems.push(`checkpoint assertions are missing: ${checkpoint.id}`);
      if (checkpoint.verifier && !fs.existsSync(casePath(item, checkpoint.verifier, `verifier for ${checkpoint.id}`))) {
        problems.push(`checkpoint verifier is missing: ${checkpoint.verifier}`);
      }
    }
    return { case_id: caseId, version: item.manifest.version, fixture_digest: directoryDigest(fixture), problems };
  });
  const impactPath = path.join(ROOT, "benchmarks", "impact-map.json");
  let impact = { passed: true, problems: [] };
  try {
    const manifest = readJson(impactPath, "benchmark impact map");
    if (manifest.schema !== IMPACT_SCHEMA) impact.problems.push(`unsupported impact map: ${manifest.schema}`);
    if (!Array.isArray(manifest.rules) || !manifest.rules.length) impact.problems.push("impact map rules are missing");
    const ruleIds = new Set();
    for (const rule of manifest.rules ?? []) {
      if (typeof rule.id !== "string" || !rule.id.trim()) impact.problems.push("impact map rule id is missing");
      else if (ruleIds.has(rule.id)) impact.problems.push(`impact map rule id is duplicated: ${rule.id}`);
      else ruleIds.add(rule.id);
      if (!Array.isArray(rule.paths) || !rule.paths.length || rule.paths.some((entry) => typeof entry !== "string" || !entry.trim())) {
        impact.problems.push(`impact map rule paths are missing or invalid: ${rule.id ?? "unknown"}`);
      }
      const invalidLayers = !Array.isArray(rule.layers) || !rule.layers.length
        ? ["missing"]
        : rule.layers.filter((layer) => !new Set(["oracle", "runtime", "agent"]).has(layer));
      if (invalidLayers.length) impact.problems.push(`impact map rule layers are invalid: ${rule.id ?? "unknown"}: ${invalidLayers.join(", ")}`);
      for (const selection of rule.segments ?? []) {
        const [caseId, segmentId, extra] = String(selection).split(":");
        try {
          if (!caseId || !segmentId || extra) fail("must use CASE:SEGMENT");
          segmentFor(loadCase(caseId), segmentId);
        } catch (error) {
          impact.problems.push(`impact map segment is invalid: ${selection}: ${error.message}`);
        }
      }
    }
  } catch (error) {
    impact.problems.push(error.message);
  }
  impact.passed = impact.problems.length === 0;
  const scope = {
    kind: "case-package-validation",
    validated: ["case manifests", "operator inputs", "Oracle contracts", "checkpoint packages", "impact map"],
    not_run: ["runtime tests", "Agent segments", "complete journeys", "release matrix"],
  };
  const output = {
    schema: "mapflow.benchmark-doctor/v1",
    scope,
    cases: results,
    impact,
    passed: results.every((item) => item.problems.length === 0) && impact.passed,
    boundary: "Doctor validates benchmark package contracts only. It does not execute Runtime, Agent, journey, or release tests.",
  };
  if (json) process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  else {
    process.stdout.write("SCOPE case-package validation only; tests executed: none\n");
    for (const result of results) process.stdout.write(`${result.problems.length ? "FAIL" : "PASS"} case-package ${result.case_id}@${result.version}${result.problems.length ? `: ${result.problems.join("; ")}` : ""}\n`);
    process.stdout.write(`${impact.passed ? "PASS" : "FAIL"} case-package impact-map${impact.problems.length ? `: ${impact.problems.join("; ")}` : ""}\n`);
    process.stdout.write(`NOT RUN ${scope.not_run.join(", ")}\n`);
  }
  if (!output.passed) process.exitCode = 1;
  return output;
}

function copyDirectoryContents(source, target) {
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    fs.cpSync(path.join(source, entry.name), path.join(target, entry.name), {
      recursive: true,
      errorOnExist: true,
    });
  }
}

function initializeFixtureRepository(item, target) {
  fs.mkdirSync(target, { recursive: true });
  copyDirectoryContents(casePath(item, item.manifest.fixture, "fixture"), target);
  let result = git(["init", "--quiet"], target);
  if (result.status !== 0) fail(`git init failed: ${result.stderr}`);
  result = git(["add", "."], target);
  if (result.status !== 0) fail(`git add failed: ${result.stderr}`);
  result = git(["-c", "user.name=Local Developer", "-c", "user.email=local-developer@example.invalid", "commit", "--quiet", "-m", "Initial project state"], target);
  if (result.status !== 0) fail(`fixture commit failed: ${result.stderr}`);
  return git(["rev-parse", "HEAD"], target).stdout.trim();
}

function commandList({ json = false } = {}) {
  const cases = listCaseIds().map((caseId) => {
    const { manifest } = loadCase(caseId);
    return { id: caseId, version: manifest.version, tier: manifest.tier, title: manifest.title, primary_risks: manifest.primary_risks };
  });
  if (json) process.stdout.write(`${JSON.stringify(cases, null, 2)}\n`);
  else for (const item of cases) process.stdout.write(`${item.id}@${item.version} [${item.tier}] ${item.title}\n`);
}

function commandPrepare(options) {
  const item = loadCase(options.case);
  if (!options.target || !path.isAbsolute(options.target)) fail("--target must be an absolute path");
  const target = path.resolve(options.target);
  const mapflowHome = path.resolve(defaultMapflowHome());
  const benchmarkHome = path.resolve(defaultBenchmarkHome());
  if (relativeInside(ROOT, target)) fail("benchmark target must be outside the Mapflow source repository");
  assertBlindStorageIsolation({ target, mapflowHome, benchmarkHome });
  if (fs.existsSync(target) && fs.readdirSync(target).length > 0) fail(`benchmark target must be absent or empty: ${target}`);
  fs.mkdirSync(target, { recursive: true });
  const workspaceBefore = resolveWorkspace({ root: target, mapflowHome, create: false });
  if (workspaceBefore.exists) fail(`benchmark target already has a Mapflow sidecar: ${workspaceBefore.directory}`);

  const fixture = casePath(item, item.manifest.fixture, "fixture");
  const baselineCommit = initializeFixtureRepository(item, target);
  const benchmarkCommit = git(["rev-parse", "HEAD"], ROOT).stdout.trim() || null;
  const runId = `${item.id}-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${crypto.randomBytes(3).toString("hex")}`;
  const runDirectory = path.join(benchmarkHome, "runs", runId);
  const frozenCaseDirectory = path.join(runDirectory, "case");
  fs.cpSync(item.directory, frozenCaseDirectory, { recursive: true, errorOnExist: true });
  const frozenCase = loadCaseFromDirectory(item.id, frozenCaseDirectory);
  const installed = installedMapflow();
  const runManifest = {
    schema: RUN_SCHEMA,
    run_mode: "full",
    run_id: runId,
    suite_version: SUITE_VERSION,
    case_id: item.id,
    case_version: item.manifest.version,
    trial: Number(options.trial ?? 1),
    created_at: now(),
    target_root: fs.realpathSync.native(target),
    baseline_commit: baselineCommit,
    fixture_digest: directoryDigest(fixture),
    case_digest: directoryDigest(frozenCaseDirectory),
    benchmark_commit: benchmarkCommit,
    benchmark_dirty: git(["status", "--porcelain"], ROOT).stdout.trim() !== "",
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      mapflow_home: mapflowHome,
      benchmark_home: benchmarkHome,
    },
    isolation: {
      storage_disjoint: true,
      target_path_neutral: true,
      required_codex_flags: ["--disable memories", "--disable multi_agent"],
      forbidden_codex_flags: ["--ephemeral"],
      session_policy: "start one fresh persisted session; resume it for ordinary turns; start another fresh session only when the case explicitly tests cross-session recovery",
      child_environment: ["MAPFLOW_HOME"],
      forbidden_child_environment: ["MAPFLOW_BENCHMARK_HOME"],
    },
    mapflow: {
      version: installed.manifest?.version ?? null,
      profile: installed.manifest?.profile ?? null,
      installed_at: installed.manifest?.installed_at ?? null,
      runtime_sha256: installed.runtime_sha256,
    },
    operator_mainline: casePath(frozenCase, frozenCase.manifest.operator_mainline, "operator_mainline"),
    oracle: path.join(frozenCase.directory, "oracle", "checkpoints.json"),
  };
  writeJson(path.join(runDirectory, "run.json"), runManifest);
  const output = {
    run_id: runId,
    run_directory: runDirectory,
    target_root: runManifest.target_root,
    baseline_commit: baselineCommit,
    operator_mainline: runManifest.operator_mainline,
    smoke_checkpoints: item.manifest.smoke_checkpoints ?? [],
    isolation: runManifest.isolation,
    warnings: runManifest.benchmark_dirty
      ? ["Mapflow source worktree is dirty. You may continue a development smoke or debugging run, but do not use this run as release-candidate evidence."]
      : [],
    first_action: `在 Mapflow 维护仓库运行 agent-turn --run ${runManifest.run_id} --turn opening，并只传入主线第一轮用户输入；该命令会在 ${runManifest.target_root} 启动隔离的持久化 Codex 会话。普通后续轮把返回的 session_id 传给 --session。不要把主线文档或 Oracle 放入模型上下文。`,
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

function commandCheckpointSave(options) {
  const runItem = resolveRun(options.run);
  const checkpointId = options.checkpoint;
  const checkpoint = runItem.case.oracle.checkpoints.find((entry) => entry.id === checkpointId);
  if (!checkpoint) fail(`unknown checkpoint for ${runItem.case.id}: ${checkpointId ?? "missing"}`);
  const localChecks = readJsonl(path.join(runItem.directory, "checks.jsonl"));
  const persisted = [...localChecks].reverse().find((entry) => entry.checkpoint === checkpointId && entry.passed === true);
  if (!persisted) fail(`checkpoint must have a persisted passing check before it can be saved: ${checkpointId}`);
  const evaluation = evaluateCheckpoint(runItem, checkpoint, { runVerifier: true });
  if (!evaluation.passed) fail(`checkpoint no longer passes in the current workspace: ${checkpointId}`);

  const workspace = resolveWorkspace({
    root: runItem.manifest.target_root,
    mapflowHome: runItem.manifest.environment?.mapflow_home ?? null,
    create: false,
  });
  if (!workspace.exists) fail("checkpoint save requires an existing Sidecar");
  const output = options.output
    ? path.resolve(options.output)
    : path.join(runItem.directory, "checkpoints", checkpointId);
  if (relativeInside(runItem.manifest.target_root, output) || relativeInside(workspace.directory, output)) {
    fail("checkpoint package must be outside the target workspace and Sidecar");
  }
  if (fs.existsSync(output) && fs.readdirSync(output).length > 0) fail(`checkpoint output must be absent or empty: ${output}`);
  fs.mkdirSync(output, { recursive: true });
  const targetDirectory = path.join(output, "target");
  const sidecarDirectory = path.join(output, "sidecar");
  copyTreeWithoutGit(runItem.manifest.target_root, targetDirectory);
  fs.cpSync(path.dirname(workspace.mapPath), sidecarDirectory, { recursive: true, errorOnExist: true });

  const contextChecks = runRecords(runItem, "checks").filter((entry) => !persisted.at || !entry.at || entry.at <= persisted.at);
  const contextTurns = runRecords(runItem, "turns")
    .filter((entry) => !persisted.at || !entry.at || entry.at <= persisted.at);
  const checksPath = path.join(output, "context", "checks.jsonl");
  const turnsPath = path.join(output, "context", "turns.jsonl");
  writeJsonl(checksPath, contextChecks);
  writeJsonl(turnsPath, contextTurns);
  const fixture = casePath(runItem.case, runItem.case.manifest.fixture, "fixture");
  const manifest = {
    schema: CHECKPOINT_SCHEMA,
    created_at: now(),
    source_run_id: runItem.manifest.run_id,
    source_suite_version: runItem.manifest.suite_version,
    source_case_version: runItem.manifest.case_version,
    case_id: runItem.case.id,
    checkpoint: checkpointId,
    fixture_digest: directoryDigest(fixture),
    checkpoint_contract_digest: checkpointContractDigest(runItem.case, checkpointId),
    event_stream: readJson(workspace.statePath, "checkpoint runtime state").event_stream ?? null,
    mapflow: runItem.manifest.mapflow,
    digests: {
      target: directoryDigest(targetDirectory),
      sidecar: directoryDigest(sidecarDirectory),
      checks: fileDigest(checksPath),
      turns: fileDigest(turnsPath),
    },
    boundary: "This package is a benchmark fixture captured from a passing checkpoint, not proof that a new run or current runtime passes.",
  };
  writeJson(path.join(output, "checkpoint.json"), manifest);
  process.stdout.write(`${JSON.stringify({ checkpoint: checkpointId, output, manifest }, null, 2)}\n`);
}

function commandSegmentPrepare(options) {
  const item = loadCase(options.case);
  const segment = segmentFor(item, options.segment);
  if (!options.target || !path.isAbsolute(options.target)) fail("--target must be an absolute path");
  const target = path.resolve(options.target);
  const mapflowHome = path.resolve(defaultMapflowHome());
  const benchmarkHome = path.resolve(defaultBenchmarkHome());
  if (relativeInside(ROOT, target)) fail("benchmark target must be outside the Mapflow source repository");
  assertBlindStorageIsolation({ target, mapflowHome, benchmarkHome });
  if (fs.existsSync(target) && fs.readdirSync(target).length > 0) fail(`benchmark target must be absent or empty: ${target}`);
  fs.mkdirSync(target, { recursive: true });
  const workspaceBefore = resolveWorkspace({ root: target, mapflowHome, create: false });
  if (workspaceBefore.exists) fail(`benchmark target already has a Mapflow sidecar: ${workspaceBefore.directory}`);

  const snapshotDirectory = options.snapshot
    ? path.resolve(options.snapshot)
    : casePath(item, segment.snapshot, `snapshot for ${segment.id}`);
  const checkpointPackage = loadCheckpointPackage(snapshotDirectory, item, segment.from_checkpoint);
  const baselineCommit = initializeFixtureRepository(item, target);
  clearTreeWithoutGit(target);
  copyTreeWithoutGit(checkpointPackage.target, target);
  if (fs.existsSync(path.join(target, ".mapflow"))) fail("checkpoint target contains forbidden project-local .mapflow state");
  const workspace = resolveWorkspace({ root: target, mapflowHome, create: true });
  const current = path.dirname(workspace.mapPath);
  fs.rmSync(current, { recursive: true, force: true });
  fs.cpSync(checkpointPackage.sidecar, current, { recursive: true, errorOnExist: true });

  const runId = `${item.id}-${segment.id}-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${crypto.randomBytes(3).toString("hex")}`;
  const runDirectory = path.join(benchmarkHome, "runs", runId);
  const frozenCaseDirectory = path.join(runDirectory, "case");
  fs.cpSync(item.directory, frozenCaseDirectory, { recursive: true, errorOnExist: true });
  const frozenCase = loadCaseFromDirectory(item.id, frozenCaseDirectory);
  const installed = installedMapflow();
  const runManifest = {
    schema: RUN_SCHEMA,
    run_mode: "segment",
    run_id: runId,
    suite_version: SUITE_VERSION,
    case_id: item.id,
    case_version: item.manifest.version,
    trial: Number(options.trial ?? 1),
    created_at: now(),
    target_root: fs.realpathSync.native(target),
    baseline_commit: baselineCommit,
    fixture_digest: directoryDigest(casePath(item, item.manifest.fixture, "fixture")),
    case_digest: directoryDigest(frozenCaseDirectory),
    benchmark_commit: git(["rev-parse", "HEAD"], ROOT).stdout.trim() || null,
    benchmark_dirty: git(["status", "--porcelain"], ROOT).stdout.trim() !== "",
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      mapflow_home: mapflowHome,
      benchmark_home: benchmarkHome,
    },
    isolation: {
      storage_disjoint: true,
      target_path_neutral: true,
      required_codex_flags: ["--disable memories", "--disable multi_agent"],
      forbidden_codex_flags: ["--ephemeral"],
      session_policy: "start one fresh persisted session from the frozen checkpoint; do not inherit the source run session",
      child_environment: ["MAPFLOW_HOME"],
      forbidden_child_environment: ["MAPFLOW_BENCHMARK_HOME"],
    },
    mapflow: {
      version: installed.manifest?.version ?? null,
      profile: installed.manifest?.profile ?? null,
      installed_at: installed.manifest?.installed_at ?? null,
      runtime_sha256: installed.runtime_sha256,
    },
    segment: {
      id: segment.id,
      from_checkpoint: segment.from_checkpoint,
      to_checkpoint: segment.to_checkpoint,
      budget: segment.budget,
      covers: segment.covers,
      source_checkpoint: checkpointPackage.manifest.source_run_id,
      checkpoint_digests: checkpointPackage.manifest.digests,
      source_event_revision: checkpointPackage.manifest.event_stream?.last_seq ?? null,
    },
    operator_mainline: casePath(frozenCase, frozenCase.manifest.operator_mainline, "operator_mainline"),
    oracle: path.join(frozenCase.directory, "oracle", "checkpoints.json"),
  };
  writeJson(path.join(runDirectory, "run.json"), runManifest);
  const contextDirectory = path.join(runDirectory, "checkpoint-context");
  fs.mkdirSync(contextDirectory, { recursive: true });
  fs.copyFileSync(checkpointPackage.checks, path.join(contextDirectory, "checks.jsonl"));
  fs.copyFileSync(checkpointPackage.turns, path.join(contextDirectory, "turns.jsonl"));
  const runItem = { directory: runDirectory, manifest: runManifest, case: frozenCase };
  const sourceCheckpoint = frozenCase.oracle.checkpoints.find((entry) => entry.id === segment.from_checkpoint);
  const evaluation = evaluateCheckpoint(runItem, sourceCheckpoint, { runVerifier: true });
  if (!evaluation.passed) fail(`restored checkpoint does not pass current Oracle: ${segment.from_checkpoint}`);
  process.stdout.write(`${JSON.stringify({
    run_id: runId,
    run_directory: runDirectory,
    run_mode: "segment",
    segment: segment.id,
    from_checkpoint: segment.from_checkpoint,
    to_checkpoint: segment.to_checkpoint,
    target_root: runManifest.target_root,
    first_action: `node tools/benchmark.mjs segment-turn --run ${runId}`,
    boundary: "This run can prove only the declared segment. It cannot be used by full report or suite-report.",
  }, null, 2)}\n`);
}

function countMarkdown(directory) {
  return walkFiles(directory).filter((filePath) => filePath.toLowerCase().endsWith(".md")).length;
}

function boardObservation(runManifest) {
  const target = runManifest.target_root;
  const workspace = resolveWorkspace({
    root: target,
    mapflowHome: runManifest.environment?.mapflow_home ?? null,
    create: false,
  });
  const snapshot = createBoardSnapshotReader({ statePath: workspace.statePath })();
  const model = snapshot.model;
  const draftNodes = model.wayfinding?.draft_nodes ?? [];
  const draftEdges = model.wayfinding?.draft_edges ?? [];
  const destinationStatus = model.map?.destination?.status ?? model.map?.destination_status ?? "draft";
  const gitStatus = git(["status", "--porcelain"], target).stdout.trim().split(/\r?\n/).filter(Boolean);
  const trackedChanges = git(["diff", "--name-only", runManifest.baseline_commit], target).stdout.trim().split(/\r?\n/).filter(Boolean);
  const untrackedChanges = git(["ls-files", "--others", "--exclude-standard"], target).stdout.trim().split(/\r?\n/).filter(Boolean);
  const changed = [...new Set([...trackedChanges, ...untrackedChanges])].sort();
  const state = fs.existsSync(workspace.statePath) ? readJson(workspace.statePath, "runtime state") : null;
  const runtimeBlueprint = state?.blueprint_snapshot ?? null;
  const predicateById = new Map((runtimeBlueprint?.predicates ?? model.predicates ?? []).map((predicate) => [predicate.id, predicate]));
  const initiallyUnknownFacts = new Set((runtimeBlueprint?.initial_state?.facts ?? [])
    .filter((fact) => ["unknown", "conflict"].includes(fact.value))
    .map((fact) => fact.id));
  const nodeById = new Map((runtimeBlueprint?.nodes ?? []).map((node) => [node.id, node]));
  const probeEdges = (model.edges ?? []).filter((edge) => (
    (nodeById.get(edge.from)?.predicates ?? []).some((predicateId) => initiallyUnknownFacts.has(predicateById.get(predicateId)?.fact))
  ));
  const probeEffects = new Set(probeEdges.flatMap((edge) => edge.effects ?? []));
  const probeDependentEdges = (model.edges ?? []).filter((edge) => (
    !probeEdges.some((probe) => probe.id === edge.id)
    && (edge.preconditions ?? []).some((predicateId) => probeEffects.has(predicateId))
  ));
  const authorizationRequests = state?.authorization_requests ?? [];
  const arrivalAuditRequests = state?.arrival_audit_requests ?? [];
  const runs = state?.edge_runs ?? [];
  const grantedAuthorizationIds = new Set(authorizationRequests.filter((request) => request.status === "granted").map((request) => request.id));
  const grantedArrivalAuditIds = new Set(arrivalAuditRequests.filter((request) => request.status === "granted").map((request) => request.id));
  const edgeById = new Map((model.edges ?? []).map((edge) => [edge.id, edge]));
  const runsFollowAuthorizationContract = runs.every((run) => {
    const required = edgeById.get(run.edge)?.brief?.metadata?.contract?.authorization?.required ?? [];
    if (required.length > 0) {
      return typeof run.authorization_request === "string" && grantedAuthorizationIds.has(run.authorization_request);
    }
    return run.authorization_request === undefined || run.authorization_request === null;
  });
  const formalNodes = (model.nodes ?? []).filter((node) => !node.projection_only && !node.draft);
  const formalEdges = (model.edges ?? []).filter((edge) => !edge.projection_only && !edge.draft);
  const designPredicateIds = new Set(["domain-model-ready", "api-contract-ready", "engineering-design-reviewed"]);
  const predicateIdsOf = (node) => (node.predicates ?? []).map((predicate) => typeof predicate === "string" ? predicate : predicate.id);
  const designCandidateNodes = draftNodes.filter((node) => predicateIdsOf(node).some((predicateId) => designPredicateIds.has(predicateId)));
  const designCandidateEdges = draftEdges.filter((edge) => (edge.effects ?? []).some((predicateId) => designPredicateIds.has(predicateId)));
  const implementationCandidateEdges = draftEdges.filter((edge) => /^(?:build|implement|code)-/.test(edge.id));
  const candidateImplementationRequiresDesign = implementationCandidateEdges.length > 0
    && implementationCandidateEdges.every((edge) => (edge.preconditions ?? []).includes("engineering-design-reviewed"));
  const designFormalNodes = formalNodes.filter((node) => predicateIdsOf(node).some((predicateId) => designPredicateIds.has(predicateId)));
  const designFormalEdges = formalEdges.filter((edge) => (edge.effects ?? []).some((predicateId) => designPredicateIds.has(predicateId)));
  const formalImplementationEdges = formalEdges.filter((edge) => /^(?:build|implement|code)-/.test(edge.id));
  const implementationRequiresDesign = formalImplementationEdges.length > 0
    && formalImplementationEdges.every((edge) => (edge.preconditions ?? []).includes("engineering-design-reviewed"));
  const nodeKind = new Map(formalNodes.map((node) => [node.id, node.kind]));
  const outgoing = new Map();
  const incoming = new Map();
  for (const edge of formalEdges) {
    outgoing.set(edge.from, (outgoing.get(edge.from) ?? 0) + 1);
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  }
  const independentBranchPairs = [];
  for (let leftIndex = 0; leftIndex < formalEdges.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < formalEdges.length; rightIndex += 1) {
      const left = formalEdges[leftIndex];
      const right = formalEdges[rightIndex];
      if (left.from !== right.from || left.to !== right.to || nodeKind.get(left.to) !== "join") continue;
      const leftRequirements = new Set(left.preconditions ?? []);
      const rightRequirements = new Set(right.preconditions ?? []);
      const independent = !(left.effects ?? []).some((predicateId) => rightRequirements.has(predicateId) || (right.effects ?? []).includes(predicateId))
        && !(right.effects ?? []).some((predicateId) => leftRequirements.has(predicateId));
      if (independent) independentBranchPairs.push([left.id, right.id]);
    }
  }
  const branchingNodes = [...outgoing.values()].filter((count) => count > 1).length;
  const andJoinNodes = formalNodes.filter((node) => node.kind === "join" && (incoming.get(node.id) ?? 0) > 1).length;
  return {
    workspace: {
      sidecar_exists: workspace.exists,
      id: workspace.workspace_id,
      sidecar: workspace.directory,
      sidecar_inside_target: relativeInside(target, workspace.directory),
      map_exists: fs.existsSync(workspace.mapPath),
      wayfinding_exists: fs.existsSync(workspace.wayfindingPath),
      state_exists: fs.existsSync(workspace.statePath),
      events_exists: fs.existsSync(workspace.eventsPath),
      briefs_count: countMarkdown(workspace.briefsPath),
    },
    repo: {
      root: target,
      mapflow_path_exists: fs.existsSync(path.join(target, ".mapflow")),
      dirty_paths: gitStatus,
      changed_paths: changed,
      commit_count: Number(git(["rev-list", "--count", "HEAD"], target).stdout.trim() || 0),
    },
    projection: model.projection,
    summary: model.summary,
    contract: {
      intent_status: model.map?.intent?.status ?? null,
      destination_predicates: model.map?.destination?.requires?.length ?? 0,
      destination_invariants: model.map?.destination?.invariants?.length ?? 0,
      destination_acceptance: model.map?.destination?.acceptance?.length ?? 0,
      in_scope: model.map?.boundaries?.in_scope?.length ?? 0,
      out_of_scope: model.map?.boundaries?.out_of_scope?.length ?? 0,
      authorization_rules: model.map?.boundaries?.authorization?.length ?? 0,
      edge_contracts_complete: (model.edges?.length ?? 0) > 0 && model.edges.every((edge) => (
        edge.brief?.content
        && edge.preconditions?.length
        && edge.effects?.length
        && edge.evidence_contract?.length
        && edge.non_goals?.length
        && edge.on_failure
      )),
    },
    wayfinding: {
      phase: model.wayfinding?.phase ?? null,
      current_question_id: model.wayfinding?.current_question_id ?? null,
      current_target_kind: model.wayfinding?.current_target?.kind ?? null,
      open_questions: model.summary?.open_questions ?? 0,
      origin_visible: draftNodes.length > 0,
      destination_visible: Boolean(model.map?.destination?.id && draftNodes.some((node) => node.id === model.map.destination.id)),
      draft_nodes: model.summary?.draft_nodes ?? 0,
      draft_edges: model.summary?.draft_edges ?? 0,
      pending_regression_candidates: model.summary?.pending_regression_candidates ?? 0,
      questions_count: model.questions?.length ?? 0,
      questions_targeted: (model.questions?.length ?? 0) > 0
        && model.questions.every((question) => Boolean(question.target?.kind && question.target?.id && question.target?.purpose)),
      destination_confirmed: ["confirmed", "destination", "approved"].includes(destinationStatus),
      candidate_edges_complete: draftEdges.length > 0 && draftEdges.every((edge) => (
        edge.brief_ref
        && edge.preconditions?.length
        && edge.effects?.length
        && edge.invariants?.length
        && edge.evidence_contract?.length
        && edge.acceptance?.length
        && edge.non_goals?.length
        && edge.proof?.status
        && edge.on_failure
      )),
      design_candidate_nodes: designCandidateNodes.length,
      design_candidate_edges: designCandidateEdges.length,
      design_candidate_join: designCandidateNodes.some((node) => node.kind === "join"),
      implementation_requires_design_review: candidateImplementationRequiresDesign,
    },
    regression: {
      complete_chain: model.goal_regression?.complete_chain ?? false,
      steps: model.goal_regression?.steps?.length ?? 0,
      edges: model.goal_regression?.edge_ids?.length ?? 0,
      unclosed_terminals: model.goal_regression?.unclosed_terminals ?? [],
    },
    topology: {
      branching_nodes: branchingNodes,
      and_join_nodes: andJoinNodes,
      independent_branch_pairs: independentBranchPairs.length,
      independent_branches: independentBranchPairs,
      design_nodes: designFormalNodes.length,
      design_edges: designFormalEdges.length,
      design_join_nodes: designFormalNodes.filter((node) => node.kind === "join" && (incoming.get(node.id) ?? 0) > 1).length,
      implementation_edges_require_design_review: implementationRequiresDesign,
      pre_code_design_network: designFormalEdges.length >= 3
        && designFormalNodes.some((node) => node.kind === "join")
        && implementationRequiresDesign,
      ready_edges: model.summary?.ready_edges ?? [],
      parallel_ready_edges: model.summary?.parallel_ready_edges ?? 0,
      has_non_linear_route: branchingNodes > 0 && andJoinNodes > 0 && independentBranchPairs.length > 0,
    },
    proof: model.proof,
    runtime: {
      phase: state?.phase ?? model.map?.phase ?? null,
      destination_status: state?.destination_status ?? model.map?.destination_status ?? null,
      active_edge: state?.active_edge ?? null,
      active_run: state?.active_run ?? null,
      pending_authorizations: authorizationRequests.filter((request) => request.status === "pending").length,
      granted_authorizations: grantedAuthorizationIds.size,
      runs_follow_authorization_contract: runsFollowAuthorizationContract,
      pending_arrival_audits: arrivalAuditRequests.filter((request) => request.status === "pending").length,
      arrival_audit_requests_count: arrivalAuditRequests.length,
      arrival_audit_authorized: state?.phase !== "arrived"
        || (typeof state?.arrival_audit?.request === "string" && grantedArrivalAuditIds.has(state.arrival_audit.request)),
      actual_arrival: model.map?.actual_arrival ?? "not-audited",
      evidence_count: model.evidence?.length ?? 0,
      trusted_evidence_count: (model.evidence ?? []).filter((entry) => entry.checks?.some((check) => check.result === "pass" && check.mode !== "reported")).length,
      reported_evidence_count: (model.evidence ?? []).filter((entry) => entry.checks?.some((check) => check.mode === "reported")).length,
      action_capabilities_count: (state?.capabilities ?? []).length,
      consumed_action_capabilities: (state?.capabilities ?? []).filter((entry) => entry.status === "consumed").length,
      edge_runs_count: model.edge_runs?.length ?? 0,
      failed_or_blocked_runs: (model.edge_runs ?? []).filter((entry) => ["failed", "blocked"].includes(entry.status)).length,
      decisions_count: model.decisions?.length ?? 0,
      decisions_attributed: (model.decisions?.length ?? 0) > 0
        && model.decisions.every((decision) => /^(?:human|agent):/.test(String(decision.actor ?? ""))),
      proposals_count: model.proposals?.length ?? 0,
      history_count: state?.history?.length ?? 0,
      replan_count: (state?.history ?? []).filter((entry) => entry.type === "replan_requested").length,
      acceptance_complete: (model.summary?.acceptance_total ?? 0) > 0
        && model.summary.acceptance_passed === model.summary.acceptance_total,
      evidence_traceable: (model.evidence?.length ?? 0) > 0 && model.evidence.every((entry) => (
        entry.edge
        && entry.proves?.length
        && entry.outcome_refs?.length
        && entry.checks?.length
        && entry.executor
      )),
    },
    diagnosis: {
      initially_unknown_facts: initiallyUnknownFacts.size,
      probe_edges: probeEdges.length,
      repair_edges_after_probe: probeDependentEdges.length,
    },
    submaps: {
      count: model.submaps?.length ?? 0,
      current_receipts: (model.submaps ?? []).filter((entry) => entry.receipt_status === "current").length,
      stale: model.summary?.stale_submaps ?? 0,
    },
  };
}

function valueAt(object, dottedPath) {
  return dottedPath.split(".").reduce((value, key) => value?.[key], object);
}

function assertionResult(assertion, observation, previousChecks = []) {
  const actual = valueAt(observation, assertion.path);
  let passed = false;
  if (Object.hasOwn(assertion, "equals")) passed = JSON.stringify(actual) === JSON.stringify(assertion.equals);
  else if (Object.hasOwn(assertion, "not_equals")) passed = JSON.stringify(actual) !== JSON.stringify(assertion.not_equals);
  else if (assertion.one_of) passed = assertion.one_of.includes(actual);
  else if (Object.hasOwn(assertion, "min")) passed = Number(actual) >= assertion.min;
  else if (Object.hasOwn(assertion, "max")) passed = Number(actual) <= assertion.max;
  else if (Object.hasOwn(assertion, "includes")) passed = Array.isArray(actual) && actual.includes(assertion.includes);
  else if (assertion.empty === true) passed = Array.isArray(actual) ? actual.length === 0 : !actual;
  else if (assertion.nonempty === true) passed = Array.isArray(actual) ? actual.length > 0 : Boolean(actual);
  else if (assertion.truthy === true) passed = Boolean(actual);
  else if (assertion.falsy === true) passed = !actual;
  else if (assertion.same_as_checkpoint) {
    const previous = [...previousChecks].reverse().find((entry) => entry.checkpoint === assertion.same_as_checkpoint);
    if (!previous?.observation) fail(`checkpoint comparison is unavailable: ${assertion.same_as_checkpoint}`);
    passed = JSON.stringify(actual) === JSON.stringify(valueAt(previous.observation, assertion.path));
  }
  else fail(`assertion has no supported operator: ${assertion.path}`);
  return { ...assertion, actual, passed };
}

function explicitHumanConfirmationAfterOpening(turns) {
  return turns.some((entry, index) => {
    if (index === 0) return false;
    const input = String(entry.input ?? "");
    if (/(?:暂不|不)(?:确认|批准|同意|接受)/.test(input)) return false;
    return /(?:确认|批准|同意|接受)|\b(?:confirm|approve|accept)(?:ed)?\b/i.test(input);
  });
}

function hardGateResults(observation, turns = []) {
  const gates = [
    { id: "sidecar-outside-target", actual: observation.workspace.sidecar_inside_target, expected: false, passed: observation.workspace.sidecar_inside_target === false },
    { id: "no-project-local-mapflow", actual: observation.repo.mapflow_path_exists, expected: false, passed: observation.repo.mapflow_path_exists === false },
    { id: "projection-contract-is-read-only", actual: observation.projection.read_only, expected: true, passed: observation.projection.read_only === true },
  ];
  if (observation.runtime.actual_arrival === "audited") {
    gates.push({ id: "arrival-requires-all-acceptance", actual: observation.runtime.acceptance_complete, expected: true, passed: observation.runtime.acceptance_complete === true });
  }
  if (observation.runtime.edge_runs_count > 0) {
    gates.push({
      id: "edge-runs-follow-brief-authorization",
      actual: observation.runtime.runs_follow_authorization_contract,
      expected: true,
      passed: observation.runtime.runs_follow_authorization_contract === true,
    });
  }
  const confirmationRequired = observation.wayfinding.destination_confirmed
    || observation.workspace.map_exists
    || observation.workspace.briefs_count > 0;
  if (confirmationRequired) {
    const confirmedAfterOpening = explicitHumanConfirmationAfterOpening(turns);
    gates.push({
      id: "destination-requires-later-human-confirmation",
      actual: confirmedAfterOpening,
      expected: true,
      passed: confirmedAfterOpening,
    });
  }
  return gates;
}

function runRecords(runItem, name) {
  return [
    ...readJsonl(path.join(runItem.directory, "checkpoint-context", `${name}.jsonl`)),
    ...readJsonl(path.join(runItem.directory, `${name}.jsonl`)),
  ];
}

function evaluateCheckpoint(runItem, checkpoint, { observation = null, turns = null, previousChecks = null, runVerifier = false } = {}) {
  const currentObservation = observation ?? boardObservation(runItem.manifest);
  const checkHistory = previousChecks ?? runRecords(runItem, "checks");
  const turnHistory = turns ?? runRecords(runItem, "turns");
  const assertions = checkpoint.assertions.map((assertion) => assertionResult(assertion, currentObservation, checkHistory));
  const hardGates = hardGateResults(currentObservation, turnHistory);
  let verifier = null;
  if (checkpoint.verifier && runVerifier) {
    const verifierPath = casePath(runItem.case, checkpoint.verifier, `verifier for ${checkpoint.id}`);
    const result = run(process.execPath, [verifierPath, runItem.manifest.target_root], { cwd: runItem.manifest.target_root });
    verifier = { status: result.status, passed: result.status === 0, stdout: result.stdout, stderr: result.stderr };
  }
  return {
    observation: currentObservation,
    assertions,
    hard_gates: hardGates,
    verifier,
    passed: assertions.every((entry) => entry.passed)
      && hardGates.every((entry) => entry.passed)
      && (verifier?.passed ?? true),
  };
}

function commandProbe(options) {
  const runItem = resolveRun(options.run);
  const checkpoint = runItem.case.oracle.checkpoints.find((entry) => entry.id === options.checkpoint);
  if (!checkpoint) fail(`unknown checkpoint for ${runItem.case.id}: ${options.checkpoint ?? "missing"}; available: ${runItem.case.oracle.checkpoints.map((entry) => entry.id).join(", ")}`);
  if (checkpoint.verifier) fail(`probe is only available for checkpoints without a hidden verifier: ${checkpoint.id}`);
  const observation = boardObservation(runItem.manifest);
  const previousChecks = runRecords(runItem, "checks");
  const turns = runRecords(runItem, "turns");
  const assertions = checkpoint.assertions.map((assertion) => assertionResult(assertion, observation, previousChecks));
  const hardGates = hardGateResults(observation, turns);
  const ready = assertions.every((entry) => entry.passed) && hardGates.every((entry) => entry.passed);
  const result = {
    schema: "mapflow.benchmark-probe/v1",
    at: now(),
    checkpoint: checkpoint.id,
    description: checkpoint.description,
    ready,
    persisted: false,
    assertions,
    hard_gates: hardGates,
  };
  if (options.json === true) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else process.stdout.write(`${ready ? "READY" : "NOT READY"} ${checkpoint.id} - no checkpoint evidence was written\n`);
}

function commandCheck(options) {
  const runItem = resolveRun(options.run);
  const checkpoint = runItem.case.oracle.checkpoints.find((entry) => entry.id === options.checkpoint);
  if (!checkpoint) fail(`unknown checkpoint for ${runItem.case.id}: ${options.checkpoint ?? "missing"}; available: ${runItem.case.oracle.checkpoints.map((entry) => entry.id).join(", ")}`);
  const observation = boardObservation(runItem.manifest);
  const previousChecks = runRecords(runItem, "checks");
  const turns = runRecords(runItem, "turns");
  const assertions = checkpoint.assertions.map((assertion) => assertionResult(assertion, observation, previousChecks));
  const hardGates = hardGateResults(observation, turns);
  const timestamp = now();
  const evidenceDirectory = path.join(runItem.directory, "evidence");
  fs.mkdirSync(evidenceDirectory, { recursive: true });
  const safeTime = timestamp.replace(/[:]/g, "-");
  let verifier = null;
  if (checkpoint.verifier) {
    const verifierPath = casePath(runItem.case, checkpoint.verifier, `verifier for ${checkpoint.id}`);
    const result = run(process.execPath, [verifierPath, runItem.manifest.target_root], { cwd: runItem.manifest.target_root });
    const detailPath = path.join(evidenceDirectory, `${safeTime}-${checkpoint.id}-verifier.txt`);
    fs.writeFileSync(detailPath, `status: ${result.status}\n\nstdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`, "utf8");
    verifier = {
      status: result.status,
      passed: result.status === 0,
      detail_path: detailPath,
      operator_notice: result.status === 0
        ? "hidden result Oracle passed"
        : "hidden result Oracle failed; do not send its private output or implementation clues to the tested model",
    };
  }
  const passed = assertions.every((entry) => entry.passed) && hardGates.every((entry) => entry.passed) && (verifier?.passed ?? true);
  const required = runItem.case.manifest.required_checkpoints ?? [];
  const checkpointIndex = required.indexOf(checkpoint.id);
  const nextCheckpoint = checkpointIndex >= 0 ? required[checkpointIndex + 1] ?? null : null;
  writeJson(path.join(evidenceDirectory, `${safeTime}-${checkpoint.id}-observation.json`), observation);
  fs.writeFileSync(path.join(evidenceDirectory, `${safeTime}-${checkpoint.id}-git.txt`), `${git(["status", "--short"], runItem.manifest.target_root).stdout}\n--- diff ---\n${git(["diff", runItem.manifest.baseline_commit], runItem.manifest.target_root).stdout}`, "utf8");
  const record = {
    schema: "mapflow.benchmark-check/v1",
    at: timestamp,
    checkpoint: checkpoint.id,
    description: checkpoint.description,
    passed,
    next_checkpoint: passed ? nextCheckpoint : checkpoint.id,
    next_action: passed
      ? (nextCheckpoint ? `continue operator mainline until checkpoint: ${nextCheckpoint}` : "all required checkpoints have observations; score remaining turns and run report")
      : "stop the mainline, preserve this failure, and record a finding; only use a deviation branch when the current checkpoint documents one",
    operator_mainline: runItem.manifest.operator_mainline,
    assertions,
    hard_gates: hardGates,
    verifier,
    observation,
  };
  appendJsonl(path.join(runItem.directory, "checks.jsonl"), record);
  if (options.json === true) process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
  else {
    process.stdout.write(`${passed ? "PASS" : "FAIL"} ${checkpoint.id} - ${checkpoint.description}\n`);
    if (verifier) process.stdout.write(`result Oracle: ${verifier.passed ? "pass" : "fail (private details saved in run evidence)"}\n`);
    process.stdout.write(`next: ${record.next_action}\n`);
    process.stdout.write(`mainline: ${record.operator_mainline}\n`);
  }
  if (!passed) process.exitCode = 1;
}

function nonNegativeInteger(value, label, fallback = 0) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) fail(`--${label} must be a non-negative integer`);
  return number;
}

function optionText(options, inlineKey, fileKey, { required = false } = {}) {
  if (options[inlineKey] && options[fileKey]) fail(`use either --${inlineKey} or --${fileKey}, not both`);
  if (options[fileKey]) {
    const filePath = path.resolve(options[fileKey]);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) fail(`--${fileKey} file is missing: ${filePath}`);
    return fs.readFileSync(filePath, "utf8");
  }
  if (typeof options[inlineKey] === "string") return options[inlineKey];
  if (required) fail(`--${inlineKey} or --${fileKey} is required`);
  return "";
}

function commandRecord(options) {
  const runItem = resolveRun(options.run);
  if (!options.turn) fail("--turn is required");
  const input = optionText(options, "input", "input-file", { required: true });
  const response = optionText(options, "response", "response-file");
  if (!response && !options["task-ref"]) fail("--response/--response-file or --task-ref is required");
  const record = {
    schema: "mapflow.benchmark-turn/v1",
    at: now(),
    turn: options.turn,
    input,
    response,
    task_ref: options["task-ref"] ?? null,
    duration_seconds: nonNegativeInteger(options["duration-seconds"], "duration-seconds"),
    repeated_questions: nonNegativeInteger(options["repeated-questions"], "repeated-questions"),
    first_value: options["first-value"] === true,
    operator_deviation: options["operator-deviation"] === true,
    note: options.note ?? "",
  };
  appendJsonl(path.join(runItem.directory, "turns.jsonl"), record);
  process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
}

function commandMarkFirstValue(options) {
  const runItem = resolveRun(options.run);
  if (!options.turn) fail("--turn is required");
  const turns = [...new Map(readJsonl(path.join(runItem.directory, "turns.jsonl")).map((entry) => [entry.turn, entry])).values()];
  if (!turns.some((entry) => entry.turn === options.turn)) fail(`turn is not recorded: ${options.turn}`);
  const annotations = readJsonl(path.join(runItem.directory, "turn-annotations.jsonl"));
  if (turns.some((entry) => entry.first_value === true) || annotations.some((entry) => entry.first_value === true)) {
    fail("first value is already marked for this run");
  }
  const record = {
    schema: "mapflow.benchmark-turn-annotation/v1",
    at: now(),
    turn: options.turn,
    first_value: true,
    note: options.note ?? "",
  };
  appendJsonl(path.join(runItem.directory, "turn-annotations.jsonl"), record);
  process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
}

function codexThreadId(output, fallback = null) {
  for (const line of String(output ?? "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      const threadId = event.thread_id ?? event.session_id ?? event.thread?.id ?? event.session?.id;
      if (typeof threadId === "string" && threadId.trim()) return threadId;
    } catch {}
  }
  return fallback;
}

function responseFromCodexOutput(output) {
  let response = "";
  for (const line of String(output ?? "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      const item = event.item ?? event.data?.item;
      if (item?.type === "agent_message" && typeof item.text === "string") response = item.text;
      else if (event.type === "message" && event.role === "assistant" && typeof event.content === "string") response = event.content;
    } catch {}
  }
  return response;
}

async function commandAgentTurn(options) {
  const runItem = resolveRun(options.run);
  if (runItem.manifest.run_mode === "segment" && options.segmentInternal !== true) {
    fail("segment runs accept only the frozen operator input; use segment-turn");
  }
  if (!options.turn || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(options.turn)) fail("--turn must be a filesystem-safe semantic id");
  const input = optionText(options, "input", "input-file", { required: true });
  const sandbox = options.sandbox ?? "workspace-write";
  if (!new Set(["read-only", "workspace-write", "danger-full-access"]).has(sandbox)) fail("--sandbox must be read-only, workspace-write, or danger-full-access");

  const target = fs.realpathSync.native(runItem.manifest.target_root);
  if (target !== runItem.manifest.target_root) fail(`run target identity drifted: ${runItem.manifest.target_root} -> ${target}`);
  const artifactDirectory = path.join(runItem.directory, "agent");
  fs.mkdirSync(artifactDirectory, { recursive: true });
  const lastMessagePath = path.join(artifactDirectory, `${options.turn}-last-message.txt`);
  const jsonlPath = path.join(artifactDirectory, `${options.turn}-events.jsonl`);
  const stderrPath = path.join(artifactDirectory, `${options.turn}-stderr.txt`);
  const common = ["--disable", "memories", "--disable", "multi_agent", "--json"];
  const session = typeof options.session === "string" && options.session.trim() ? options.session.trim() : null;
  const codexArgs = session
    ? ["exec", "resume", session, "-c", `sandbox_mode=${JSON.stringify(sandbox)}`, ...common, "--output-last-message", lastMessagePath, "-"]
    : ["exec", ...common, "--sandbox", sandbox, "--cd", target, "--output-last-message", lastMessagePath, "-"];
  const executable = process.env.MAPFLOW_CODEX_BIN ?? "codex";
  const prefix = process.env.MAPFLOW_CODEX_PREFIX ? [process.env.MAPFLOW_CODEX_PREFIX] : [];
  const childEnv = { ...process.env, MAPFLOW_HOME: runItem.manifest.environment.mapflow_home };
  delete childEnv.MAPFLOW_BENCHMARK_HOME;
  delete childEnv.MAPFLOW_CODEX_BIN;
  delete childEnv.MAPFLOW_CODEX_PREFIX;
  delete childEnv.MAPFLOW_AGENT_HEARTBEAT_MS;

  const started = Date.now();
  const result = await runWithHeartbeat(executable, [...prefix, ...codexArgs], {
    cwd: target,
    env: childEnv,
    input,
    heartbeatLabel: `agent-turn ${options.turn}`,
    heartbeatMs: positiveInteger(process.env.MAPFLOW_AGENT_HEARTBEAT_MS, 30_000),
  });
  const durationSeconds = Math.max(0, Math.ceil((Date.now() - started) / 1000));
  fs.writeFileSync(jsonlPath, result.stdout ?? "", "utf8");
  fs.writeFileSync(stderrPath, result.stderr || result.error?.message || "", "utf8");
  const response = fs.existsSync(lastMessagePath)
    ? fs.readFileSync(lastMessagePath, "utf8")
    : responseFromCodexOutput(result.stdout);
  const sessionId = codexThreadId(result.stdout, session);
  const execution = {
    schema: "mapflow.benchmark-agent-turn/v1",
    at: now(),
    turn: options.turn,
    mode: session ? "resume" : "start",
    session_id: sessionId,
    cwd: target,
    mapflow_home: runItem.manifest.environment.mapflow_home,
    sandbox,
    benchmark_home_forwarded: false,
    exit_status: result.status,
    heartbeat_count: result.heartbeat_count,
    progress: result.progress,
    duration_seconds: durationSeconds,
    input,
    response,
    artifacts: { events: jsonlPath, stderr: stderrPath, last_message: lastMessagePath },
  };
  appendJsonl(path.join(runItem.directory, "agent-turns.jsonl"), execution);
  appendJsonl(path.join(runItem.directory, "turns.jsonl"), {
    schema: "mapflow.benchmark-turn/v1",
    at: execution.at,
    turn: options.turn,
    input,
    response,
    task_ref: sessionId,
    duration_seconds: durationSeconds,
    repeated_questions: 0,
    first_value: options["first-value"] === true,
    operator_deviation: false,
    note: options.note ?? "",
  });
  const summary = {
    run_id: runItem.manifest.run_id,
    turn: options.turn,
    mode: execution.mode,
    session_id: sessionId,
    cwd: target,
    exit_status: result.status,
    heartbeat_count: result.heartbeat_count,
    progress: result.progress,
    duration_seconds: durationSeconds,
    response,
    artifacts: execution.artifacts,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (result.status !== 0) process.exitCode = result.status ?? 1;
}

async function commandSegmentTurn(options) {
  const runItem = resolveRun(options.run);
  if (runItem.manifest.run_mode !== "segment" || !runItem.manifest.segment?.id) fail("segment-turn requires a segment run");
  const attemptPath = path.join(runItem.directory, "segment-attempt.json");
  if (fs.existsSync(attemptPath) || readJsonl(path.join(runItem.directory, "turns.jsonl")).length > 0) {
    fail("segment input has already been started for this run; preserve its evidence and use segment-prepare with a new target");
  }
  const segment = segmentFor(runItem.case, runItem.manifest.segment.id);
  writeJson(attemptPath, {
    schema: "mapflow.benchmark-segment-attempt/v1",
    started_at: now(),
    segment: segment.id,
    recovery: "Preserve this run and create a new segment-prepare run from the frozen checkpoint.",
  });
  await commandAgentTurn({
    ...options,
    session: undefined,
    turn: segment.id,
    input: segment.operator_input,
    "input-file": undefined,
    segmentInternal: true,
  });
}

async function commandDeterministicTest(options) {
  const level = options.level ?? "runtime";
  if (!new Set(["oracle", "runtime"]).has(level)) fail("deterministic-test --level must be oracle or runtime");
  const testFiles = level === "oracle"
    ? [path.join("tests", "test_benchmark.mjs")]
    : fs.readdirSync(path.join(ROOT, "tests"))
      .filter((entry) => entry.endsWith(".mjs"))
      .sort()
      .map((entry) => path.join("tests", entry));
  const result = await runWithHeartbeat(process.execPath, ["--test", ...testFiles], {
    cwd: ROOT,
    heartbeatLabel: `${level} deterministic tests`,
    heartbeatMs: positiveInteger(process.env.MAPFLOW_TEST_HEARTBEAT_MS, 20_000),
    includeProgress: false,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) process.stderr.write(`${result.error.message}\n`);
  let doctorPassed = false;
  let doctorDetail = null;
  if (result.status === 0) {
    const doctor = run(process.execPath, [path.join(ROOT, "tools", "benchmark.mjs"), "doctor", "--json"]);
    try {
      doctorDetail = JSON.parse(doctor.stdout);
      doctorPassed = doctor.status === 0 && doctorDetail.passed === true;
    } catch {
      doctorDetail = { stderr: doctor.stderr, stdout: doctor.stdout };
    }
  }
  const testCount = Number([...String(result.stdout ?? "").matchAll(/(?:^|\n)[^\n]*tests\s+(\d+)/g)].at(-1)?.[1] ?? 0);
  const passed = result.status === 0 && doctorPassed;
  const doctorStatus = result.status === 0 ? (doctorPassed ? "PASS" : "FAIL") : "NOT RUN";
  process.stdout.write(`DETERMINISTIC RESULT ${passed ? "PASS" : "FAIL"}\n`);
  process.stdout.write(`executed: ${level === "oracle" ? "Oracle tests" : "Oracle and Runtime tests"}; tests: ${testCount || "unknown"}; case-package doctor: ${doctorStatus}\n`);
  process.stdout.write(`NOT RUN ${level === "oracle" ? "Runtime tests, " : ""}Agent segments, complete journeys, release matrix\n`);
  if (!doctorPassed && doctorDetail) process.stdout.write(`${JSON.stringify(doctorDetail, null, 2)}\n`);
  if (!passed) process.exitCode = result.status || 1;
}

function numberScore(options, field) {
  const value = Number(options[field]);
  if (!Number.isInteger(value) || value < 0 || value > 3) fail(`--${field} must be an integer from 0 to 3`);
  return value;
}

function commandScore(options) {
  const runItem = resolveRun(options.run);
  if (!options.turn) fail("--turn is required");
  if (!VERDICTS.has(options.verdict)) fail("--verdict must be continue, hesitate, leave, or blocked");
  const scores = Object.fromEntries(SCORE_FIELDS.map((field) => [field, numberScore(options, field)]));
  const record = {
    schema: "mapflow.benchmark-score/v1",
    at: now(),
    turn: options.turn,
    verdict: options.verdict,
    scores,
    total: Object.values(scores).reduce((total, value) => total + value, 0),
    note: options.note ?? "",
  };
  appendJsonl(path.join(runItem.directory, "scores.jsonl"), record);
  process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
}

function commandFinding(options) {
  const runItem = resolveRun(options.run);
  if (!SEVERITIES.has(options.severity)) fail("--severity must be P0, P1, P2, or P3");
  if (!options.checkpoint || !options.observed) fail("--checkpoint and --observed are required");
  const record = {
    schema: "mapflow.benchmark-finding/v1",
    at: now(),
    checkpoint: options.checkpoint,
    severity: options.severity,
    observed: options.observed,
    inference: options.inference ?? "",
  };
  appendJsonl(path.join(runItem.directory, "findings.jsonl"), record);
  process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function commandReplay(options) {
  const runItem = resolveRun(options.run);
  const item = options["current-case"] === true ? loadCase(runItem.manifest.case_id) : runItem.case;
  if (options["current-case"] === true && directoryDigest(casePath(item, item.manifest.fixture, "fixture")) !== runItem.manifest.fixture_digest) {
    fail("cannot replay against the current case because its fixture changed");
  }
  const checks = runRecords(runItem, "checks");
  if (!checks.length) fail("run has no recorded checkpoint observations to replay");
  const turns = runRecords(runItem, "turns");
  const replayed = [];
  for (const recorded of checks) {
    const checkpoint = item.oracle.checkpoints.find((entry) => entry.id === recorded.checkpoint);
    if (!checkpoint) {
      replayed.push({ checkpoint: recorded.checkpoint, recorded_passed: recorded.passed, error: "checkpoint is absent from replay Oracle", consistent: false });
      continue;
    }
    const visibleTurns = turns.filter((entry) => !recorded.at || !entry.at || entry.at <= recorded.at);
    const assertions = checkpoint.assertions.map((assertion) => assertionResult(assertion, recorded.observation, replayed));
    const hardGates = hardGateResults(recorded.observation, visibleTurns);
    const verifierPassed = checkpoint.verifier ? recorded.verifier?.passed === true : true;
    const recomputedPassed = assertions.every((entry) => entry.passed) && hardGates.every((entry) => entry.passed) && verifierPassed;
    replayed.push({
      checkpoint: recorded.checkpoint,
      observation: recorded.observation,
      recorded_passed: recorded.passed,
      recomputed_passed: recomputedPassed,
      consistent: recomputedPassed === recorded.passed,
      assertions,
      hard_gates: hardGates,
      verifier: checkpoint.verifier ? "recorded-result-only" : null,
    });
  }
  const passed = replayed.every((entry) => entry.consistent);
  const output = {
    schema: "mapflow.benchmark-replay/v1",
    run_id: runItem.manifest.run_id,
    oracle: options["current-case"] === true ? "current-case" : "frozen-run-case",
    passed,
    observations: replayed.length,
    mismatches: replayed.filter((entry) => !entry.consistent).map((entry) => entry.checkpoint),
    results: options.json === true ? replayed : replayed.map((entry) => ({
      checkpoint: entry.checkpoint,
      recorded_passed: entry.recorded_passed,
      recomputed_passed: entry.recomputed_passed,
      consistent: entry.consistent,
      error: entry.error ?? null,
    })),
    boundary: "Replay re-evaluates recorded observations and hard gates. It does not rerun the Agent, Runtime actions, hidden verifier, or business acceptance.",
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (!passed) process.exitCode = 1;
}

function median(values) {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function commandReport(options) {
  const runItem = resolveRun(options.run);
  if (runItem.manifest.run_mode === "segment") fail("segment runs cannot produce a full-journey report; use segment-report");
  const checks = readJsonl(path.join(runItem.directory, "checks.jsonl"));
  const scoreHistory = readJsonl(path.join(runItem.directory, "scores.jsonl"));
  const findings = readJsonl(path.join(runItem.directory, "findings.jsonl"));
  const turnHistory = readJsonl(path.join(runItem.directory, "turns.jsonl"));
  const turnAnnotations = readJsonl(path.join(runItem.directory, "turn-annotations.jsonl"));
  const scores = [...new Map(scoreHistory.map((entry) => [entry.turn, entry])).values()];
  const turns = [...new Map(turnHistory.map((entry) => [entry.turn, entry])).values()];
  const latestChecks = new Map(checks.map((entry) => [entry.checkpoint, entry]));
  const required = runItem.case.manifest.required_checkpoints ?? [];
  const missing = required.filter((id) => !latestChecks.has(id));
  const failed = required.filter((id) => latestChecks.has(id) && !latestChecks.get(id).passed);
  const severe = findings.filter((entry) => ["P0", "P1"].includes(entry.severity));
  const medianScore = median(scores.map((entry) => entry.total));
  const continueCount = scores.filter((entry) => entry.verdict === "continue").length;
  const operatorDeviations = turns.filter((entry) => entry.operator_deviation).length;
  const durationSeconds = turns.reduce((total, entry) => total + (entry.duration_seconds ?? 0), 0);
  const budget = runItem.case.manifest.budget ?? {};
  const budgetExceeded = [];
  if (Number.isFinite(budget.max_turns) && turns.length > budget.max_turns) budgetExceeded.push("turns");
  if (Number.isFinite(budget.max_minutes) && durationSeconds > budget.max_minutes * 60) budgetExceeded.push("minutes");
  let gate = "incomplete";
  if (operatorDeviations) gate = "invalid-operator-deviation";
  else if (budgetExceeded.length) gate = "budget-exhausted";
  else if (!missing.length && !failed.length && !severe.length && scores.length && medianScore >= 12 && continueCount > scores.length / 2) gate = "ready-for-small-human-test";
  else if (failed.length || severe.length) gate = "repair-and-retest";
  else if (!missing.length && scores.length && medianScore < 12) gate = "technically-works-but-unconvincing";
  const failedRecords = failed.map((id) => latestChecks.get(id));
  const processFailed = failedRecords.some((entry) => (
    entry.assertions?.some((assertion) => !assertion.passed)
    || entry.hard_gates?.some((hardGate) => !hardGate.passed)
  ));
  const resultOracleFailed = failedRecords.some((entry) => entry.verifier && !entry.verifier.passed);
  let outcome = "in-progress";
  if (gate === "ready-for-small-human-test") outcome = "completed";
  else if (operatorDeviations) outcome = "operator-deviation";
  else if (budgetExceeded.length) outcome = "budget-exhausted";
  else if (processFailed || severe.length || gate === "technically-works-but-unconvincing") outcome = "mapflow-failed";
  else if (resultOracleFailed) outcome = "task-failed";
  let outcomeEvidence = null;
  if (options.outcome !== undefined) {
    if (options.outcome !== "infrastructure-failed") fail("--outcome only accepts infrastructure-failed; all other outcomes are derived from run evidence");
    outcomeEvidence = String(options["outcome-evidence"] ?? "").trim();
    if (!outcomeEvidence) fail("--outcome-evidence is required with --outcome infrastructure-failed");
    if (operatorDeviations || budgetExceeded.length || severe.length || outcome === "completed") {
      fail(`cannot override evidence-derived outcome ${outcome} with infrastructure-failed`);
    }
    gate = "incomplete";
    outcome = "infrastructure-failed";
  }
  const firstValueTurns = new Set(turnAnnotations.filter((entry) => entry.first_value === true).map((entry) => entry.turn));
  const firstValueIndex = turns.findIndex((entry) => entry.first_value === true || firstValueTurns.has(entry.turn));
  const report = {
    schema: "mapflow.benchmark-report/v1",
    generated_at: now(),
    run_id: runItem.manifest.run_id,
    case_id: runItem.manifest.case_id,
    case_version: runItem.manifest.case_version,
    gate,
    outcome,
    outcome_evidence: outcomeEvidence,
    required_checkpoints: required,
    missing_checkpoints: missing,
    failed_checkpoints: failed,
    severe_findings: severe,
    experience: { observations: scores.length, median_total: medianScore, maximum: 15, continue: continueCount },
    trajectory: {
      turns: turns.length,
      duration_seconds: durationSeconds,
      repeated_questions: turns.reduce((total, entry) => total + (entry.repeated_questions ?? 0), 0),
      operator_deviations: operatorDeviations,
    },
    first_value: {
      expected: runItem.case.manifest.expected_first_value,
      observed: firstValueIndex >= 0,
      turn: firstValueIndex >= 0 ? turns[firstValueIndex].turn : null,
      seconds: firstValueIndex >= 0
        ? turns.slice(0, firstValueIndex + 1).reduce((total, entry) => total + (entry.duration_seconds ?? 0), 0)
        : null,
    },
    budget: {
      ...budget,
      exceeded: budgetExceeded,
    },
    evidence_directory: path.join(runItem.directory, "evidence"),
    report_path: path.join(runItem.directory, "report.json"),
    reproducibility: {
      benchmark_commit: runItem.manifest.benchmark_commit,
      benchmark_dirty: runItem.manifest.benchmark_dirty,
      fixture_digest: runItem.manifest.fixture_digest,
      node: runItem.manifest.environment?.node ?? null,
      warning: runItem.manifest.benchmark_dirty
        ? "development run from a dirty Mapflow worktree; do not treat it as a fixed release baseline"
        : null,
    },
  };
  writeJson(path.join(runItem.directory, "report.json"), report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (gate !== "ready-for-small-human-test" && options["no-fail"] !== true) process.exitCode = 1;
}

function commandSegmentReport(options) {
  const runItem = resolveRun(options.run);
  if (runItem.manifest.run_mode !== "segment" || !runItem.manifest.segment) fail("segment-report requires a segment run");
  const checks = readJsonl(path.join(runItem.directory, "checks.jsonl"));
  const findings = readJsonl(path.join(runItem.directory, "findings.jsonl"));
  const turns = readJsonl(path.join(runItem.directory, "turns.jsonl"));
  const agentTurns = readJsonl(path.join(runItem.directory, "agent-turns.jsonl"));
  const segmentDefinition = segmentFor(runItem.case, runItem.manifest.segment.id);
  const workspace = resolveWorkspace({
    root: runItem.manifest.target_root,
    mapflowHome: runItem.manifest.environment?.mapflow_home ?? null,
    create: false,
  });
  const sourceRevision = runItem.manifest.segment.source_event_revision;
  const eventTypes = readJsonl(workspace.eventsPath)
    .filter((entry) => Number.isInteger(sourceRevision) && entry.seq > sourceRevision)
    .map((entry) => entry.type);
  const expectedEventTypes = segmentDefinition.expected_event_types ?? [];
  const eventSequencePassed = Number.isInteger(sourceRevision)
    && JSON.stringify(eventTypes) === JSON.stringify(expectedEventTypes);
  const target = runItem.manifest.segment.to_checkpoint;
  const latest = [...checks].reverse().find((entry) => entry.checkpoint === target) ?? null;
  const severe = findings.filter((entry) => ["P0", "P1"].includes(entry.severity));
  const durationSeconds = turns.reduce((total, entry) => total + (entry.duration_seconds ?? 0), 0);
  const budget = runItem.manifest.segment.budget ?? {};
  const exceeded = [];
  if (Number.isFinite(budget.max_turns) && turns.length > budget.max_turns) exceeded.push("turns");
  if (Number.isFinite(budget.max_minutes) && durationSeconds > budget.max_minutes * 60) exceeded.push("minutes");
  const agentTurnPassed = agentTurns.length === 1 && agentTurns[0].mode === "start" && agentTurns[0].exit_status === 0;
  let gate = "segment-incomplete";
  if (exceeded.length) gate = "segment-budget-exhausted";
  else if (latest && (!latest.passed || severe.length || !eventSequencePassed)) gate = "segment-repair-and-retest";
  else if (latest?.passed && turns.length > 0 && agentTurnPassed && eventSequencePassed) gate = "segment-passed";
  let outcome = gate === "segment-passed" ? "completed" : (gate === "segment-budget-exhausted" ? "budget-exhausted" : "in-progress");
  let outcomeEvidence = null;
  if (options.outcome !== undefined) {
    if (options.outcome !== "infrastructure-failed") fail("--outcome only accepts infrastructure-failed");
    outcomeEvidence = String(options["outcome-evidence"] ?? "").trim();
    if (!outcomeEvidence) fail("--outcome-evidence is required with --outcome infrastructure-failed");
    if (latest || eventTypes.length || gate === "segment-passed" || exceeded.length || severe.length) {
      fail(`cannot override evidence-derived segment outcome ${outcome}`);
    }
    gate = "segment-infrastructure-failed";
    outcome = "infrastructure-failed";
  }
  const report = {
    schema: "mapflow.benchmark-segment-report/v1",
    generated_at: now(),
    run_id: runItem.manifest.run_id,
    case_id: runItem.manifest.case_id,
    case_version: runItem.manifest.case_version,
    segment: runItem.manifest.segment.id,
    from_checkpoint: runItem.manifest.segment.from_checkpoint,
    to_checkpoint: target,
    covers: runItem.manifest.segment.covers,
    gate,
    outcome,
    outcome_evidence: outcomeEvidence,
    target_checkpoint_passed: latest?.passed ?? false,
    agent_turn_observed: agentTurnPassed,
    event_sequence: {
      source_revision: sourceRevision,
      expected: expectedEventTypes,
      actual: eventTypes,
      passed: eventSequencePassed,
    },
    severe_findings: severe,
    trajectory: { turns: turns.length, duration_seconds: durationSeconds },
    budget: { ...budget, exceeded },
    report_path: path.join(runItem.directory, "segment-report.json"),
    boundary: "This result covers one Agent stage from a frozen checkpoint. It is not a complete journey, release-candidate, real-user, or production result.",
  };
  writeJson(report.report_path, report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (gate !== "segment-passed" && options["no-fail"] !== true) process.exitCode = 1;
}

function commandSuiteReport(options) {
  const runValues = String(options.runs ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (!runValues.length) fail("--runs requires one or more comma-separated run ids or directories");
  const reports = runValues.map((value) => {
    const runItem = resolveRun(value);
    if (runItem.manifest.run_mode === "segment") fail(`suite-report rejects segment runs: ${value}`);
    const reportPath = path.join(runItem.directory, "report.json");
    if (!fs.existsSync(reportPath)) fail(`case report is missing; run report first: ${value}`);
    return { run: runItem.manifest, report: readJson(reportPath, `case report ${value}`) };
  });
  const duplicateCases = reports.map((item) => item.run.case_id).filter((caseId, index, values) => values.indexOf(caseId) !== index);
  if (duplicateCases.length) fail(`suite report accepts one run per case: ${[...new Set(duplicateCases)].join(", ")}`);
  const allCases = listCaseIds().map((caseId) => loadCase(caseId).manifest);
  const included = new Set(reports.map((item) => item.run.case_id));
  const missingCore = allCases.filter((item) => item.tier === "core" && !included.has(item.id)).map((item) => item.id);
  const missingExtended = allCases.filter((item) => item.tier === "extended" && !included.has(item.id)).map((item) => item.id);
  const failing = reports.filter((item) => item.report.gate !== "ready-for-small-human-test").map((item) => ({
    case_id: item.run.case_id,
    gate: item.report.gate,
    outcome: item.report.outcome ?? "unknown",
  }));
  const dirtyRuns = reports.filter((item) => item.run.benchmark_dirty).map((item) => item.run.case_id);
  let gate = "incomplete";
  if (failing.some((item) => item.gate === "repair-and-retest")) gate = "repair-and-retest";
  else if (failing.some((item) => item.gate === "invalid-operator-deviation")) gate = "invalid-operator-deviation";
  else if (missingCore.length) gate = "incomplete-core";
  else if (failing.length) gate = "incomplete";
  else if (dirtyRuns.length) gate = "development-only-dirty-baseline";
  else if (missingExtended.length) gate = "core-ready-for-small-human-test";
  else gate = "release-candidate-ready-for-small-human-test";
  const suite = {
    schema: "mapflow.benchmark-suite-report/v1",
    suite_version: SUITE_VERSION,
    generated_at: now(),
    gate,
    cases: reports.map((item) => ({
      case_id: item.run.case_id,
      case_version: item.run.case_version,
      run_id: item.run.run_id,
      gate: item.report.gate,
      outcome: item.report.outcome ?? "unknown",
    })),
    missing_core: missingCore,
    missing_extended: missingExtended,
    failing,
    dirty_runs: dirtyRuns,
    boundary: "This aggregate is a benchmark gate, not real-user, production, retention, accessibility, or market evidence.",
  };
  if (options.output) {
    const output = path.resolve(options.output);
    suite.output = output;
    writeJson(output, suite);
  }
  process.stdout.write(`${JSON.stringify(suite, null, 2)}\n`);
  if (!["core-ready-for-small-human-test", "release-candidate-ready-for-small-human-test"].includes(gate) && options["no-fail"] !== true) {
    process.exitCode = 1;
  }
}

function commandSmokeReport(options) {
  const runItem = resolveRun(options.run);
  if (runItem.manifest.run_mode === "segment") fail("segment runs cannot produce an opening smoke report; use segment-report");
  const required = runItem.case.manifest.smoke_checkpoints ?? [];
  if (!required.length) fail(`case has no quick smoke path: ${runItem.case.id}`);
  const checks = readJsonl(path.join(runItem.directory, "checks.jsonl"));
  const findings = readJsonl(path.join(runItem.directory, "findings.jsonl"));
  const latest = new Map(checks.map((entry) => [entry.checkpoint, entry]));
  const missing = required.filter((id) => !latest.has(id));
  const failed = required.filter((id) => latest.has(id) && !latest.get(id).passed);
  const severe = findings.filter((entry) => required.includes(entry.checkpoint) && ["P0", "P1"].includes(entry.severity));
  let gate = "smoke-incomplete";
  if (failed.length || severe.length) gate = "smoke-repair-and-retest";
  else if (!missing.length) gate = "smoke-complete-needs-full-journey";
  const report = {
    schema: "mapflow.benchmark-smoke-report/v1",
    generated_at: now(),
    run_id: runItem.manifest.run_id,
    case_id: runItem.manifest.case_id,
    gate,
    required_checkpoints: required,
    missing_checkpoints: missing,
    failed_checkpoints: failed,
    severe_findings: severe,
    report_path: path.join(runItem.directory, "smoke-report.json"),
    next_action: failed.length || severe.length
      ? "停止主线，保存失败并记录 finding；修复后从失败检查点重新开始。"
      : (missing.length
        ? `继续主线并依次检查：${missing.join(" → ")}`
        : "烟测完成；如需产品体验结论，继续完整旅程并运行 report。"),
    recovery_commands: missing.map((checkpoint) => `node tools/benchmark.mjs check --run ${runItem.manifest.run_id} --checkpoint ${checkpoint}`),
    boundary: "快速烟测只覆盖首次价值与入口建模，不能证明单案例、核心矩阵、发布候选或产品体验已经通过。",
  };
  writeJson(report.report_path, report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (gate !== "smoke-complete-needs-full-journey" && options["no-fail"] !== true) process.exitCode = 1;
}

function matchesImpactPattern(candidate, pattern) {
  const value = candidate.replaceAll("\\", "/");
  const normalized = pattern.replaceAll("\\", "/");
  if (normalized.endsWith("/**")) return value === normalized.slice(0, -3) || value.startsWith(normalized.slice(0, -2));
  return value === normalized;
}

function commandRegressionPlan(options) {
  const impact = readJson(path.join(ROOT, "benchmarks", "impact-map.json"), "benchmark impact map");
  if (impact.schema !== IMPACT_SCHEMA) fail(`unsupported impact map: ${impact.schema}`);
  let changedPaths;
  if (typeof options.paths === "string") changedPaths = options.paths.split(",").map((entry) => entry.trim().replaceAll("\\", "/")).filter(Boolean);
  else {
    const base = options.base ?? "HEAD";
    const tracked = git(["diff", "--name-only", base], ROOT);
    if (tracked.status !== 0) fail(`cannot inspect changed paths from ${base}: ${tracked.stderr}`);
    const untracked = git(["ls-files", "--others", "--exclude-standard"], ROOT);
    if (untracked.status !== 0) fail(`cannot inspect untracked paths: ${untracked.stderr}`);
    changedPaths = [...new Set(`${tracked.stdout}\n${untracked.stdout}`.split(/\r?\n/).map((entry) => entry.trim().replaceAll("\\", "/")).filter(Boolean))].sort();
  }
  const layerOrder = ["oracle", "runtime", "agent", "release"];
  const selectedLayers = new Set(impact.default_layers ?? ["oracle"]);
  const selectedSegments = new Set();
  const matchedRules = [];
  for (const rule of impact.rules ?? []) {
    const matchedPaths = changedPaths.filter((candidate) => (rule.paths ?? []).some((pattern) => matchesImpactPattern(candidate, pattern)));
    if (!matchedPaths.length) continue;
    matchedRules.push({
      id: rule.id,
      paths: matchedPaths,
      selects: { layers: rule.layers ?? [], segments: rule.segments ?? [] },
    });
    for (const layer of rule.layers ?? []) selectedLayers.add(layer);
    for (const segment of rule.segments ?? []) selectedSegments.add(segment);
  }
  if (options.level) {
    const levelIndex = layerOrder.indexOf(options.level);
    if (levelIndex < 0) fail("--level must be oracle, runtime, agent, or release");
    for (const layer of layerOrder.slice(0, levelIndex + 1)) selectedLayers.add(layer);
    if (options.level === "agent" || options.level === "release") {
      for (const caseId of listCaseIds()) {
        const item = loadCase(caseId);
        for (const segment of item.manifest.segments ?? []) selectedSegments.add(`${caseId}:${segment.id}`);
      }
    }
  }
  if (typeof options.segment === "string") {
    const [caseId, segmentId, extra] = options.segment.split(":");
    if (!caseId || !segmentId || extra) fail("--segment must use CASE:SEGMENT");
    segmentFor(loadCase(caseId), segmentId);
    selectedLayers.add("agent");
    selectedSegments.add(options.segment);
  }
  const releaseExplicitlySelected = options.level === "release";
  if (!releaseExplicitlySelected) selectedLayers.delete("release");
  const highestLayer = Math.max(...layerOrder.map((layer, index) => selectedLayers.has(layer) ? index : -1));
  for (const layer of layerOrder.slice(0, highestLayer + 1)) selectedLayers.add(layer);
  const layers = layerOrder.filter((layer) => selectedLayers.has(layer));
  const selectedSegmentDefinitions = [...selectedSegments].map((selection) => {
    const [caseId, segmentId] = selection.split(":");
    const segment = segmentFor(loadCase(caseId), segmentId);
    return { selection, covers: segment.covers ?? [] };
  });
  const agentCoverage = selectedLayers.has("agent") ? {
    kind: "targeted-stage-coverage",
    segments: selectedSegmentDefinitions,
    covers: [...new Set(selectedSegmentDefinitions.flatMap((entry) => entry.covers))],
    complete_journey_covered: false,
    boundary: "Selected segments cover only their declared stages. Behavior outside those stages requires another segment or an explicitly selected complete journey.",
  } : null;
  const commands = [];
  if (selectedLayers.has("runtime")) commands.push("npm run test:regression");
  else if (selectedLayers.has("oracle")) commands.push("npm run test:oracle");
  for (const selection of selectedSegments) {
    const [caseId, segmentId] = selection.split(":");
    commands.push(`node tools/benchmark.mjs segment-prepare --case ${caseId} --segment ${segmentId} --target <absolute-empty-target>`);
    commands.push("node tools/benchmark.mjs segment-turn --run <run-id>");
    commands.push(`node tools/benchmark.mjs check --run <run-id> --checkpoint ${segmentFor(loadCase(caseId), segmentId).to_checkpoint}`);
    commands.push("node tools/benchmark.mjs segment-report --run <run-id>");
  }
  if (selectedLayers.has("release")) {
    const releaseCases = listCaseIds().map((caseId) => loadCase(caseId));
    const first = releaseCases.find((entry) => entry.id === "library-system-greenfield");
    const remaining = releaseCases.filter((entry) => entry.id !== first.id);
    commands.push(`node tools/benchmark.mjs prepare --case ${first.id} --target <absolute-empty-target-for-${first.id}>`);
    commands.push(`Follow the returned operator_mainline through all required checkpoints, score turns, then run: node tools/benchmark.mjs report --run <run-id-for-${first.id}>`);
    commands.push("Only after that complete core journey passes, run the remaining release cases:");
    for (const item of remaining) {
      commands.push(`node tools/benchmark.mjs prepare --case ${item.id} --target <absolute-empty-target-for-${item.id}>`);
      commands.push(`Follow the returned operator_mainline, score turns, then run: node tools/benchmark.mjs report --run <run-id-for-${item.id}>`);
    }
    commands.push(`node tools/benchmark.mjs suite-report --runs ${releaseCases.map((entry) => `<run-id-for-${entry.id}>`).join(",")}`);
  }
  const output = {
    schema: "mapflow.benchmark-regression-plan/v1",
    status: "plan-generated-not-executed",
    changed_paths: changedPaths,
    matched_rules: matchedRules,
    layers,
    segments: [...selectedSegments],
    agent_coverage: agentCoverage,
    commands,
    estimated_minutes: {
      deterministic: selectedLayers.has("runtime") ? "1-2" : "about 1",
      agent: selectedSegments.size ? "10-20 per segment" : "not selected",
      release: selectedLayers.has("release") ? "explicit full journey and matrix" : "not selected",
    },
    boundary: selectedLayers.has("release")
      ? "Release was selected explicitly; segment results still cannot replace complete journeys."
      : "Automatic impact selection never starts or claims a release-level complete journey.",
  };
  if (options.json === true) process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  else {
    process.stdout.write("status: PLAN ONLY; tests executed: none\n");
    const formatMatchedPaths = (paths) => paths.length <= 3 ? paths.join(", ") : `${paths.slice(0, 3).join(", ")} (+${paths.length - 3} more)`;
    process.stdout.write(`matched rules: ${matchedRules.map((entry) => `${entry.id} matched [${formatMatchedPaths(entry.paths)}], selects layers [${entry.selects.layers.join(", ") || "none"}], segments [${entry.selects.segments.join(", ") || "none"}]`).join("; ") || "none"}\n`);
    process.stdout.write(`layers: ${layers.join(" -> ")}\n`);
    process.stdout.write(`segments: ${[...selectedSegments].join(", ") || "none"}\n`);
    if (agentCoverage) process.stdout.write(`agent coverage: TARGETED ONLY [${agentCoverage.covers.join(", ") || "none declared"}]; complete journey coverage: NOT PROVIDED by segments\n`);
    process.stdout.write(`estimated minutes: deterministic ${output.estimated_minutes.deterministic}; agent ${output.estimated_minutes.agent}; release ${output.estimated_minutes.release}\n`);
    for (const command of commands) process.stdout.write(`- ${command}\n`);
    if (selectedSegments.size) process.stdout.write("recovery: segment-turn interrupted/nonzero -> new empty target + new segment-prepare; check interrupted before result -> rerun same run; check FAIL -> repair then new segment run; segment-report interrupted -> rerun same run\n");
    process.stdout.write(`boundary: ${output.boundary}\n`);
  }
}

function usage() {
  process.stdout.write(`usage: node tools/benchmark.mjs <command> [options]\n\n`);
  process.stdout.write("commands:\n");
  process.stdout.write("  deterministic-test [--level oracle|runtime]\n");
  process.stdout.write("  list [--json]\n");
  process.stdout.write("  doctor [--json]\n");
  process.stdout.write("  prepare --case CASE --target ABSOLUTE_PATH [--trial N]\n");
  process.stdout.write("  checkpoint-save --run RUN --checkpoint CHECKPOINT [--output DIRECTORY]\n");
  process.stdout.write("  segment-prepare --case CASE --segment SEGMENT --target ABSOLUTE_PATH [--snapshot DIRECTORY] [--trial N]\n");
  process.stdout.write("  probe --run RUN_ID_OR_PATH --checkpoint CHECKPOINT [--json]\n");
  process.stdout.write("  check --run RUN_ID_OR_PATH --checkpoint CHECKPOINT [--json]\n");
  process.stdout.write("  replay --run RUN_ID_OR_PATH [--current-case] [--json]\n");
  process.stdout.write("  record --run RUN --turn TURN --input TEXT|--input-file FILE --response TEXT|--response-file FILE [--task-ref REF] [--duration-seconds N] [--repeated-questions N] [--first-value]\n");
  process.stdout.write("  agent-turn --run RUN --turn TURN --input TEXT|--input-file FILE [--session SESSION_ID] [--sandbox MODE] [--first-value]\n");
  process.stdout.write("  segment-turn --run RUN [--sandbox MODE]\n");
  process.stdout.write("  mark-first-value --run RUN --turn TURN [--note TEXT]\n");
  process.stdout.write("  score --run RUN --turn TURN --verdict VERDICT --clarity 0..3 --accuracy 0..3 --fluency 0..3 --control 0..3 --usefulness 0..3 [--note TEXT]\n");
  process.stdout.write("  finding --run RUN --checkpoint CHECKPOINT --severity P0..P3 --observed TEXT [--inference TEXT]\n");
  process.stdout.write("  report --run RUN [--outcome infrastructure-failed --outcome-evidence TEXT] [--no-fail]\n");
  process.stdout.write("  smoke-report --run RUN [--no-fail]\n");
  process.stdout.write("  segment-report --run RUN [--outcome infrastructure-failed --outcome-evidence TEXT] [--no-fail]\n");
  process.stdout.write("  suite-report --runs RUN1,RUN2,... [--output FILE] [--no-fail]\n");
  process.stdout.write("  regression-plan [--base REF|--paths FILE1,FILE2] [--level oracle|runtime|agent|release] [--segment CASE:SEGMENT] [--json]\n");
  process.stdout.write("\nregression layers:\n");
  process.stdout.write("  oracle   validates benchmark parsing, assertions, snapshots, and reports\n");
  process.stdout.write("  runtime  adds state, event, Sidecar, and board tests\n");
  process.stdout.write("  agent    adds isolated Codex segments from frozen checkpoints\n");
  process.stdout.write("  release  explicitly adds complete journeys; never selected automatically\n");
  process.stdout.write("\nnotes:\n");
  process.stdout.write("  doctor validates case packages only; it does not execute test journeys\n");
  process.stdout.write("  regression-plan prints a plan only; it does not execute the listed commands\n");
  process.stdout.write("  segment-turn is one-shot; after interruption or failure, preserve evidence, create a new empty target, and run segment-prepare again\n");
  process.stdout.write("  check and segment-report are repeatable on a run whose segment-turn completed\n");
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (!command || command === "help" || command === "--help" || options.help === true) {
    usage();
    return;
  }
  if (command === "deterministic-test") await commandDeterministicTest(options);
  else if (command === "list") commandList({ json: options.json === true });
  else if (command === "doctor") commandDoctor({ json: options.json === true });
  else if (command === "prepare") commandPrepare(options);
  else if (command === "checkpoint-save") commandCheckpointSave(options);
  else if (command === "segment-prepare") commandSegmentPrepare(options);
  else if (command === "probe") commandProbe(options);
  else if (command === "check") commandCheck(options);
  else if (command === "replay") commandReplay(options);
  else if (command === "record") commandRecord(options);
  else if (command === "agent-turn") await commandAgentTurn(options);
  else if (command === "segment-turn") await commandSegmentTurn(options);
  else if (command === "mark-first-value") commandMarkFirstValue(options);
  else if (command === "score") commandScore(options);
  else if (command === "finding") commandFinding(options);
  else if (command === "report") commandReport(options);
  else if (command === "smoke-report") commandSmokeReport(options);
  else if (command === "segment-report") commandSegmentReport(options);
  else if (command === "suite-report") commandSuiteReport(options);
  else if (command === "regression-plan") commandRegressionPlan(options);
  else fail(`unknown benchmark command: ${command}`);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
