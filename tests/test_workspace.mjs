import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  WORKSPACE_SCHEMA,
  WorkspaceError,
  defaultMapflowHome,
  discoverWorkspaceRoot,
  resolveWorkspace,
  workspaceId,
} from "../tools/mapflow-workspace.mjs";

function initGitRepository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-workspace-repo-"));
  const result = spawnSync("git", ["init", "--quiet", root], { encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  fs.mkdirSync(path.join(root, "nested", "deeper"), { recursive: true });
  fs.writeFileSync(path.join(root, "project.txt"), "project-owned\n", "utf8");
  return root;
}

test("workspace state home follows platform conventions and requires absolute overrides", () => {
  assert.equal(
    defaultMapflowHome({ platform: "win32", home: "C:\\Users\\tester", env: { LOCALAPPDATA: "C:\\Local" } }),
    path.join("C:\\Local", "Mapflow"),
  );
  assert.equal(
    defaultMapflowHome({ platform: "linux", home: "/home/tester", env: { XDG_STATE_HOME: "/state" } }),
    path.join("/state", "mapflow"),
  );
  assert.throws(() => defaultMapflowHome({ override: "relative/path" }), WorkspaceError);
});

test("workspace sidecar is stable for one Git worktree and leaves the repository untouched", () => {
  const root = initGitRepository();
  const nested = path.join(root, "nested", "deeper");
  const mapflowHome = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-state-home-"));
  const before = fs.readdirSync(root).sort();

  const first = resolveWorkspace({ root: nested, mapflowHome, create: true });
  const second = resolveWorkspace({ root, mapflowHome, create: true });

  assert.equal(first.schema, WORKSPACE_SCHEMA);
  assert.equal(first.workspace_kind, "git-worktree");
  assert.equal(first.workspace_root, fs.realpathSync.native(root));
  assert.equal(first.workspace_id, workspaceId(first.workspace_root));
  assert.equal(first.directory, second.directory);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(path.relative(root, first.directory).startsWith(".."), true);
  assert.deepEqual(fs.readdirSync(root).sort(), before);
  assert.equal(fs.existsSync(path.join(root, ".mapflow")), false);
  assert.equal(fs.existsSync(first.briefsPath), true);
  assert.equal(first.wayfindingPath, path.join(first.directory, "current", "wayfinding.yaml"));

  const manifest = JSON.parse(fs.readFileSync(first.manifestPath, "utf8"));
  assert.equal(manifest.schema, WORKSPACE_SCHEMA);
  assert.equal(manifest.workspace_root, first.workspace_root);
  assert.equal(manifest.paths.state, "current/state.json");
  assert.equal(manifest.paths.wayfinding, "current/wayfinding.yaml");
});

test("non-Git directories receive separate sidecars", () => {
  const mapflowHome = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-state-home-"));
  const leftRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-left-"));
  const rightRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-right-"));
  assert.equal(discoverWorkspaceRoot(leftRoot).kind, "directory");
  const left = resolveWorkspace({ root: leftRoot, mapflowHome, create: true });
  const right = resolveWorkspace({ root: rightRoot, mapflowHome, create: true });
  assert.notEqual(left.workspace_id, right.workspace_id);
  assert.notEqual(left.directory, right.directory);
});

test("a sidecar cannot be placed inside the workspace and a legacy project directory is read-only", () => {
  const root = initGitRepository();
  const legacy = path.join(root, ".mapflow");
  fs.mkdirSync(legacy);
  fs.writeFileSync(path.join(legacy, "state.json"), "legacy-project-state\n", "utf8");
  assert.throws(
    () => resolveWorkspace({ root, mapflowHome: path.join(root, "assistant-state"), create: true }),
    /sidecar must be outside the workspace root/,
  );

  const externalHome = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-state-home-"));
  const workspace = resolveWorkspace({ root, mapflowHome: externalHome, create: true });
  assert.equal(workspace.legacy_project_state, true);
  assert.equal(fs.readFileSync(path.join(legacy, "state.json"), "utf8"), "legacy-project-state\n");
  assert.equal(fs.existsSync(path.join(workspace.directory, ".mapflow")), false);
});

test("Git worktrees from one repository receive independent workspace identities", () => {
  const root = initGitRepository();
  const commit = spawnSync("git", [
    "-C", root,
    "-c", "user.name=Mapflow Test",
    "-c", "user.email=mapflow@example.invalid",
    "add", "project.txt",
  ], { encoding: "utf8", windowsHide: true });
  assert.equal(commit.status, 0, commit.stderr);
  const committed = spawnSync("git", [
    "-C", root,
    "-c", "user.name=Mapflow Test",
    "-c", "user.email=mapflow@example.invalid",
    "commit", "--quiet", "-m", "fixture",
  ], { encoding: "utf8", windowsHide: true });
  assert.equal(committed.status, 0, committed.stderr);
  const sibling = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-worktree-parent-"));
  const worktree = path.join(sibling, "secondary");
  const added = spawnSync("git", ["-C", root, "worktree", "add", "--quiet", "-b", "secondary", worktree], {
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(added.status, 0, added.stderr);

  const mapflowHome = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-state-home-"));
  const primary = resolveWorkspace({ root, mapflowHome, create: true });
  const secondary = resolveWorkspace({ root: worktree, mapflowHome, create: true });
  assert.equal(primary.workspace_kind, "git-worktree");
  assert.equal(secondary.workspace_kind, "git-worktree");
  assert.notEqual(primary.workspace_root, secondary.workspace_root);
  assert.notEqual(primary.workspace_id, secondary.workspace_id);
  assert.notEqual(primary.directory, secondary.directory);
});

test("workspace manifest identity drift fails closed", () => {
  const root = initGitRepository();
  const mapflowHome = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-state-home-"));
  const workspace = resolveWorkspace({ root, mapflowHome, create: true });
  const manifest = JSON.parse(fs.readFileSync(workspace.manifestPath, "utf8"));
  manifest.workspace_root = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-other-root-"));
  fs.writeFileSync(workspace.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  assert.throws(
    () => resolveWorkspace({ root, mapflowHome }),
    /workspace manifest is bound to another root/,
  );
});

test("creating the default state directory does not change its reported path", () => {
  const localAppData = process.env.LOCALAPPDATA;
  if (process.platform !== "win32" || !localAppData || !path.isAbsolute(localAppData)) return;
  const root = initGitRepository();
  const mapflowHome = path.join(localAppData, `Mapflow-path-stability-${process.pid}-${Date.now()}`);
  try {
    const first = resolveWorkspace({ root, mapflowHome, create: true });
    const second = resolveWorkspace({ root, mapflowHome, create: true });
    assert.equal(first.mapflow_home, path.normalize(mapflowHome));
    assert.equal(second.mapflow_home, first.mapflow_home);
    assert.equal(second.directory, first.directory);
  } finally {
    fs.rmSync(mapflowHome, { recursive: true, force: true });
  }
});
