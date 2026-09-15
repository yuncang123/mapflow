import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RUNTIME_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));

export const RUNTIME_COMPONENTS = [
  "mapflow.mjs",
  "mapflow-core.mjs",
  "mapflow-proof.mjs",
  "mapflow-workspace.mjs",
  "mapflow-wayfinding.mjs",
  "mapflow-evolution.mjs",
  "mapflow-head.mjs",
  "mapflow-runtime.mjs",
  "mapflow-snapshot.mjs",
  "mapflow-board.mjs",
  "mapflow-board-core.mjs",
  "evolution-demo.mjs",
  "vendor/js-yaml/js-yaml.mjs",
  "vendor/cytoscape/cytoscape.min.js",
  "board/index.html",
  "board/app.js",
  "board/styles.css",
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function discoverVersion(directory) {
  const packagePath = path.resolve(directory, "..", "package.json");
  if (fs.existsSync(packagePath)) return readJson(packagePath).version;
  const installManifestPath = path.resolve(directory, "..", "install-manifest.json");
  if (fs.existsSync(installManifestPath)) return readJson(installManifestPath).version;
  return "unknown";
}

export function runtimeBuildDigest(directory = RUNTIME_DIRECTORY) {
  const hash = crypto.createHash("sha256");
  for (const relativePath of RUNTIME_COMPONENTS) {
    const absolutePath = path.resolve(directory, relativePath);
    if (!fs.existsSync(absolutePath)) throw new Error(`runtime component is missing: ${absolutePath}`);
    hash.update(relativePath.replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(fs.readFileSync(absolutePath));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function runtimeIdentity({ directory = RUNTIME_DIRECTORY, version = null } = {}) {
  return {
    version: version ?? discoverVersion(directory),
    build_digest: runtimeBuildDigest(directory),
  };
}

export function runtimeIdentityMatches(left, right) {
  return Boolean(
    left
    && right
    && left.version === right.version
    && left.build_digest === right.build_digest,
  );
}

export function installedRuntimeIdentity({
  env = process.env,
  home = os.homedir(),
  skillsRoot = null,
} = {}) {
  const root = path.resolve(skillsRoot ?? path.join(env.USERPROFILE || home, ".agents", "skills"));
  const packageRoot = path.join(root, "mapflow");
  const manifestPath = path.join(packageRoot, "install-manifest.json");
  const directory = path.join(packageRoot, "runtime");
  if (!fs.existsSync(manifestPath)) {
    return {
      status: "missing",
      path: directory,
      manifest: manifestPath,
      identity: null,
      manifest_matches_files: false,
    };
  }
  try {
    const manifest = readJson(manifestPath);
    const identity = runtimeIdentity({ directory, version: manifest.version });
    return {
      status: manifest.runtime_digest === identity.build_digest ? "current" : "stale",
      path: directory,
      manifest: manifestPath,
      identity,
      declared_build_digest: manifest.runtime_digest ?? null,
      manifest_matches_files: manifest.runtime_digest === identity.build_digest,
    };
  } catch (error) {
    return {
      status: "invalid",
      path: directory,
      manifest: manifestPath,
      identity: null,
      manifest_matches_files: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
