#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE = JSON.parse(fs.readFileSync(path.join(SOURCE_ROOT, "package.json"), "utf8"));
const VERSION = PACKAGE.version;
const CORE_SKILLS = [
  "mapflow",
  "destination-shaping",
  "repository-recon",
  "blueprint-planning",
  "edge-slicing",
  "edge-delivery",
];
class InstallError extends Error {}

function fail(message) {
  throw new InstallError(message);
}

function parseOptions(argv) {
  const options = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (["--global", "--force", "--dry-run", "--help", "-h"].includes(token)) {
      options.set(token.replace(/^--/, ""), true);
      continue;
    }
    if (!token.startsWith("--")) fail(`unexpected argument: ${token}`);
    const name = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`value is required for --${name}`);
    options.set(name, value);
    index += 1;
  }
  return options;
}

function printHelp() {
  process.stdout.write("usage: node tools/install.mjs --global [--force] [--dry-run]\n\n");
  process.stdout.write("Install the user-level Mapflow entry, runtime, references, templates, and phase skills.\n");
  process.stdout.write("Project installation is intentionally unsupported; workspace data lives in a repository-external sidecar.\n");
}

function globalSourceEntries() {
  const entries = [
    ["tools/mapflow.mjs", "mapflow/runtime/mapflow.mjs"],
    ["tools/mapflow-core.mjs", "mapflow/runtime/mapflow-core.mjs"],
    ["tools/mapflow-proof.mjs", "mapflow/runtime/mapflow-proof.mjs"],
    ["tools/mapflow-workspace.mjs", "mapflow/runtime/mapflow-workspace.mjs"],
    ["tools/mapflow-wayfinding.mjs", "mapflow/runtime/mapflow-wayfinding.mjs"],
    ["tools/mapflow-evolution.mjs", "mapflow/runtime/mapflow-evolution.mjs"],
    ["tools/mapflow-board.mjs", "mapflow/runtime/mapflow-board.mjs"],
    ["tools/mapflow-board-core.mjs", "mapflow/runtime/mapflow-board-core.mjs"],
    ["tools/evolution-demo.mjs", "mapflow/runtime/evolution-demo.mjs"],
    ["tools/board", "mapflow/runtime/board"],
    ["tools/vendor", "mapflow/runtime/vendor"],
    ["skills/mapflow/SKILL.md", "mapflow/SKILL.md"],
    ["skills/mapflow/agents/openai.yaml", "mapflow/agents/openai.yaml"],
    ["docs/workflow.md", "mapflow/references/workflow.md"],
    ["docs/skill-routing.md", "mapflow/references/skill-routing.md"],
    ["docs/blueprint/map-model.md", "mapflow/references/blueprint/map-model.md"],
    ["docs/integration/enterprise-handoffs.md", "mapflow/references/integration/enterprise-handoffs.md"],
    ["templates", "mapflow/templates"],
    ["examples/community-workshop", "mapflow/examples/community-workshop"],
    ["examples/library-system-evolution", "mapflow/examples/library-system-evolution"],
  ];
  for (const skill of CORE_SKILLS.filter((name) => name !== "mapflow")) {
    entries.push([`skills/${skill}`, `mapflow/skills/${skill}`]);
  }
  return entries;
}

function ensureSourceEntries(entries) {
  for (const [relativeSource] of entries) {
    const source = path.join(SOURCE_ROOT, relativeSource);
    if (!fs.existsSync(source)) fail(`source entry not found: ${relativeSource}`);
  }
}

function installableContent(relativeSource) {
  const source = path.join(SOURCE_ROOT, relativeSource);
  let content = fs.readFileSync(source, "utf8");
  if (relativeSource === "skills/mapflow/SKILL.md") {
    content = content
      .replace("本仓库维护副本：`docs/workflow.md`；用户级安装包：`references/workflow.md`。", "行为真源：`references/workflow.md`。")
      .replace("维护仓库使用 `../../tools/mapflow.mjs`；用户级安装包使用 `runtime/mapflow.mjs`。", "运行时：`runtime/mapflow.mjs`。")
      .replace("维护仓库中的相邻 Skill 位于 `../<name>/SKILL.md`；用户级安装包内含 Skill 位于 `skills/<name>/SKILL.md`。", "内含 Skill：`skills/<name>/SKILL.md`。");
  } else if (relativeSource === "docs/blueprint/map-model.md") {
    content = content.replace("`docs/workflow.md`", "`references/workflow.md`");
  } else if (relativeSource === "examples/community-workshop/README.md") {
    content = content.replaceAll("node tools/mapflow.mjs", "node <mapflow-package>/runtime/mapflow.mjs");
  }
  return content;
}

