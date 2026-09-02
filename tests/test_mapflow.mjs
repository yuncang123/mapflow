import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const CLI = path.join(ROOT, "tools", "mapflow.mjs");
const INSTALLER = path.join(ROOT, "tools", "install.mjs");

function runCli(state, ...args) {
  const result = spawnSync(process.execPath, [CLI, "--state", state, ...args], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return result;
}

function runInstaller(target, ...args) {
  return spawnSync(process.execPath, [INSTALLER, "--target", target, ...args], {
    cwd: ROOT,
    encoding: "utf8",
  });
}

function assertExit(result, expected = 0) {
  assert.equal(result.status, expected, result.stderr || result.stdout);
}

test("map to arrival happy path", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-"));
  const state = path.join(directory, ".mapflow", "state.json");
  assertExit(runCli(state, "init", "--destination", "ship a verified slice", "--nodes", "N1,N2", "--acceptance", "A1,A2"));
  assertExit(runCli(state, "gate"), 1);
  assertExit(runCli(state, "approve", "--node", "N1"));
  assertExit(runCli(state, "gate"));
  assertExit(runCli(state, "verify", "--node", "N1", "--evidence", "unit tests pass", "--command", "npm test -- auth", "--observed", "2 tests passed", "--model", "gpt-5.6-sol", "--reasoning", "medium"));
  assertExit(runCli(state, "select", "--node", "N2"));
  assertExit(runCli(state, "verify", "--node", "N2", "--evidence", "scenario pass", "--command", "npm run scenario", "--observed", "scenario passed", "--model", "gpt-5.6-sol", "--reasoning", "medium"));
  assertExit(runCli(state, "arrive", "--confirm", "wrong acceptance ids", "--acceptance", "A1"), 1);
  assertExit(runCli(state, "arrive", "--confirm", "acceptance and diff audit pass", "--acceptance", "A1,A2", "--non-goals", "deployment", "--risks", "none"));
  const data = JSON.parse(fs.readFileSync(state, "utf8"));
  assert.equal(data.phase, "arrived");
  assert.deepEqual(data.completed_nodes, ["N1", "N2"]);
  assert.equal(data.evidence.length, 2);
  assert.equal(data.evidence[0].checks[0].command, "npm test -- auth");
  assert.equal(data.arrival_audit.acceptance.join(","), "A1,A2");
});

test("replan blocks writes until approval", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-"));
  const state = path.join(directory, "state.json");
  assertExit(runCli(state, "init", "--destination", "test replan", "--nodes", "N1"));
  assertExit(runCli(state, "approve", "--node", "N1"));
  assertExit(runCli(state, "replan", "--reason", "new dependency discovered", "--nodes", "N2", "--acceptance", "A1"));
  assertExit(runCli(state, "gate"), 1);
  const data = JSON.parse(fs.readFileSync(state, "utf8"));
  assert.equal(data.phase, "wayfinding");
  assert.equal(data.destination_status, "changed");
  assert.deepEqual(data.nodes, ["N2"]);
});

test("invalid transition is rejected", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-"));
  const state = path.join(directory, "state.json");
  assertExit(runCli(state, "init", "--destination", "invalid transition", "--nodes", "N1"));
  assertExit(runCli(state, "select", "--node", "N1"), 1);
  assertExit(runCli(state, "approve", "--node", "N1"));
  assertExit(runCli(state, "verify", "--node", "N2", "--evidence", "wrong node", "--command", "npm test", "--observed", "wrong node"), 1);
});

test("arrival requires verified node", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-"));
  const state = path.join(directory, "state.json");
  assertExit(runCli(state, "init", "--destination", "verified arrival", "--nodes", "N1"));
  assertExit(runCli(state, "approve", "--node", "N1"));
  assertExit(runCli(state, "arrive", "--confirm", "claimed complete"), 1);
});

test("malformed state has actionable error", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-"));
  const state = path.join(directory, "state.json");
  fs.writeFileSync(state, "[]", "utf8");
  const result = runCli(state, "status");
  assertExit(result, 1);
  assert.match(result.stderr, /state root must be a JSON object/);
});

test("duplicate declared nodes are rejected", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-"));
  const state = path.join(directory, "state.json");
  assertExit(runCli(state, "init", "--destination", "duplicate nodes", "--nodes", "N1,N1"), 1);
  assert.equal(fs.existsSync(state), false);
});

