#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] ?? "");
const modulePath = path.join(root, "src", "notes.mjs");
const { Notes } = await import(`${pathToFileURL(modulePath).href}?oracle=${Date.now()}`);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-resume-oracle-"));
const file = path.join(directory, "notes.json");
try {
  const notes = new Notes(file);
  const first = notes.add("第一条");
  notes.add("第二条");
  const archived = notes.archive(first.id);
  if (archived.status !== "archived") throw new Error("archive did not return archived note");
  if (notes.list().length !== 1 || notes.list()[0].text !== "第二条") throw new Error("default list must exclude archived notes");
  const all = notes.list({ includeArchived: true });
  if (all.length !== 2 || !all.some((item) => item.status === "archived")) throw new Error("includeArchived list contract failed");
  const restored = new Notes(file).list({ includeArchived: true });
  if (restored.length !== 2 || restored.find((item) => item.id === first.id)?.status !== "archived") throw new Error("archive status did not persist");
  process.stdout.write("hidden acceptance passed: archive, filtered list, complete list, persistence\n");
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
