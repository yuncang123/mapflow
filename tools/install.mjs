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
const OBSOLETE_PROJECT_ENTRIES = [
  ".agents/skills/node-slicing",
  ".agents/skills/node-delivery",
  ".mapflow/templates/work-item.md",
  ".mapflow/blueprint/vibe-coding.md",
  ".mapflow/blueprint/vibe-coding.workflow.html",
];
const OBSOLETE_GLOBAL_ENTRIES = [
  "mapflow/skills/node-slicing",
  "mapflow/skills/node-delivery",
];

class InstallError extends Error {}

function fail(message) {
  throw new InstallError(message);
}

function required(options, name) {
  const value = options.get(name);
  if (typeof value !== "string" || value.trim() === "") fail(`${name} is required`);
  return value;
}

function parseOptions(argv) {
  const options = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--global" || token === "--force" || token === "--dry-run" || token === "--help" || token === "-h") {
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
  process.stdout.write(`usage: node tools/install.mjs --target PATH [--profile core] [--force] [--dry-run]\n`);
  process.stdout.write(`       node tools/install.mjs --global [--force] [--dry-run]\n\n`);
  process.stdout.write("Install mapflow's core skills and local runtime, or install the global entry skill bundle.\n");
}

function sourceEntries() {
  const entries = [
    ["tools/mapflow.mjs", ".mapflow/mapflow.mjs"],
    ["tools/mapflow-core.mjs", ".mapflow/mapflow-core.mjs"],
    ["tools/mapflow-board.mjs", ".mapflow/mapflow-board.mjs"],
    ["tools/mapflow-board-core.mjs", ".mapflow/mapflow-board-core.mjs"],
    ["tools/board", ".mapflow/board"],
    ["tools/vendor", ".mapflow/vendor"],
    ["docs/workflow.md", ".mapflow/workflow.md"],
    ["docs/skill-routing.md", ".mapflow/skill-routing.md"],
    ["docs/blueprint/map-model.md", ".mapflow/blueprint/map-model.md"],
    ["templates/map.md", ".mapflow/templates/map.md"],
    ["templates/task-brief.md", ".mapflow/templates/task-brief.md"],
    ["templates/briefs", ".mapflow/templates/briefs"],
    ["templates/decision.md", ".mapflow/templates/decision.md"],
    ["templates/checkpoint.md", ".mapflow/templates/checkpoint.md"],
    ["templates/blueprint.yaml", ".mapflow/templates/blueprint.yaml"],
    ["templates/blueprint.schema.json", ".mapflow/templates/blueprint.schema.json"],
  ];
  for (const skill of CORE_SKILLS) {
    entries.push([`skills/${skill}`, `.agents/skills/${skill}`]);
  }
  return entries;
}

