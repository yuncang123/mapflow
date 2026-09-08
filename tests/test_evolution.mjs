import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createBoardServer } from "../tools/mapflow-board.mjs";
import { readWayfindingEvents } from "../tools/mapflow-evolution.mjs";
import { readWayfinding } from "../tools/mapflow-wayfinding.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const CLI = path.join(ROOT, "tools", "mapflow.mjs");
const EVOLUTION_DEMO = path.join(ROOT, "tools", "evolution-demo.mjs");

function run(...args) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: "utf8" });
}

function assertExit(result, expected = 0) {
  assert.equal(result.status, expected, result.stderr || result.stdout);
}

function enabledWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-evolution-workspace-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-evolution-home-"));
  assertExit(spawnSync("git", ["init", "--quiet", root], { encoding: "utf8", windowsHide: true }));
  const enabled = run("enable", "--root", root, "--mapflow-home", home, "--json");
  assertExit(enabled);
  return { root, home, enabled: JSON.parse(enabled.stdout) };
}

test("fresh enable records the real blank frame before the initial fog map", () => {
  const { enabled } = enabledWorkspace();
  assert.ok(fs.existsSync(enabled.paths.wayfinding_events));
  const journal = readWayfindingEvents(enabled.paths.wayfinding_events);
  assert.equal(journal.coverage.complete, true);
  assert.deepEqual(journal.events.map((event) => event.type), [
    "mapflow.workspace.enabled.v1",
    "mapflow.wayfinding.initialized.v1",
  ]);
  assert.equal(journal.events[0].data.snapshot, null);
  assert.equal(journal.events[1].data.snapshot.origin.kind, "fog");
  assert.equal(journal.events[1].data.snapshot.destination.kind, "fog");
  assert.equal(journal.events[1].previous_digest, journal.events[0].event_digest);
});

test("question answers and semantic draft writes append attributable wayfinding frames", () => {
  const { enabled } = enabledWorkspace();
  const answer = run(
    "--state", enabled.paths.state,
    "wayfinding-answer", "--question", "establish-starting-state",
    "--answer", "已勘探仓库、运行入口和当前约束",
    "--evidence-ref", "note:owner-survey",
  );
  assertExit(answer);
  let journal = readWayfindingEvents(enabled.paths.wayfinding_events);
  assert.equal(journal.events.length, 3);
  assert.equal(journal.events.at(-1).type, "mapflow.wayfinding.question.answered.v1");
  assert.equal(journal.events.at(-1).actor, "human:owner");
  assert.equal(journal.events.at(-1).data.target.id, "workspace-origin-fog");

  const draft = readWayfinding(enabled.paths.wayfinding).draft;
  draft.intent.statement = "开发一个个人图书管理系统 MVP";
  const candidate = path.join(path.dirname(enabled.sidecar), "candidate.json");
  fs.writeFileSync(candidate, `${JSON.stringify(draft, null, 2)}\n`, "utf8");
  assertExit(run("--state", enabled.paths.state, "wayfinding-write", "--draft-file", candidate));
  journal = readWayfindingEvents(enabled.paths.wayfinding_events);
  assert.equal(journal.events.length, 4);
  assert.equal(journal.events.at(-1).type, "mapflow.wayfinding.draft.written.v1");
  assert.equal(journal.events.at(-1).data.snapshot.intent.statement, "开发一个个人图书管理系统 MVP");

  const before = fs.readFileSync(enabled.paths.wayfinding_events, "utf8");
  assertExit(run("--state", enabled.paths.state, "wayfinding-write", "--draft-file", candidate));
  assert.equal(fs.readFileSync(enabled.paths.wayfinding_events, "utf8"), before, "semantic no-op must not invent a frame");
});

