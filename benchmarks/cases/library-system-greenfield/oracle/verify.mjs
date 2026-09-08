#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? "");
if (!root || !fs.existsSync(root)) throw new Error("target root is missing");

const packagePath = path.join(root, "package.json");
if (!fs.existsSync(packagePath)) throw new Error("package.json is missing");
const manifest = JSON.parse(fs.readFileSync(packagePath, "utf8"));
if (!manifest.scripts?.test || !manifest.scripts?.start) throw new Error("npm test and npm start scripts are required");

const tested = process.platform === "win32" ? spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "npm test --silent"], {
  cwd: root,
  encoding: "utf8",
  timeout: 60000,
  windowsHide: true,
}) : spawnSync("npm", ["test", "--silent"], { cwd: root, encoding: "utf8", timeout: 60000, windowsHide: true });
if (tested.status !== 0) throw new Error(`npm test failed\n${tested.stdout}\n${tested.stderr}`);

const start = manifest.scripts.start.match(/^node(?:\.exe)?\s+(.+)$/);
if (!start) throw new Error("npm start must be a direct node entry so the hidden verifier can isolate and stop it");
const entry = start[1].trim().replace(/^['"]|['"]$/g, "");
const port = 44000 + Math.floor(Math.random() * 1000);
const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-library-oracle-"));
const dataFile = path.join(dataDirectory, "library.json");
const base = `http://127.0.0.1:${port}`;

async function waitForServer(child) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited early with ${child.exitCode}`);
    try {
      const response = await fetch(`${base}/`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("server did not become ready within 8 seconds");
}

function startServer() {
  return spawn(process.execPath, [entry], {
    cwd: root,
    env: { ...process.env, PORT: String(port), LIBRARY_DATA_FILE: dataFile },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 1500)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function json(method, pathname, body, expected = [200, 201]) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!expected.includes(response.status)) throw new Error(`${method} ${pathname} returned ${response.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

function idOf(value, names) {
  const candidates = [value, value?.data, value?.book, value?.reader, value?.loan];
  for (const candidate of candidates) {
    for (const name of names) if (candidate?.[name]) return candidate[name];
  }
  throw new Error(`response does not expose ${names.join("/")}: ${JSON.stringify(value)}`);
}

let child = startServer();
try {
  await waitForServer(child);
  const page = await fetch(`${base}/`);
  const html = await page.text();
  if (!page.ok || !/<html|<!doctype/i.test(html)) throw new Error("GET / did not return an HTML application");

  const book = await json("POST", "/api/books", { title: "活着", author: "余华", isbn: "9787506365437" });
  const reader = await json("POST", "/api/readers", { name: "测试读者" });
  const bookId = idOf(book, ["id", "bookId"]);
  const readerId = idOf(reader, ["id", "readerId"]);
  await json("POST", "/api/loans", { bookId, readerId });
  const active = await json("GET", "/api/loans?status=active");
  const activeList = Array.isArray(active) ? active : active.loans ?? active.data ?? [];
  if (!Array.isArray(activeList) || activeList.length !== 1) throw new Error("active loan query did not return the created loan");

  await stopServer(child);
  child = startServer();
  await waitForServer(child);
  const persisted = await json("GET", "/api/loans?status=active");
  const persistedList = Array.isArray(persisted) ? persisted : persisted.loans ?? persisted.data ?? [];
  if (!Array.isArray(persistedList) || persistedList.length !== 1) throw new Error("active loan did not survive restart");

  const loanId = idOf(persistedList[0], ["id", "loanId"]);
  await json("POST", "/api/returns", { loanId, bookId });
  const afterReturn = await json("GET", "/api/loans?status=active");
  const remaining = Array.isArray(afterReturn) ? afterReturn : afterReturn.loans ?? afterReturn.data ?? [];
  if (!Array.isArray(remaining) || remaining.length !== 0) throw new Error("return did not close the active loan");

  process.stdout.write("hidden acceptance passed: UI, catalog, reader, loan, persistence, return\n");
} finally {
  await stopServer(child);
  fs.rmSync(dataDirectory, { recursive: true, force: true });
}
