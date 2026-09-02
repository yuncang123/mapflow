#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCHEMA_VERSION = 1;
const DEFAULT_STATE = path.join(".mapflow", "state.json");
const PHASES = new Set(["wayfinding", "implementation", "arrived"]);
const DESTINATION_STATES = new Set(["draft", "approved", "changed"]);

class CliError extends Error {}

function fail(message) {
  throw new CliError(message);
}

function now() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function validateState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    fail("state root must be a JSON object");
  }
  const required = [
    "schema",
    "phase",
    "destination_status",
    "destination",
    "map",
    "current_node",
    "completed_nodes",
    "last_verification",
    "updated_at",
    "history",
  ];
  const missing = required.filter((field) => !(field in state));
  if (missing.length > 0) fail(`state missing fields: ${missing.join(", ")}`);
  if (state.schema !== SCHEMA_VERSION) fail(`unsupported state schema: ${state.schema}`);
  if (!PHASES.has(state.phase)) fail(`invalid phase: ${state.phase}`);
  if (!DESTINATION_STATES.has(state.destination_status)) {
    fail(`invalid destination_status: ${state.destination_status}`);
  }
  if (typeof state.destination !== "string" || state.destination.trim() === "") {
    fail("destination must be a non-empty string");
  }
  if (state.current_node !== null && typeof state.current_node !== "string") {
    fail("current_node must be a string or null");
  }
  if (!Array.isArray(state.completed_nodes) || !Array.isArray(state.history)) {
    fail("completed_nodes and history must be lists");
  }
  if ("nodes" in state && (!Array.isArray(state.nodes) || state.nodes.some((node) => typeof node !== "string" || node.trim() === ""))) {
    fail("nodes must be a list of non-empty strings");
  }
  if (Array.isArray(state.nodes) && new Set(state.nodes).size !== state.nodes.length) {
    fail("nodes must not contain duplicates");
  }
  if ("evidence" in state && !Array.isArray(state.evidence)) fail("evidence must be a list");
  if ("acceptance" in state && (!Array.isArray(state.acceptance) || state.acceptance.some((item) => typeof item !== "string" || item.trim() === ""))) {
    fail("acceptance must be a list of non-empty strings");
  }
  if (Array.isArray(state.acceptance) && new Set(state.acceptance).size !== state.acceptance.length) {
    fail("acceptance must not contain duplicates");
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

function declaredNode(state, node) {
  if (Array.isArray(state.nodes) && state.nodes.length > 0 && !state.nodes.includes(node)) {
    fail(`node is not declared by the map: ${node}`);
  }
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

function printHelp() {
  process.stdout.write(`usage: mapflow [--state STATE] <command> [options]\n\n`);
  process.stdout.write("Map-first solo development state gate (Node.js)\n\n");
  process.stdout.write("commands:\n");
  process.stdout.write("  init       create a map state\n");
  process.stdout.write("  status     show current state\n");
  process.stdout.write("  approve    approve destination and start a node\n");
  process.stdout.write("  select     select the next node\n");
  process.stdout.write("  verify     record node verification\n");
  process.stdout.write("  replan     return to wayfinding\n");
  process.stdout.write("  arrive     audit final arrival\n");
  process.stdout.write("  gate       check whether one node may be implemented\n");
}

function commandInit(statePath, options) {
  if (fs.existsSync(statePath) && !options.has("force")) {
    fail(`state already exists: ${statePath} (use --force to replace)`);
  }
  const state = {
    schema: SCHEMA_VERSION,
    phase: "wayfinding",
    destination_status: "draft",
    destination: required(options, "destination"),
    map: options.get("map") ?? path.join("docs", "wayfinding", "current", "README.md"),
    nodes: csv(options, "nodes"),
    acceptance: csv(options, "acceptance"),
    current_node: null,
    completed_nodes: [],
    last_verification: null,
    evidence: [],
    updated_at: now(),
    history: [],
  };
  record(state, "initialized");
  saveState(statePath, state);
  process.stdout.write(`initialized ${statePath}\n`);
}

function commandStatus(statePath, options) {
  const state = loadState(statePath);
  if (options.has("json")) {
    process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
    return;
  }
  process.stdout.write(`phase: ${state.phase}\n`);
  process.stdout.write(`destination: ${state.destination_status}\n`);
  process.stdout.write(`current_node: ${state.current_node ?? "-"}\n`);
  process.stdout.write(`completed: ${state.completed_nodes.join(", ") || "-"}\n`);
  process.stdout.write(`last_verification: ${state.last_verification ?? "-"}\n`);
  process.stdout.write(`declared_nodes: ${state.nodes?.join(", ") || "-"}\n`);
  process.stdout.write(`evidence_records: ${state.evidence?.length ?? 0}\n`);
}

function commandApprove(statePath, options) {
  const state = loadState(statePath);
  if (state.phase !== "wayfinding" || !new Set(["draft", "changed"]).has(state.destination_status)) {
    fail("approve requires wayfinding phase and a draft/changed destination");
  }
  if (!Array.isArray(state.nodes) || state.nodes.length === 0) {
    fail("approve requires declared nodes; use replan --nodes N1,N2 first");
  }
  const node = required(options, "node");
  declaredNode(state, node);
  state.phase = "implementation";
  state.destination_status = "approved";
  state.current_node = node;
  record(state, "destination_approved", { node });
  saveState(statePath, state);
  process.stdout.write(`approved destination; current node: ${node}\n`);
}

function commandSelect(statePath, options) {
  const state = loadState(statePath);
  if (state.phase !== "implementation" || state.destination_status !== "approved") {
    fail("select requires an approved destination in implementation phase");
  }
  if (state.current_node !== null) fail(`current node is still active: ${state.current_node}`);
  const node = required(options, "node");
  if (state.completed_nodes.includes(node)) fail(`node already completed: ${node}`);
  declaredNode(state, node);
  state.current_node = node;
  record(state, "node_selected", { node });
  saveState(statePath, state);
  process.stdout.write(`selected node: ${node}\n`);
}

function commandVerify(statePath, options) {
  const state = loadState(statePath);
  if (state.phase !== "implementation" || state.destination_status !== "approved") {
    fail("verify requires an approved destination in implementation phase");
  }
  const node = required(options, "node");
  if (state.current_node !== node) fail(`verify must name current node ${JSON.stringify(state.current_node)}`);
  declaredNode(state, node);
  const claim = required(options, "evidence");
  const command = required(options, "command");
  const observed = required(options, "observed");
  const actualModel = required(options, "model");
  const actualReasoning = required(options, "reasoning");
  const result = options.get("result") ?? "pass";
  if (!["pass", "fail", "blocked", "skipped"].includes(result)) {
    fail(`invalid verification result: ${result}`);
  }
  const simulated = csv(options, "simulated");
  const inferred = csv(options, "inferred");
  const unverified = csv(options, "unverified");
  const productUnknowns = csv(options, "product-unknown");
  const evidence = {
    node,
    claim,
    checks: [{ command, result, observed }],
    limits: {
      simulated,
      inferred,
      unverified,
      product_unknowns: productUnknowns,
    },
    actual_model: actualModel,
    actual_reasoning: actualReasoning,
    recorded_at: now(),
  };
  if (!Array.isArray(state.evidence)) state.evidence = [];
  state.evidence.push(evidence);
  state.last_verification = claim;
  if (result !== "pass" || unverified.length > 0) {
    record(state, "node_verification_incomplete", {
      node,
      result,
      unverified,
    });
    saveState(statePath, state);
    fail(result === "pass"
      ? `node verification has unverified limits: ${node}`
      : `node verification did not pass: ${node}`);
  }
  if (!state.completed_nodes.includes(node)) state.completed_nodes.push(node);
  state.current_node = null;
  record(state, "node_verified", { node, evidence: claim });
  saveState(statePath, state);
  process.stdout.write(`verified node: ${node}\n`);
}

function commandReplan(statePath, options) {
  const state = loadState(statePath);
  if (state.phase === "arrived") fail("cannot replan an arrived map; start a new map");
  const reason = required(options, "reason");
  state.phase = "wayfinding";
  state.destination_status = "changed";
  state.current_node = null;
  if (options.has("nodes")) {
    const nodes = csv(options, "nodes");
    if (nodes.length === 0) fail("--nodes must contain at least one node");
    state.nodes = nodes;
  }
  if (options.has("acceptance")) {
    const acceptance = csv(options, "acceptance");
    if (acceptance.length === 0) fail("--acceptance must contain at least one acceptance id");
    state.acceptance = acceptance;
  }
  record(state, "replan_requested", { reason });
  saveState(statePath, state);
  process.stdout.write("returned to wayfinding; destination marked changed\n");
}

function commandArrive(statePath, options) {
  const state = loadState(statePath);
  if (state.phase !== "implementation" || state.destination_status !== "approved") {
    fail("arrive requires an approved destination in implementation phase");
  }
  if (state.current_node !== null) fail(`cannot arrive while node is active: ${state.current_node}`);
  if (state.completed_nodes.length === 0) fail("cannot arrive before at least one node is verified");
  const confirm = required(options, "confirm");
  const acceptance = required(options, "acceptance");
  if (!Array.isArray(state.acceptance) || state.acceptance.length === 0) {
    fail("cannot arrive without a declared acceptance contract; use init/replan --acceptance A1,A2");
  }
  const requestedAcceptance = csv(options, "acceptance");
  const missingAcceptance = state.acceptance.filter((id) => !requestedAcceptance.includes(id));
  const unknownAcceptance = requestedAcceptance.filter((id) => !state.acceptance.includes(id));
  if (missingAcceptance.length > 0 || unknownAcceptance.length > 0) {
    fail(`acceptance ids do not match the declared contract (missing: ${missingAcceptance.join(", ") || "-"}; unknown: ${unknownAcceptance.join(", ") || "-"})`);
  }
  if (Array.isArray(state.nodes) && state.nodes.length > 0) {
    const missing = state.nodes.filter((node) => !state.completed_nodes.includes(node));
    if (missing.length > 0) fail(`cannot arrive; declared nodes are not verified: ${missing.join(", ")}`);
  }
  const evidenceRecords = Array.isArray(state.evidence) ? state.evidence : [];
  const missingEvidence = state.completed_nodes.filter((node) => !evidenceRecords.some((record) => (
    record.node === node
    && Array.isArray(record.checks)
    && record.checks.some((check) => check.result === "pass")
    && (!record.limits || !Array.isArray(record.limits.unverified) || record.limits.unverified.length === 0)
  )));
  if (missingEvidence.length > 0) {
    fail(`cannot arrive; completed nodes lack a passing verified evidence record: ${missingEvidence.join(", ")}`);
  }
  state.phase = "arrived";
  state.last_verification = confirm;
  state.arrival_audit = {
    acceptance: requestedAcceptance,
    non_goals: csv(options, "non-goals"),
    risks: csv(options, "risks"),
    confirm,
    recorded_at: now(),
  };
  record(state, "arrival_audited", { evidence: confirm, acceptance: state.arrival_audit.acceptance });
  saveState(statePath, state);
  process.stdout.write("arrival audited\n");
}

function commandGate(statePath) {
  const state = loadState(statePath);
  const allowed = state.phase === "implementation"
    && state.destination_status === "approved"
    && typeof state.current_node === "string"
    && state.current_node.trim() !== "";
  if (allowed) {
    process.stdout.write(`write gate passed for node: ${state.current_node}\n`);
    return 0;
  }
  process.stderr.write("write gate blocked: approve a destination and select one active node\n");
  return 1;
}

export function main(argv) {
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
    case "init": commandInit(statePath, options); return 0;
    case "status": commandStatus(statePath, options); return 0;
    case "approve": commandApprove(statePath, options); return 0;
    case "select": commandSelect(statePath, options); return 0;
    case "verify": commandVerify(statePath, options); return 0;
    case "replan": commandReplan(statePath, options); return 0;
    case "arrive": commandArrive(statePath, options); return 0;
    case "gate": return commandGate(statePath);
    default: fail(`unknown command: ${command}`);
  }
}

if (path.resolve(process.argv[1] ?? "") === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
