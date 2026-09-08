import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Notes } from "../src/notes.mjs";

test("existing add and list persist active notes", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pocket-notes-"));
  const file = path.join(directory, "notes.json");
  const notes = new Notes(file);
  const created = notes.add("保留现有行为");
  assert.equal(created.status, "active");
  assert.deepEqual(new Notes(file).list().map((item) => item.text), ["保留现有行为"]);
  fs.rmSync(directory, { recursive: true, force: true });
});
