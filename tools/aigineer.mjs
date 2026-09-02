#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const SCHEMA_VERSION = 1;
const DEFAULT_STATE = path.join(".aigineer", "state.json");
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
  process.stdout.write(`usage: aigineer [--state STATE] <command> [options]\n\n`);
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
    current_node: null,
    completed_nodes: [],
    last_verification: null,
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
}

function commandApprove(statePath, options) {
  const state = loadState(statePath);
  if (state.phase !== "wayfinding" || !new Set(["draft", "changed"]).has(state.destination_status)) {
    fail("approve requires wayfinding phase and a draft/changed destination");
  }
  const node = required(options, "node");
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
  const evidence = required(options, "evidence");
  if (!state.completed_nodes.includes(node)) state.completed_nodes.push(node);
  state.last_verification = evidence;
  state.current_node = null;
  record(state, "node_verified", { node, evidence });
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
  state.phase = "arrived";
  state.last_verification = confirm;
  record(state, "arrival_audited", { evidence: confirm });
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

function main(argv) {
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

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
