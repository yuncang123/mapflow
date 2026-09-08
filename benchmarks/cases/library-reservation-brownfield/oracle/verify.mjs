#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? "");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const tests = process.platform === "win32"
  ? spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "npm test --silent"], { cwd: root, encoding: "utf8", timeout: 60000, windowsHide: true })
  : spawnSync("npm", ["test", "--silent"], { cwd: root, encoding: "utf8", timeout: 60000, windowsHide: true });
if (tests.status !== 0) throw new Error(`existing tests failed\n${tests.stdout}\n${tests.stderr}`);

const start = manifest.scripts?.start?.match(/^node(?:\.exe)?\s+(.+)$/);
if (!start) throw new Error("direct node npm start entry is required");
const entry = start[1].trim().replace(/^['"]|['"]$/g, "");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-reservation-oracle-"));
const port = 45000 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, [entry], {
  cwd: root,
  env: { ...process.env, PORT: String(port), LIBRARY_DATA_FILE: path.join(directory, "data.json") },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});

async function wait() {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited early with ${child.exitCode}`);
    try { if ((await fetch(`${base}/`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("server readiness timeout");
}

async function call(method, pathname, body, accepted = [200, 201]) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!accepted.includes(response.status)) throw new Error(`${method} ${pathname}: ${response.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

function id(value, kind) {
  return value.id ?? value[`${kind}Id`] ?? value.data?.id ?? value[kind]?.id;
}

try {
  await wait();
  const book = await call("POST", "/api/books", { title: "城南旧事", author: "林海音", isbn: "9787544250580" });
  const borrower = await call("POST", "/api/readers", { name: "借阅者" });
  const first = await call("POST", "/api/readers", { name: "第一预约者" });
  const second = await call("POST", "/api/readers", { name: "第二预约者" });
  const bookId = id(book, "book");
  await call("POST", "/api/loans", { bookId, readerId: id(borrower, "reader") });
  const firstReservation = await call("POST", "/api/reservations", { bookId, readerId: id(first, "reader") });
  const secondReservation = await call("POST", "/api/reservations", { bookId, readerId: id(second, "reader") });
  if ((firstReservation.status ?? firstReservation.data?.status) !== "active") throw new Error("first reservation is not active");
  if ((secondReservation.status ?? secondReservation.data?.status) !== "active") throw new Error("second reservation is not active");
  await call("POST", "/api/reservations", { bookId, readerId: id(first, "reader") }, [400, 409]);
  await call("POST", "/api/returns", { bookId });
  const listed = await call("GET", "/api/reservations");
  const reservations = Array.isArray(listed) ? listed : listed.reservations ?? listed.data ?? [];
  if (reservations.length !== 2) throw new Error("reservation list length mismatch");
  const firstAfter = reservations.find((item) => item.id === id(firstReservation, "reservation") || item.readerId === id(first, "reader"));
  const secondAfter = reservations.find((item) => item.id === id(secondReservation, "reservation") || item.readerId === id(second, "reader"));
  if (firstAfter?.status !== "ready" || secondAfter?.status !== "active") throw new Error("return did not promote only the earliest reservation");
  const oldLoans = await call("GET", "/api/loans?status=active");
  const loans = Array.isArray(oldLoans) ? oldLoans : oldLoans.loans ?? oldLoans.data ?? [];
  if (loans.length !== 0) throw new Error("existing return behavior regressed");
  process.stdout.write("hidden acceptance passed: existing API plus reservation FIFO and uniqueness\n");
} finally {
  if (child.exitCode === null) child.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 1000))]);
  if (child.exitCode === null) child.kill("SIGKILL");
  fs.rmSync(directory, { recursive: true, force: true });
}