function writeGlobalPackage(writeRoot, entries, manifest) {
  for (const [relativeSource, relativeTarget] of entries) {
    const source = path.join(SOURCE_ROOT, relativeSource);
    const target = path.join(writeRoot, relativeTarget);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (fs.statSync(source).isDirectory()) {
      fs.cpSync(source, target, { recursive: true });
      if (relativeSource === "examples/community-workshop") {
        fs.writeFileSync(
          path.join(target, "README.md"),
          installableContent("examples/community-workshop/README.md"),
          "utf8",
        );
      }
    } else if (["skills/mapflow/SKILL.md", "docs/blueprint/map-model.md"].includes(relativeSource)) {
      fs.writeFileSync(target, installableContent(relativeSource), "utf8");
    } else {
      fs.copyFileSync(source, target);
    }
  }
  const manifestPath = path.join(writeRoot, "mapflow", "install-manifest.json");
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function replaceGlobalPackage(targetRoot, entries, manifest) {
  const packageTarget = path.resolve(targetRoot, "mapflow");
  const relativePackage = path.relative(path.resolve(targetRoot), packageTarget);
  if (relativePackage !== "mapflow") fail("global package target is outside the skills directory");

  const stagingRoot = fs.mkdtempSync(path.join(targetRoot, ".mapflow-install-"));
  const stagedPackage = path.join(stagingRoot, "mapflow");
  const backupTarget = path.join(targetRoot, `.mapflow-backup-${process.pid}-${Date.now()}`);
  let existingMoved = false;
  try {
    writeGlobalPackage(stagingRoot, entries, manifest);
    if (fs.existsSync(packageTarget)) {
      fs.renameSync(packageTarget, backupTarget);
      existingMoved = true;
    }
    try {
      fs.renameSync(stagedPackage, packageTarget);
    } catch (error) {
      if (existingMoved && !fs.existsSync(packageTarget) && fs.existsSync(backupTarget)) {
        fs.renameSync(backupTarget, packageTarget);
        existingMoved = false;
      }
      throw error;
    }
    if (existingMoved) {
      fs.rmSync(backupTarget, { recursive: true, force: true });
      existingMoved = false;
    }
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
    if (existingMoved && !fs.existsSync(packageTarget) && fs.existsSync(backupTarget)) {
      fs.renameSync(backupTarget, packageTarget);
    }
  }
}

function installGlobal(targetRoot, options) {
  if (!fs.existsSync(targetRoot)) fs.mkdirSync(targetRoot, { recursive: true });
  if (!fs.statSync(targetRoot).isDirectory()) fail(`global skills directory is not a directory: ${targetRoot}`);

  const profile = options.get("profile") ?? "core";
  if (profile !== "core") fail(`unsupported profile: ${profile} (available: core)`);
  const entries = globalSourceEntries();
  ensureSourceEntries(entries);
  const generatedEntry = ["<generated>", "mapflow/install-manifest.json"];
  const allEntries = [...entries, generatedEntry];
  const conflicts = allEntries
    .map(([, relativeTarget]) => path.join(targetRoot, relativeTarget))
    .filter((target) => fs.existsSync(target));
  if (conflicts.length > 0 && !options.has("force") && !options.has("dry-run")) {
    fail(`target contains existing mapflow files; use --force to replace:\n${conflicts.join("\n")}`);
  }

  if (options.has("dry-run")) {
    process.stdout.write(`dry-run: would install ${allEntries.length} entries into ${targetRoot}\n`);
    for (const [, relativeTarget] of allEntries) process.stdout.write(`  ${path.join(targetRoot, relativeTarget)}\n`);
    return;
  }

  const manifest = {
    package: PACKAGE.name,
    version: VERSION,
    profile,
    installed_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    skills: CORE_SKILLS,
    blueprint_schema: 3,
    workspace_schema: "mapflow.workspace/v1",
    event_schema: "mapflow.event/v1",
    wayfinding_event_schema: "mapflow.wayfinding-event/v1",
    receipt_schema: "mapflow.arrival-receipt/v1",
    capabilities: [
      "intent",
      "proposal-gate",
      "edge-runs",
      "arrival-audit-request",
      "submap-receipts",
      "multiresolution-board",
      "workspace-sidecar",
      "causal-contracts",
      "derivation-graph",
      "proof-certificates",
      "enterprise-handoff-contract",
      "progressive-context-disclosure",
      "direct-edge-start",
      "wayfinding-draft",
      "explicit-enable",
      "evolution-playback",
    ],
    runtime: "mapflow/runtime/mapflow.mjs",
  };
  replaceGlobalPackage(targetRoot, entries, manifest);
  process.stdout.write(`installed mapflow ${VERSION} (${profile}) into ${targetRoot}\n`);
  process.stdout.write(`entry skill: ${path.join(targetRoot, "mapflow/SKILL.md")}\n`);
  process.stdout.write(`runtime: ${path.join(targetRoot, "mapflow/runtime/mapflow.mjs")}\n`);
}

export function main(argv) {
  const options = parseOptions(argv);
  if (options.has("help") || options.has("h")) {
    printHelp();
    return 0;
  }
  if (options.has("target")) {
    fail("--target is no longer supported; install once with --global and let `enable` create a repository-external workspace sidecar");
  }
  if (!options.has("global")) fail("--global is required; project-local installation is intentionally unsupported");
  const target = path.join(process.env.USERPROFILE || os.homedir(), ".agents", "skills");
  installGlobal(target, options);
  return 0;
}

if (path.resolve(process.argv[1] ?? "") === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
