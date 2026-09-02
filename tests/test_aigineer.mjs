import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const CLI = path.join(ROOT, "tools", "aigineer.mjs");

function runCli(state, ...args) {
  const result = spawnSync(process.execPath, [CLI, "--state", state, ...args], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return result;
}

function assertExit(result, expected = 0) {
  assert.equal(result.status, expected, result.stderr || result.stdout);
}

test("map to arrival happy path", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "aigineer-"));
  const state = path.join(directory, ".aigineer", "state.json");
  assertExit(runCli(state, "init", "--destination", "ship a verified slice"));
  assertExit(runCli(state, "gate"), 1);
  assertExit(runCli(state, "approve", "--node", "N1"));
  assertExit(runCli(state, "gate"));
  assertExit(runCli(state, "verify", "--node", "N1", "--evidence", "unit tests pass"));
  assertExit(runCli(state, "select", "--node", "N2"));
  assertExit(runCli(state, "verify", "--node", "N2", "--evidence", "scenario pass"));
  assertExit(runCli(state, "arrive", "--confirm", "acceptance and diff audit pass"));
  const data = JSON.parse(fs.readFileSync(state, "utf8"));
  assert.equal(data.phase, "arrived");
  assert.deepEqual(data.completed_nodes, ["N1", "N2"]);
});

test("replan blocks writes until approval", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "aigineer-"));
  const state = path.join(directory, "state.json");
  assertExit(runCli(state, "init", "--destination", "test replan"));
  assertExit(runCli(state, "approve", "--node", "N1"));
  assertExit(runCli(state, "replan", "--reason", "new dependency discovered"));
  assertExit(runCli(state, "gate"), 1);
  const data = JSON.parse(fs.readFileSync(state, "utf8"));
  assert.equal(data.phase, "wayfinding");
  assert.equal(data.destination_status, "changed");
});

test("invalid transition is rejected", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "aigineer-"));
  const state = path.join(directory, "state.json");
  assertExit(runCli(state, "init", "--destination", "invalid transition"));
  assertExit(runCli(state, "select", "--node", "N1"), 1);
  assertExit(runCli(state, "approve", "--node", "N1"));
  assertExit(runCli(state, "verify", "--node", "N2", "--evidence", "wrong node"), 1);
});

test("arrival requires verified node", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "aigineer-"));
  const state = path.join(directory, "state.json");
  assertExit(runCli(state, "init", "--destination", "verified arrival"));
  assertExit(runCli(state, "approve", "--node", "N1"));
  assertExit(runCli(state, "arrive", "--confirm", "claimed complete"), 1);
});

test("malformed state has actionable error", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "aigineer-"));
  const state = path.join(directory, "state.json");
  fs.writeFileSync(state, "[]", "utf8");
  const result = runCli(state, "status");
  assertExit(result, 1);
  assert.match(result.stderr, /state root must be a JSON object/);
});