test("approval requires a declared route", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-"));
  const state = path.join(directory, "state.json");
  assertExit(runCli(state, "init", "--destination", "route required"));
  assertExit(runCli(state, "approve", "--node", "N1"), 1);
  const data = JSON.parse(fs.readFileSync(state, "utf8"));
  assert.equal(data.phase, "wayfinding");
});

test("verification requires actual model metadata", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-"));
  const state = path.join(directory, "state.json");
  assertExit(runCli(state, "init", "--destination", "model evidence", "--nodes", "N1", "--acceptance", "A1"));
  assertExit(runCli(state, "approve", "--node", "N1"));
  assertExit(runCli(state, "verify", "--node", "N1", "--evidence", "tests pass", "--command", "npm test", "--observed", "1 passed"), 1);
  const data = JSON.parse(fs.readFileSync(state, "utf8"));
  assert.deepEqual(data.completed_nodes, []);
});

test("declared nodes are enforced and unverified evidence does not complete a node", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-"));
  const state = path.join(directory, "state.json");
  assertExit(runCli(state, "init", "--destination", "bounded nodes", "--nodes", "N1,N2", "--acceptance", "A1"));
  assertExit(runCli(state, "approve", "--node", "N1"));
  assertExit(runCli(state, "verify", "--node", "N1", "--evidence", "unverified check", "--command", "npm test", "--observed", "not run", "--result", "pass", "--unverified", "integration", "--model", "gpt-5.6-sol", "--reasoning", "medium"), 1);
  let data = JSON.parse(fs.readFileSync(state, "utf8"));
  assert.deepEqual(data.completed_nodes, []);
  assert.equal(data.evidence[0].checks[0].result, "pass");
  assertExit(runCli(state, "replan", "--reason", "failed node needs a new route"));
  assertExit(runCli(state, "approve", "--node", "N3"), 1);
  assertExit(runCli(state, "verify", "--node", "N2", "--evidence", "wrong node", "--command", "npm test", "--observed", "not active"), 1);
  assertExit(runCli(state, "arrive", "--confirm", "too early", "--acceptance", "A1"), 1);
  data = JSON.parse(fs.readFileSync(state, "utf8"));
  assert.equal(data.phase, "wayfinding");
});

test("installer creates an isolated core layout without touching AGENTS.md", () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-target-"));
  const agents = path.join(target, "AGENTS.md");
  fs.writeFileSync(agents, "# project rules\n", "utf8");
  assertExit(runInstaller(target, "--profile", "core"));
  assert.equal(fs.readFileSync(agents, "utf8"), "# project rules\n");
  assert.ok(fs.existsSync(path.join(target, ".mapflow", "mapflow.mjs")));
  assert.ok(fs.existsSync(path.join(target, ".mapflow", "workflow.md")));
  const installedWorkflow = fs.readFileSync(path.join(target, ".mapflow", "workflow.md"), "utf8");
  assert.match(installedWorkflow, /\.mapflow\/templates\/map\.md/);
  assert.match(installedWorkflow, /\.agents\/skills\/mapflow\/SKILL\.md/);
  assert.doesNotMatch(installedWorkflow, /`templates\//);
  assert.ok(fs.existsSync(path.join(target, ".agents", "skills", "mapflow", "SKILL.md")));
  assert.match(fs.readFileSync(path.join(target, ".agents", "skills", "blueprint-planning", "SKILL.md"), "utf8"), /\.mapflow\/templates\/map\.md/);
  assert.match(fs.readFileSync(path.join(target, ".agents", "skills", "node-slicing", "SKILL.md"), "utf8"), /\.mapflow\/templates\/work-item\.md/);
  const manifest = JSON.parse(fs.readFileSync(path.join(target, ".mapflow", "install-manifest.json"), "utf8"));
  assert.equal(manifest.package, "mapflow");
  assert.equal(manifest.version, "0.2.0");
  assert.ok(fs.existsSync(path.join(target, ".mapflow", "AGENTS.snippet.md")));
  const installedInit = spawnSync(process.execPath, [path.join(target, ".mapflow", "mapflow.mjs"), "init", "--destination", "installed runtime", "--nodes", "N1"], {
    cwd: target,
    encoding: "utf8",
  });
  assertExit(installedInit);
  assert.ok(fs.existsSync(path.join(target, ".mapflow", "state.json")));
  assertExit(runInstaller(target), 1);
  assertExit(runInstaller(target, "--force"));
});
