#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? "");
const cli = path.join(root, "src", "cli.mjs");
if (!fs.existsSync(cli)) throw new Error("src/cli.mjs is missing");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-scope-oracle-"));
const data = path.join(directory, "reading.json");
const csv = path.join(directory, "reading.csv");
const env = { ...process.env, READING_DATA_FILE: data };

function run(args) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, env, encoding: "utf8", timeout: 15000, windowsHide: true });
  if (result.status !== 0) throw new Error(`${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}

try {
  run(["add", "--title", "活着", "--author", "余华"]);
  run(["add", "--title", "城南旧事", "--author", "林海音"]);
  const listed = JSON.parse(run(["list", "--json"]));
  const books = Array.isArray(listed) ? listed : listed.books ?? listed.data;
  if (!Array.isArray(books) || books.length !== 2) throw new Error("list --json did not return both books");
  run(["export", "--output", csv]);
  const content = fs.readFileSync(csv, "utf8").replace(/^\uFEFF/, "");
  const lines = content.trim().split(/\r?\n/);
  if (!/^title,author$/i.test(lines[0]) || !content.includes("活着,余华") || !content.includes("城南旧事,林海音")) throw new Error("CSV contract failed");
  const obsolete = spawnSync(process.execPath, [cli, "share", "--output", path.join(directory, "share.html")], { cwd: root, env, encoding: "utf8", timeout: 15000, windowsHide: true });
  if (obsolete.status === 0) throw new Error("obsolete share command is still presented as delivered behavior");
  process.stdout.write("hidden acceptance passed: add, JSON list, CSV export, obsolete share absent\n");
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