test("runtime init bridges the frozen wayfinding head and becomes a replayable frame", async () => {
  const { enabled } = enabledWorkspace();
  fs.copyFileSync(path.join(ROOT, "templates", "blueprint.yaml"), enabled.paths.map);
  fs.cpSync(path.join(ROOT, "templates", "briefs"), enabled.paths.briefs, { recursive: true });
  assertExit(run("--state", enabled.paths.state, "init", "--map", enabled.paths.map));

  const journal = readWayfindingEvents(enabled.paths.wayfinding_events);
  const runtimeEvents = fs.readFileSync(enabled.paths.events, "utf8").trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(runtimeEvents.length, 1);
  assert.equal(runtimeEvents[0].data.details.source_wayfinding.head_digest, journal.head_digest);
  assert.equal(runtimeEvents[0].data.details.source_wayfinding.seq, journal.events.length);
  const lateAnswer = run(
    "--state", enabled.paths.state,
    "wayfinding-answer", "--question", "establish-starting-state",
    "--answer", "late mutation", "--evidence-ref", "note:late",
  );
  assertExit(lateAnswer, 1);
  assert.match(lateAnswer.stderr, /formal runtime already exists.*replan/);

  const server = createBoardServer({ statePath: enabled.paths.state });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const catalogResponse = await fetch(`${base}/api/evolution`);
    assert.equal(catalogResponse.status, 200);
    const catalog = await catalogResponse.json();
    assert.equal(catalog.coverage.complete, true);
    assert.equal(catalog.frames.length, 3);
    assert.deepEqual(catalog.frames.map((frame) => frame.phase), ["empty", "survey", "wayfinding"]);

    const blank = await (await fetch(`${base}/api/evolution/frames/wayfinding:1`)).json();
    assert.equal(blank.board.projection.mode, "empty");
    assert.deepEqual(blank.diff.nodes.added, []);

    const fog = await (await fetch(`${base}/api/evolution/frames/wayfinding:2`)).json();
    assert.equal(fog.board.projection.mode, "wayfinding");
    assert.equal(fog.board.nodes.length, 2);
    assert.equal(fog.diff.nodes.added.length, 2);

    const runtime = await (await fetch(`${base}/api/evolution/frames/runtime:1`)).json();
    assert.equal(runtime.board.projection.mode, "runtime");
    assert.equal(runtime.event.bridge_from.digest, journal.head_digest);
    assert.equal(runtime.board.evolution.historical, true);
    assert.equal(runtime.board.evolution.submaps.mode, "independent-streams");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("the replay catalog follows the real runtime chain through evidence and arrival audit", async () => {
  const { enabled } = enabledWorkspace();
  fs.copyFileSync(path.join(ROOT, "templates", "blueprint.yaml"), enabled.paths.map);
  fs.cpSync(path.join(ROOT, "templates", "briefs"), enabled.paths.briefs, { recursive: true });
  const command = (...args) => run("--state", enabled.paths.state, ...args);
  assertExit(command("init", "--map", enabled.paths.map));
  const routeRequest = command(
    "request-route-approval", "--question", "是否批准完整路线？",
    "--requester", "agent:codex", "--decision-owner", "human:owner", "--json",
  );
  assertExit(routeRequest);
  assertExit(command(
    "approve", "--request", JSON.parse(routeRequest.stdout).request_id,
    "--answer", "确认并批准完整路线", "--actor", "human:owner",
  ));

  const edges = [
    ["settle-audience", "audience-known", ""],
    ["write-candidate", "article-drafted,sensitive-content-checked", "sensitive-review-recorded"],
    ["obtain-owner-approval", "owner-approved", ""],
    ["publish-article", "article-published,public-url-exists", "public-page-readable"],
  ];
  for (const [edge, proves, acceptance] of edges) {
    const requested = command(
      "request-authorization", "--edge", edge, "--question", `是否实施 ${edge}？`,
      "--requester", "agent:codex", "--decision-owner", "human:owner", "--json",
    );
    assertExit(requested);
    assertExit(command(
      "authorize", "--request", JSON.parse(requested.stdout).request_id,
      "--answer", `批准实施 ${edge}`, "--actor", "human:owner",
    ));
    const verifyArgs = [
      "verify", "--edge", edge,
      "--evidence", `${edge} evidence`, "--command", `check ${edge}`,
      "--observed", `${edge} observed`, "--result", "pass",
      "--proves", proves, "--executor", "agent:codex",
      "--model", "gpt-5.6-sol", "--reasoning", "high",
    ];
    if (acceptance) verifyArgs.push("--acceptance", acceptance);
    if (edge === "publish-article") verifyArgs.push("--outcome-ref", "external:https://example.invalid/article");
    assertExit(command(...verifyArgs));
  }
  const audit = command(
    "request-arrival-audit", "--question", "目的地证据、非目标和残余风险是否通过独立审计？",
    "--requester", "agent:codex", "--decision-owner", "human:owner", "--json",
  );
  assertExit(audit);
  assertExit(command(
    "arrive", "--request", JSON.parse(audit.stdout).request_id,
    "--answer", "确认目的地证据完整且非目标未扩散", "--actor", "human:owner",
    "--non-goals", "自动选择受众", "--risks", "none",
  ));

  const server = createBoardServer({ statePath: enabled.paths.state });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const catalog = await (await fetch(`${base}/api/evolution`)).json();
    assert.equal(catalog.frames[0].phase, "empty");
    assert.equal(catalog.frames.at(-1).type, "mapflow.arrival.audited.v1");
    const arrived = await (await fetch(`${base}/api/evolution/frames/${catalog.frames.at(-1).id}`)).json();
    assert.equal(arrived.board.map.actual_arrival, "audited");
    assert.equal(arrived.board.summary.verified_edges, 4);
    assert.equal(arrived.board.summary.acceptance_passed, 2);
    assert.ok(arrived.diff.nodes.changed.length > 0, "arrival audit must visibly change the destination node");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("a damaged wayfinding journal fails closed without changing the current draft", () => {
  const { enabled } = enabledWorkspace();
  const lines = fs.readFileSync(enabled.paths.wayfinding_events, "utf8").trim().split(/\r?\n/);
  const damaged = JSON.parse(lines[1]);
  damaged.data.summary = "tampered";
  lines[1] = JSON.stringify(damaged);
  fs.writeFileSync(enabled.paths.wayfinding_events, `${lines.join("\n")}\n`, "utf8");
  const before = fs.readFileSync(enabled.paths.wayfinding, "utf8");
  const result = run(
    "--state", enabled.paths.state,
    "wayfinding-answer", "--question", "establish-starting-state",
    "--answer", "仓库已勘探", "--evidence-ref", "note:owner",
  );
  assertExit(result, 1);
  assert.match(result.stderr, /wayfinding event digest mismatch/);
  assert.equal(fs.readFileSync(enabled.paths.wayfinding, "utf8"), before);
});

test("a forged wayfinding stream identity fails closed", () => {
  const { enabled } = enabledWorkspace();
  const lines = fs.readFileSync(enabled.paths.wayfinding_events, "utf8").trim().split(/\r?\n/);
  const forged = JSON.parse(lines[0]);
  forged.stream = "wayfinding/another-workspace";
  lines[0] = JSON.stringify(forged);
  fs.writeFileSync(enabled.paths.wayfinding_events, `${lines.join("\n")}\n`, "utf8");
  assert.throws(
    () => readWayfindingEvents(enabled.paths.wayfinding_events),
    /source does not match its stream|digest mismatch/,
  );
});

test("legacy maps expose partial coverage instead of invented prehistory", async () => {
  const server = createBoardServer({ mapPath: path.join(ROOT, "templates", "blueprint.yaml") });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/evolution`);
    assert.equal(response.status, 200);
    const catalog = await response.json();
    assert.equal(catalog.coverage.complete, false);
    assert.match(catalog.coverage.reason, /未记录|not recorded/i);
    assert.deepEqual(catalog.frames, []);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("a definition-only map never discovers adjacent runtime journals", async () => {
  const { enabled } = enabledWorkspace();
  fs.copyFileSync(path.join(ROOT, "templates", "blueprint.yaml"), enabled.paths.map);
  fs.cpSync(path.join(ROOT, "templates", "briefs"), enabled.paths.briefs, { recursive: true });
  assertExit(run("--state", enabled.paths.state, "init", "--map", enabled.paths.map));

  const server = createBoardServer({ mapPath: enabled.paths.map });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const catalog = await (await fetch(`http://127.0.0.1:${server.address().port}/api/evolution`)).json();
    assert.equal(catalog.recording_status, "not-recorded");
    assert.deepEqual(catalog.frames, []);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("evolution endpoints are read-only, cacheable, and the board ships accessible player controls", async () => {
  const { enabled } = enabledWorkspace();
  const server = createBoardServer({ statePath: enabled.paths.state });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const first = await fetch(`${base}/api/evolution`);
    const etag = first.headers.get("etag");
    assert.ok(etag);
    assert.equal((await fetch(`${base}/api/evolution`, { headers: { "If-None-Match": etag } })).status, 304);
    assert.equal((await fetch(`${base}/api/evolution`, { method: "HEAD" })).status, 200);
    assert.equal((await fetch(`${base}/api/evolution`, { method: "POST" })).status, 405);

    const page = await (await fetch(base)).text();
    assert.match(page, /id="evolution-player"/);
    assert.match(page, /id="evolution-slider"[^>]*type="range"/);
    assert.match(page, /id="evolution-live"/);
    const app = await (await fetch(`${base}/app.js`)).text();
    assert.match(app, /\/api\/evolution/);
    assert.match(app, /pendingLive/);
    assert.match(app, /prefers-reduced-motion/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("the software-project demo genuinely traverses shaping, regression, evidence, and arrival", () => {
  const result = spawnSync(process.execPath, [EVOLUTION_DEMO, "--no-serve"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 30_000,
  });
  assertExit(result);
  const output = JSON.parse(result.stdout);
  const wayfinding = readWayfindingEvents(output.wayfinding_events);
  const snapshots = wayfinding.events.map((event) => event.data.snapshot).filter(Boolean);
  assert.ok(snapshots.some((draft) => draft.phase === "shaping"));
  assert.ok(snapshots.some((draft) => draft.phase === "regression"));
  const finalDraft = snapshots.at(-1);
  assert.equal(finalDraft.destination.status, "confirmed");
  assert.equal(finalDraft.nodes.filter((node) => node.status === "confirmed").length, 2);
  assert.equal(finalDraft.edges.filter((edge) => edge.status === "confirmed").length, 3);
  assert.equal(finalDraft.questions.some((question) => (question.status ?? "pending") === "pending"), false);
  const runtimeEvents = fs.readFileSync(output.runtime_events, "utf8").trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(runtimeEvents[0].data.details.source_wayfinding.head_digest, wayfinding.head_digest);
  assert.equal(runtimeEvents.at(-1).type, "mapflow.arrival.audited.v1");
  assert.equal(runtimeEvents.at(-1).data.projection.phase, "arrived");
});
