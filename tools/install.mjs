#!/usr/bin/env node

import fs from "node:fs";
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
  "node-slicing",
  "node-delivery",
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
    if (token === "--force" || token === "--dry-run" || token === "--help" || token === "-h") {
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
  process.stdout.write(`usage: node tools/install.mjs --target PATH [--profile core] [--force] [--dry-run]\n\n`);
  process.stdout.write("Install mapflow's core skills and local runtime into a target repository.\n");
}

function sourceEntries() {
  const entries = [
    ["tools/mapflow.mjs", ".mapflow/mapflow.mjs"],
    ["docs/workflow.md", ".mapflow/workflow.md"],
    ["docs/skill-routing.md", ".mapflow/skill-routing.md"],
    ["docs/blueprint/vibe-coding.md", ".mapflow/blueprint/vibe-coding.md"],
    ["docs/blueprint/vibe-coding.workflow.html", ".mapflow/blueprint/vibe-coding.workflow.html"],
    ["templates/map.md", ".mapflow/templates/map.md"],
    ["templates/work-item.md", ".mapflow/templates/work-item.md"],
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

function ensureSourceEntries(entries) {
  for (const [relativeSource] of entries) {
    const source = path.join(SOURCE_ROOT, relativeSource);
    if (!fs.existsSync(source)) fail(`source entry not found: ${relativeSource}`);
  }
}

function agentsSnippet() {
  return `# mapflow 使用建议\n\n` +
    `当用户明确说“启用 mapflow”或“进入地图优先模式”时，读取 .mapflow/workflow.md，按目的地、勘探、蓝图批准、节点施工、验证和到达审计推进。\n` +
    `普通开发请求不自动加载完整 mapflow；没有批准目的地和唯一当前节点时，不写入代码。\n`;
}

function install(targetRoot, options) {
  const profile = options.get("profile") ?? "core";
  if (profile !== "core") fail(`unsupported profile: ${profile} (available: core)`);
  if (!fs.existsSync(targetRoot) || !fs.statSync(targetRoot).isDirectory()) {
    fail(`target directory not found: ${targetRoot}`);
  }

  const entries = sourceEntries();
  ensureSourceEntries(entries);
  const manifestEntry = ["<generated>", ".mapflow/install-manifest.json"];
  const snippetEntry = ["<generated>", ".mapflow/AGENTS.snippet.md"];
  const allEntries = [...entries, manifestEntry, snippetEntry];
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

  for (const [relativeSource, relativeTarget] of entries) {
    const source = path.join(SOURCE_ROOT, relativeSource);
    const target = path.join(targetRoot, relativeTarget);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(source, target, { recursive: true });
  }

  const generated = {
    package: PACKAGE.name,
    version: VERSION,
    profile,
    installed_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    skills: CORE_SKILLS,
    runtime: ".mapflow/mapflow.mjs",
  };
  const manifestPath = path.join(targetRoot, manifestEntry[1]);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(generated, null, 2)}\n`, "utf8");
  const snippetPath = path.join(targetRoot, snippetEntry[1]);
  fs.writeFileSync(snippetPath, agentsSnippet(), "utf8");

  const agentsPath = path.join(targetRoot, "AGENTS.md");
  process.stdout.write(`installed mapflow ${VERSION} (${profile}) into ${targetRoot}\n`);
  process.stdout.write(`runtime: ${path.join(targetRoot, ".mapflow/mapflow.mjs")}\n`);
  process.stdout.write(`AGENTS.md was ${fs.existsSync(agentsPath) ? "left unchanged" : "not present"}; review ${snippetPath} before adding the guidance.\n`);
}

export function main(argv) {
  const options = parseOptions(argv);
  if (options.has("help") || options.has("h")) {
    printHelp();
    return 0;
  }
  const target = path.resolve(process.cwd(), required(options, "target"));
  install(target, options);
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
