import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const WORKSPACE_SCHEMA = "mapflow.workspace/v1";

export class WorkspaceError extends Error {}

function fail(message) {
  throw new WorkspaceError(message);
}

function canonicalDirectory(candidate) {
  const absolute = path.resolve(candidate);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isDirectory()) {
    fail(`workspace root is not a directory: ${absolute}`);
  }
  return fs.realpathSync.native(absolute);
}

function canonicalPath(candidate) {
  let cursor = path.resolve(candidate);
  const suffix = [];
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    suffix.unshift(path.basename(cursor));
    cursor = parent;
  }
  const canonicalBase = fs.existsSync(cursor) ? fs.realpathSync.native(cursor) : cursor;
  return path.join(canonicalBase, ...suffix);
}

function gitWorktreeRoot(candidate) {
  const result = spawnSync("git", ["-C", candidate, "rev-parse", "--show-toplevel"], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) return null;
  const value = result.stdout.trim();
  return value ? canonicalDirectory(value) : null;
}

export function discoverWorkspaceRoot(candidate = process.cwd()) {
  const directory = canonicalDirectory(candidate);
  const gitRoot = gitWorktreeRoot(directory);
  return {
    root: gitRoot ?? directory,
    kind: gitRoot ? "git-worktree" : "directory",
  };
}

export function defaultMapflowHome({
  env = process.env,
  platform = process.platform,
  home = os.homedir(),
  override = null,
} = {}) {
  const explicit = override ?? env.MAPFLOW_HOME;
  if (explicit) {
    if (!path.isAbsolute(explicit)) fail("MAPFLOW_HOME must be an absolute path");
    return path.normalize(explicit);
  }
  if (platform === "win32") {
    const local = env.LOCALAPPDATA;
    return path.join(local && path.isAbsolute(local) ? local : path.join(home, "AppData", "Local"), "Mapflow");
  }
  const xdgState = env.XDG_STATE_HOME;
  return path.join(xdgState && path.isAbsolute(xdgState) ? xdgState : path.join(home, ".local", "state"), "mapflow");
}

function workspaceSlug(root) {
  const normalized = path.basename(root)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "workspace";
}

function identityPath(root, platform = process.platform) {
  const normalized = path.normalize(root);
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

function pathContains(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function workspaceId(root, platform = process.platform) {
  const digest = crypto.createHash("sha256").update(identityPath(root, platform)).digest("hex").slice(0, 12);
  return `${workspaceSlug(root)}-${digest}`;
}

function readManifest(manifestPath) {
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    fail(`invalid workspace manifest ${manifestPath}: ${error.message}`);
  }
}

function writeManifest(manifestPath, manifest) {
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  const temporary = `${manifestPath}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, manifestPath);
}

export function resolveWorkspace({
  root = process.cwd(),
  mapflowHome = null,
  create = false,
  env = process.env,
  platform = process.platform,
  home = os.homedir(),
} = {}) {
  const discovered = discoverWorkspaceRoot(root);
  const stateHome = path.resolve(defaultMapflowHome({ env, platform, home, override: mapflowHome }));
  const id = workspaceId(discovered.root, platform);
  const directory = path.join(stateHome, "workspaces", id);
  if (pathContains(discovered.root, canonicalPath(directory))) {
    fail(`Mapflow sidecar must be outside the workspace root: ${discovered.root}`);
  }
  const current = path.join(directory, "current");
  const manifestPath = path.join(directory, "workspace.json");
  const paths = {
    directory,
    manifestPath,
    mapPath: path.join(current, "blueprint.yaml"),
    wayfindingPath: path.join(current, "wayfinding.yaml"),
    briefsPath: path.join(current, "briefs"),
    statePath: path.join(current, "state.json"),
    eventsPath: path.join(current, "events.jsonl"),
    wayfindingEventsPath: path.join(current, "wayfinding-events.jsonl"),
  };

  let created = false;
  if (fs.existsSync(manifestPath)) {
    const manifest = readManifest(manifestPath);
    if (manifest.schema !== WORKSPACE_SCHEMA || manifest.workspace_id !== id) {
      fail(`workspace manifest identity mismatch: ${manifestPath}`);
    }
    if (identityPath(manifest.workspace_root, platform) !== identityPath(discovered.root, platform)) {
      fail(`workspace manifest is bound to another root: ${manifest.workspace_root}`);
    }
  } else if (create) {
    fs.mkdirSync(paths.briefsPath, { recursive: true });
    const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    writeManifest(manifestPath, {
      schema: WORKSPACE_SCHEMA,
      workspace_id: id,
      workspace_root: discovered.root,
      workspace_kind: discovered.kind,
      created_at: timestamp,
      paths: {
        map: "current/blueprint.yaml",
        wayfinding: "current/wayfinding.yaml",
        briefs: "current/briefs",
        state: "current/state.json",
        events: "current/events.jsonl",
        wayfinding_events: "current/wayfinding-events.jsonl",
      },
    });
    created = true;
  }

  return {
    schema: WORKSPACE_SCHEMA,
    workspace_id: id,
    workspace_root: discovered.root,
    workspace_kind: discovered.kind,
    mapflow_home: stateHome,
    created,
    exists: fs.existsSync(manifestPath),
    legacy_project_state: fs.existsSync(path.join(discovered.root, ".mapflow")),
    ...paths,
  };
}
