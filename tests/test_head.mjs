import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const CLI = path.join(ROOT, "tools", "mapflow.mjs");

function run(root, home, ...args) {
  return spawnSync(process.execPath, [CLI, ...args, "--mapflow-home", home], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
}

function json(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function enabledWorkspace() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-head-test-"));
  const root = path.join(parent, "workspace");
  const home = path.join(parent, "sidecars");
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  const enabled = json(run(root, home, "enable", "--root", root, "--json"));
  return { parent, root, home, enabled };
}

function snapshot(item) {
  return json(run(item.root, item.home, "snapshot", "--root", item.root, "--json"));
}

test("snapshot reads the one Workspace Head and binds shaping context to its revision", () => {
  const item = enabledWorkspace();
  try {
    const current = snapshot(item);
    assert.equal(current.schema, "mapflow.workspace-snapshot/v1");
    assert.equal(current.head.revision, item.enabled.workspace_head.revision);
    assert.equal(current.head.phase, "wayfinding");
    assert.equal(current.runtime.compatible_with_head, true);
    assert.equal(current.focus.current_question.id, "establish-starting-state");
    assert.equal(current.focus.next_action.id, "answer-wayfinding-question");
    assert.equal(JSON.parse(fs.readFileSync(item.enabled.paths.head, "utf8")).revision, current.head.revision);

    const context = json(run(
      item.root, item.home,
      "context", "--root", item.root, "--layer", "focus", "--json",
      "--expected-revision", current.head.revision,
    ));
    assert.equal(context.map.phase, "wayfinding");
    assert.equal(context.focus.question.id, "establish-starting-state");
    assert.equal(context.workspace_head.revision, current.head.revision);

    const unbound = run(item.root, item.home, "next-actions", "--root", item.root, "--json");
    assert.equal(unbound.status, 1);
    assert.match(unbound.stderr, /expected-revision is required.*snapshot --root/);
  } finally {
    fs.rmSync(item.parent, { recursive: true, force: true });
  }
});

test("two clients at one revision cannot both write and successful writes force Head readback", () => {
  const item = enabledWorkspace();
  try {
    const clientA = snapshot(item);
    const clientB = snapshot(item);
    assert.equal(clientA.head.revision, clientB.head.revision);
    const first = json(run(
      item.root, item.home,
      "wayfinding-answer", "--root", item.root,
      "--question", "establish-starting-state",
      "--answer", "空工作区已核验",
      "--evidence-ref", "observation:client-a",
      "--expected-revision", clientA.head.revision,
      "--json",
    ));
    assert.equal(first.write_receipt.previous_revision, clientA.head.revision);
    assert.notEqual(first.write_receipt.revision, clientA.head.revision);
    assert.equal(first.write_receipt.readback, "verified");

    const stale = run(
      item.root, item.home,
      "wayfinding-answer", "--root", item.root,
      "--question", "establish-starting-state",
      "--answer", "第二个客户端的旧回答",
      "--evidence-ref", "observation:client-b",
      "--expected-revision", clientB.head.revision,
    );
    assert.equal(stale.status, 1);
    assert.match(stale.stderr, /expected revision is stale/);
    assert.equal(snapshot(item).head.revision, first.write_receipt.revision);
    const lines = fs.readFileSync(item.enabled.paths.wayfinding_events, "utf8").trim().split(/\r?\n/);
    assert.equal(lines.length, 3, "the stale client must not append an event");
  } finally {
    fs.rmSync(item.parent, { recursive: true, force: true });
  }
});

test("Head validation fails closed when Wayfinding truth changes outside the journal", () => {
  const item = enabledWorkspace();
  try {
    fs.appendFileSync(item.enabled.paths.wayfinding, "\n", "utf8");
    const result = run(item.root, item.home, "snapshot", "--root", item.root, "--json");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Wayfinding draft does not match the recorded journal head/);
  } finally {
    fs.rmSync(item.parent, { recursive: true, force: true });
  }
});

test("runtime mismatches are visible, block writes, and require an expected revision to rebind", () => {
  const item = enabledWorkspace();
  try {
    const head = JSON.parse(fs.readFileSync(item.enabled.paths.head, "utf8"));
    head.runtime.build_digest = "0".repeat(64);
    fs.writeFileSync(item.enabled.paths.head, `${JSON.stringify(head, null, 2)}\n`, "utf8");
    const mismatched = snapshot(item);
    assert.equal(mismatched.runtime.compatible_with_head, false);

    const blocked = run(
      item.root, item.home,
      "wayfinding-answer", "--root", item.root,
      "--question", "establish-starting-state", "--answer", "不能写入",
      "--evidence-ref", "observation:mismatch", "--expected-revision", head.revision,
    );
    assert.equal(blocked.status, 1);
    assert.match(blocked.stderr, /does not match Workspace Head runtime/);

    const rebound = json(run(
      item.root, item.home,
      "enable", "--root", item.root, "--expected-revision", head.revision, "--json",
    ));
    assert.equal(rebound.workspace_head.runtime_rebound, true);
    assert.equal(rebound.workspace_head.runtime_compatible, true);
    assert.equal(snapshot(item).runtime.compatible_with_head, true);
  } finally {
    fs.rmSync(item.parent, { recursive: true, force: true });
  }
});

test("runtime Head validates the registered Blueprint instead of trusting state alone", () => {
  const item = enabledWorkspace();
  try {
    fs.copyFileSync(path.join(ROOT, "templates", "blueprint.yaml"), item.enabled.paths.map);
    fs.cpSync(path.join(ROOT, "templates", "briefs"), item.enabled.paths.briefs, { recursive: true });
    const initialized = json(run(
      item.root, item.home,
      "init", "--root", item.root, "--expected-revision", snapshot(item).head.revision, "--json",
    ));
    assert.equal(initialized.write_receipt.phase, "runtime");
    assert.equal(snapshot(item).head.revision, initialized.write_receipt.revision);

    const blueprint = fs.readFileSync(item.enabled.paths.map, "utf8");
    fs.writeFileSync(item.enabled.paths.map, blueprint.replace("把已有素材变成一篇可以安全公开分享的文章", "把两份已有素材变成可以安全公开分享的文章"), "utf8");
    const invalid = run(item.root, item.home, "snapshot", "--root", item.root, "--json");
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /does not match runtime state/);
  } finally {
    fs.rmSync(item.parent, { recursive: true, force: true });
  }
});