function globalSourceEntries() {
  const entries = [
    ["skills/mapflow/SKILL.md", "mapflow/SKILL.md"],
    ["skills/mapflow/agents/openai.yaml", "mapflow/agents/openai.yaml"],
    ["docs/workflow.md", "mapflow/references/workflow.md"],
    ["docs/skill-routing.md", "mapflow/references/skill-routing.md"],
    ["docs/blueprint/map-model.md", "mapflow/references/blueprint.md"],
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

function installableContent(relativeSource, layout = "project") {
  const source = path.join(SOURCE_ROOT, relativeSource);
  let content = fs.readFileSync(source, "utf8");
  if (relativeSource === "skills/mapflow/SKILL.md" && layout === "global") {
    content = content
      .replace("本仓库：`docs/workflow.md`\n- 安装到目标仓库：`.mapflow/workflow.md`", "全局包：`references/workflow.md`\n- 项目状态：`.mapflow/state.json`（首次启用时按项目约定创建）")
      .replace("相邻 Skill：`../<name>/SKILL.md`", "内含 Skill：`skills/<name>/SKILL.md`")
      .replace("4. 在目标仓库使用 `node .mapflow/mapflow.mjs`；在本仓库使用 `node tools/mapflow.mjs`。", "4. 在目标仓库使用 `node .mapflow/mapflow.mjs`；全局包不直接保存项目状态。");
  }
  if (relativeSource === "docs/workflow.md" || relativeSource === "docs/blueprint/map-model.md") {
    content = content
      .replaceAll("templates/", ".mapflow/templates/")
      .replaceAll("skills/mapflow", ".agents/skills/mapflow")
      .replaceAll("node tools/mapflow.mjs", "node .mapflow/mapflow.mjs");
  }
  return content;
}

function agentsSnippet() {
  return `# mapflow 使用建议\n\n` +
    `当用户明确说“启用 mapflow”或“进入地图优先模式”时，读取 .mapflow/workflow.md，按起始事实、目标回归、正向证明、工作边施工、证据更新和到达审计推进。\n` +
    `普通开发请求不自动加载完整 mapflow；没有批准目的地和唯一 active_edge 时，不执行工作边。\n`;
}

function install(targetRoot, options, layout = "project") {
  const profile = options.get("profile") ?? "core";
  if (profile !== "core") fail(`unsupported profile: ${profile} (available: core)`);
  if (!fs.existsSync(targetRoot) || !fs.statSync(targetRoot).isDirectory()) {
    fail(`target directory not found: ${targetRoot}`);
  }

  const entries = layout === "global" ? globalSourceEntries() : sourceEntries();
  ensureSourceEntries(entries);
  const manifestEntry = ["<generated>", ".mapflow/install-manifest.json"];
  const snippetEntry = ["<generated>", ".mapflow/AGENTS.snippet.md"];
  const generatedEntries = layout === "global"
    ? [["<generated>", "mapflow/install-manifest.json"]]
    : [manifestEntry, snippetEntry];
  const allEntries = [...entries, ...generatedEntries];
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

  if (options.has("force")) {
    const obsoleteEntries = layout === "global" ? OBSOLETE_GLOBAL_ENTRIES : OBSOLETE_PROJECT_ENTRIES;
    for (const relativeTarget of obsoleteEntries) {
      const target = path.resolve(targetRoot, relativeTarget);
      const relative = path.relative(path.resolve(targetRoot), target);
      if (relative.startsWith("..") || path.isAbsolute(relative)) fail(`obsolete path escapes target: ${relativeTarget}`);
      fs.rmSync(target, { recursive: true, force: true });
    }
  }

  for (const [relativeSource, relativeTarget] of entries) {
    const source = path.join(SOURCE_ROOT, relativeSource);
    const target = path.join(targetRoot, relativeTarget);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (fs.statSync(source).isDirectory()) {
      fs.cpSync(source, target, { recursive: true });
    } else if (relativeSource === "docs/workflow.md" || relativeSource === "docs/blueprint/map-model.md" || relativeSource === "skills/mapflow/SKILL.md") {
      fs.writeFileSync(target, installableContent(relativeSource, layout), "utf8");
    } else {
      fs.copyFileSync(source, target);
    }
  }

  const generated = {
    package: PACKAGE.name,
    version: VERSION,
    profile,
    installed_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    skills: CORE_SKILLS,
    blueprint_schema: 2,
    runtime: layout === "global" ? "project-local:.mapflow/mapflow.mjs" : ".mapflow/mapflow.mjs",
  };
  const manifestPath = path.join(targetRoot, generatedEntries[0][1]);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(generated, null, 2)}\n`, "utf8");
  if (layout === "project") {
    const snippetPath = path.join(targetRoot, snippetEntry[1]);
    fs.writeFileSync(snippetPath, agentsSnippet(), "utf8");
  }

  const agentsPath = path.join(targetRoot, "AGENTS.md");
  process.stdout.write(`installed mapflow ${VERSION} (${profile}) into ${targetRoot}\n`);
  if (layout === "project") {
    process.stdout.write(`runtime: ${path.join(targetRoot, ".mapflow/mapflow.mjs")}\n`);
    process.stdout.write(`AGENTS.md was ${fs.existsSync(agentsPath) ? "left unchanged" : "not present"}; review ${path.join(targetRoot, snippetEntry[1])} before adding the guidance.\n`);
  } else {
    process.stdout.write(`entry skill: ${path.join(targetRoot, "mapflow/SKILL.md")}\n`);
  }
}

export function main(argv) {
  const options = parseOptions(argv);
  if (options.has("help") || options.has("h")) {
    printHelp();
    return 0;
  }
  const isGlobal = options.has("global");
  if (isGlobal && options.has("target")) fail("use either --global or --target, not both");
  const target = isGlobal
    ? path.join(process.env.USERPROFILE || os.homedir(), ".agents", "skills")
    : path.resolve(process.cwd(), required(options, "target"));
  if (isGlobal && !fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
  install(target, options, isGlobal ? "global" : "project");
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
