import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createBoardServer } from "../tools/mapflow-board.mjs";
import { createBoardSnapshotReader } from "../tools/mapflow-board-core.mjs";
import { readBlueprint } from "../tools/mapflow-core.mjs";
import { readWayfindingEvents } from "../tools/mapflow-evolution.mjs";
import { readWayfinding } from "../tools/mapflow-wayfinding.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const CLI = path.join(ROOT, "tools", "mapflow.mjs");
const EVOLUTION_DEMO = path.join(ROOT, "tools", "evolution-demo.mjs");

function run(...args) {
  return runAt(ROOT, ...args);
}

function runAt(cwd, ...args) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
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

function writeRecordedMap(directory, blueprint) {
  fs.mkdirSync(path.join(directory, "briefs"), { recursive: true });
  const mapPath = path.join(directory, "blueprint.yaml");
  fs.writeFileSync(mapPath, `${JSON.stringify(blueprint, null, 2)}\n`, "utf8");
  for (const edge of blueprint.edges) {
    fs.writeFileSync(path.join(directory, edge.brief_ref), `---
edge: ${edge.id}
contract:
  scope:
    in: [fixture ${edge.id}]
    out: [unrelated work]
  authorization:
    required: [human approval]
    allowed_actions: [fixture execution]
  evidence:
    proves: [${edge.effects.join(", ")}]
    exit_conditions: [fixture result is readable]
  verification:
    commands:
      - id: fixture-pass
        program: node
        args: [-e, "process.stdout.write('fixture pass')"]
        cwd: workspace
        timeout_seconds: 30
        success_exit_codes: [0]
        proves: [${edge.effects.join(", ")}]
  failure:
    action: replan
    rollback: [retain evidence]
---

# ${edge.id}
`, "utf8");
  }
  return mapPath;
}

function authorizeRecordedEdge(statePath, edgeId) {
  const request = run(
    "--state", statePath, "request-authorization", "--edge", edgeId,
    "--question", `Authorize ${edgeId}?`, "--requester", "agent:test",
    "--decision-owner", "human:owner", "--json",
  );
  assertExit(request);
  assertExit(run(
    "--state", statePath, "authorize", "--request", JSON.parse(request.stdout).request_id,
    "--answer", "Authorized", "--actor", "human:owner",
  ));
}

function verifyRecordedEdge(statePath, edgeId, acceptance = "") {
  const capability = run(
    "--state", statePath, "issue-action", "--edge", edgeId,
    "--verifier", "fixture-pass", "--json",
  );
  assertExit(capability);
  const args = [
    "--state", statePath, "verify-executed", "--edge", edgeId,
    "--evidence", `${edgeId} fixture evidence`, "--verifier", "fixture-pass",
    "--capability", JSON.parse(capability.stdout).token, "--executor", "tool:test",
  ];
  if (acceptance) args.push("--acceptance", acceptance);
  return run(...args);
}

function recordedSubmapFixture({ nested = false } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-evolution-submap-"));
  const childDirectory = path.join(directory, "child");
  const parentDirectory = path.join(directory, "parent");
  fs.mkdirSync(childDirectory, { recursive: true });
  fs.mkdirSync(parentDirectory, { recursive: true });
  const childBlueprint = {
    schema_version: 2,
    map_id: "recorded-child",
    intent: { statement: "完成可回放的子工作", status: "shaped", open_questions: [] },
    destination: {
      statement: "子工作已验收",
      requires: ["child-ready"],
      invariants: [],
      acceptance: [{ id: "child-ready-accepted", proves: ["child-ready"], proof: "子工作出口可回读" }],
    },
    predicates: [
      { id: "child-request-known", fact: "child-request-known", equals: "true", kind: "state" },
      { id: "child-ready", fact: "child-ready", equals: "true", kind: "state" },
    ],
    initial_state: { facts: [
      { id: "child-request-known", value: "true", evidence: [{ kind: "note", ref: "fixture request" }] },
      { id: "child-ready", value: "false", evidence: [{ kind: "observation", ref: "not complete" }] },
    ] },
    assumptions: [], invariants: [],
    boundaries: { in_scope: ["子工作"], out_of_scope: ["外部发布"], authorization: ["逐边授权"] },
    nodes: [
      { id: "child-origin", kind: "state", label: "子工作需求已知", predicates: ["child-request-known"] },
      { id: "child-destination", kind: "destination", label: "子工作已验收", predicates: ["child-ready"] },
    ],
    edges: [{
      id: "complete-child", from: "child-origin", to: "child-destination", brief_ref: "briefs/complete-child.md",
      preconditions: ["child-request-known"], effects: ["child-ready"], invariants: [], certainty: "expected",
      evidence_contract: [{ id: "child-result", proves: ["child-ready"], required: true }], on_failure: { action: "replan" },
    }],
    loops: [], submaps: [],
  };
  let grandchildMap = null;
  let grandchildState = null;
  if (nested) {
    const grandchildDirectory = path.join(directory, "grandchild");
    fs.mkdirSync(grandchildDirectory, { recursive: true });
    const grandchildBlueprint = {
      schema_version: 2,
      map_id: "recorded-grandchild",
      intent: { statement: "完成可回放的孙级工作", status: "shaped", open_questions: [] },
      destination: {
        statement: "孙级工作已验收",
        requires: ["grandchild-ready"],
        invariants: [],
        acceptance: [{ id: "grandchild-ready-accepted", proves: ["grandchild-ready"], proof: "孙级工作出口可回读" }],
      },
      predicates: [
        { id: "grandchild-request-known", fact: "grandchild-request-known", equals: "true", kind: "state" },
        { id: "grandchild-ready", fact: "grandchild-ready", equals: "true", kind: "state" },
      ],
      initial_state: { facts: [
        { id: "grandchild-request-known", value: "true", evidence: [{ kind: "note", ref: "fixture request" }] },
        { id: "grandchild-ready", value: "false", evidence: [{ kind: "observation", ref: "not complete" }] },
      ] },
      assumptions: [], invariants: [],
      boundaries: { in_scope: ["孙级工作"], out_of_scope: ["外部发布"], authorization: ["逐边授权"] },
      nodes: [
        { id: "grandchild-origin", kind: "state", label: "孙级工作需求已知", predicates: ["grandchild-request-known"] },
        { id: "grandchild-destination", kind: "destination", label: "孙级工作已验收", predicates: ["grandchild-ready"] },
      ],
      edges: [{
        id: "complete-grandchild", from: "grandchild-origin", to: "grandchild-destination", brief_ref: "briefs/complete-grandchild.md",
        preconditions: ["grandchild-request-known"], effects: ["grandchild-ready"], invariants: [], certainty: "expected",
        evidence_contract: [{ id: "grandchild-result", proves: ["grandchild-ready"], required: true }], on_failure: { action: "replan" },
      }],
      loops: [], submaps: [],
    };
    grandchildMap = writeRecordedMap(grandchildDirectory, grandchildBlueprint);
    grandchildState = path.join(grandchildDirectory, "state.json");
    assertExit(run("--state", grandchildState, "init", "--map", grandchildMap));
    authorizeRecordedEdge(grandchildState, "complete-grandchild");
    assertExit(verifyRecordedEdge(grandchildState, "complete-grandchild", "grandchild-ready-accepted"));
    const grandchildAudit = run(
      "--state", grandchildState, "request-arrival-audit", "--question", "Audit grandchild arrival?",
      "--requester", "agent:test", "--decision-owner", "human:owner", "--json",
    );
    assertExit(grandchildAudit);
    assertExit(run(
      "--state", grandchildState, "arrive", "--request", JSON.parse(grandchildAudit.stdout).request_id,
      "--answer", "Grandchild arrival audited", "--actor", "human:owner",
      "--non-goals", "external release", "--risks", "fixture only",
    ));
    const grandchildLoaded = readBlueprint(grandchildMap);
    childBlueprint.edges[0].certainty = "conditional";
    childBlueprint.submaps = [{
      id: "delivery-proof", parent_edge: "complete-child", map_ref: "../grandchild/blueprint.yaml", state_ref: "../grandchild/state.json",
      expected_map_id: grandchildLoaded.blueprint.map_id, expected_map_digest: grandchildLoaded.digest,
      await: "arrival", on_parent_close: "preserve",
      exports: [{
        id: "grandchild-result-export", child_acceptance: "grandchild-ready-accepted",
        child_predicates: ["grandchild-ready"], proves_parent: ["child-ready"],
      }],
    }];
  }
  const childMap = writeRecordedMap(childDirectory, childBlueprint);
  const childState = path.join(childDirectory, "state.json");
  assertExit(run("--state", childState, "init", "--map", childMap));
  authorizeRecordedEdge(childState, "complete-child");
  if (nested) {
    assertExit(run("--state", childState, "verify-submap", "--edge", "complete-child", "--executor", "human:owner"));
  } else {
    assertExit(verifyRecordedEdge(childState, "complete-child", "child-ready-accepted"));
  }
  const audit = run(
    "--state", childState, "request-arrival-audit", "--question", "Audit child arrival?",
    "--requester", "agent:test", "--decision-owner", "human:owner", "--json",
  );
  assertExit(audit);
  assertExit(run(
    "--state", childState, "arrive", "--request", JSON.parse(audit.stdout).request_id,
    "--answer", "Child arrival audited", "--actor", "human:owner",
    "--non-goals", "external release", "--risks", "fixture only",
  ));
  const childLoaded = readBlueprint(childMap);

  const parentBlueprint = {
    schema_version: 2,
    map_id: "recorded-parent",
    intent: { statement: "通过子地图完成父工作", status: "shaped", open_questions: [] },
    destination: {
      statement: "父工作已接纳子地图回执",
      requires: ["parent-ready"],
      invariants: [],
      acceptance: [{ id: "parent-ready-accepted", proves: ["parent-ready"], proof: "Map Receipt 可回读" }],
    },
    predicates: [
      { id: "parent-request-known", fact: "parent-request-known", equals: "true", kind: "state" },
      { id: "parent-ready", fact: "parent-ready", equals: "true", kind: "state" },
    ],
    initial_state: { facts: [
      { id: "parent-request-known", value: "true", evidence: [{ kind: "note", ref: "fixture request" }] },
      { id: "parent-ready", value: "false", evidence: [{ kind: "observation", ref: "receipt missing" }] },
    ] },
    assumptions: [], invariants: [],
    boundaries: { in_scope: ["接纳子地图"], out_of_scope: ["重写 child"], authorization: ["逐边授权"] },
    nodes: [
      { id: "parent-origin", kind: "state", label: "父工作需求已知", predicates: ["parent-request-known"] },
      { id: "parent-destination", kind: "destination", label: "父工作已接纳回执", predicates: ["parent-ready"] },
    ],
    edges: [{
      id: "accept-child", from: "parent-origin", to: "parent-destination", brief_ref: "briefs/accept-child.md",
      preconditions: ["parent-request-known"], effects: ["parent-ready"], invariants: [], certainty: "conditional",
      evidence_contract: [{ id: "child-receipt", proves: ["parent-ready"], required: true }], on_failure: { action: "replan" },
    }],
    loops: [],
    submaps: [{
      id: "delivery-detail", parent_edge: "accept-child", map_ref: "../child/blueprint.yaml", state_ref: "../child/state.json",
      expected_map_id: childLoaded.blueprint.map_id, expected_map_digest: childLoaded.digest,
      await: "arrival", on_parent_close: "preserve",
      exports: [{
        id: "child-result-export", child_acceptance: "child-ready-accepted",
        child_predicates: ["child-ready"], proves_parent: ["parent-ready"],
      }],
    }],
  };
  const parentMap = writeRecordedMap(parentDirectory, parentBlueprint);
  const parentState = path.join(parentDirectory, "state.json");
  assertExit(run("--state", parentState, "init", "--map", parentMap));
  authorizeRecordedEdge(parentState, "accept-child");
  assertExit(run("--state", parentState, "verify-submap", "--edge", "accept-child", "--executor", "human:owner"));
  return { childMap, childState, parentMap, parentState, grandchildMap, grandchildState };
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
  const { root, enabled } = enabledWorkspace();
  fs.copyFileSync(path.join(ROOT, "templates", "blueprint.yaml"), enabled.paths.map);
  fs.cpSync(path.join(ROOT, "templates", "briefs"), enabled.paths.briefs, { recursive: true });
  const command = (...args) => runAt(root, "--state", enabled.paths.state, ...args);
  assertExit(command("init", "--map", enabled.paths.map));
  const registered = readBlueprint(enabled.paths.map);

  const edges = [
    ["settle-audience", "audience-record-check", "", [["notes/audience-decision.md", "audience known\n"]]],
    ["write-candidate", "candidate-review-check", "sensitive-review-recorded", [["drafts/article.md", "draft\n"], ["notes/sensitive-review.md", "reviewed\n"]]],
    ["obtain-owner-approval", "owner-approval-readback", "", [["notes/owner-approval.md", "approved\n"]]],
    ["publish-article", "publication-readback", "public-page-readable", [["receipts/publication.json", "{\"url\":\"https://example.invalid/article\"}\n"]]],
  ];
  for (const [edge, verifier, acceptance, artifacts] of edges) {
    const authorizationRequired = registered.briefs[edge].metadata.contract.authorization.required.length > 0;
    if (authorizationRequired) {
      const requested = command(
        "request-authorization", "--edge", edge, "--question", `是否满足 ${edge} 的声明授权？`,
        "--requester", "agent:codex", "--decision-owner", "human:owner", "--json",
      );
      assertExit(requested);
      assertExit(command(
        "authorize", "--request", JSON.parse(requested.stdout).request_id,
        "--answer", `确认 ${edge} 的声明授权`, "--actor", "human:owner",
      ));
    } else {
      assertExit(command("start", "--edge", edge, "--reason", "unprotected proven edge", "--actor", "agent:codex"));
    }
    assertExit(command("gate"));
    for (const [relative, content] of artifacts) {
      const artifact = path.join(root, relative);
      fs.mkdirSync(path.dirname(artifact), { recursive: true });
      fs.writeFileSync(artifact, content, "utf8");
    }
    const capability = command("issue-action", "--edge", edge, "--verifier", verifier, "--json");
    assertExit(capability);
    const verifyArgs = [
      "verify-executed", "--edge", edge,
      "--evidence", `${edge} evidence`, "--verifier", verifier,
      "--capability", JSON.parse(capability.stdout).token, "--executor", "agent:codex",
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

test("parent history pins an exact child frame and exposes the child independent evolution stream", async () => {
  const fixture = recordedSubmapFixture();
  const server = createBoardServer({ mapPath: fixture.parentMap, statePath: fixture.parentState });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const parentCatalog = await (await fetch(`${base}/api/evolution`)).json();
    const beforeReceipt = parentCatalog.frames.find((frame) => frame.type === "mapflow.edge.authorized.v1");
    const receiptFrame = parentCatalog.frames.find((frame) => frame.type === "mapflow.submap.receipt.accepted.v1");
    assert.ok(beforeReceipt);
    assert.ok(receiptFrame);

    const before = await (await fetch(`${base}/api/evolution/frames/${beforeReceipt.id}`)).json();
    assert.equal(before.board.submaps[0].receipt_status, "missing");
    assert.equal(before.board.submaps[0].phase, "unknown");
    assert.equal(before.board.submaps[0].historical_expandable, false);
    assert.equal(before.board.submaps[0].independent_history, true);

    const parent = await (await fetch(`${base}/api/evolution/frames/${receiptFrame.id}`)).json();
    const summary = parent.board.submaps[0];
    assert.equal(summary.receipt_status, "pinned");
    assert.equal(summary.phase, "arrived");
    assert.equal(summary.historical_expandable, true);
    assert.match(summary.historical_frame, /^runtime:\d+$/);
    assert.equal(parent.stream_heads.children["delivery-detail"].frame, summary.historical_frame);
    assert.equal(parent.stream_heads.children["delivery-detail"].basis.kind, "receipt-pin");

    const childCatalogResponse = await fetch(`${base}/api/submaps/delivery-detail/evolution`);
    assert.equal(childCatalogResponse.status, 200);
    const childCatalog = await childCatalogResponse.json();
    assert.equal(childCatalog.binding.path, "delivery-detail");
    assert.equal(childCatalog.binding.map_id, "recorded-child");
    assert.ok(childCatalog.frames.some((frame) => frame.id === summary.historical_frame));
    assert.equal((await fetch(`${base}/api/submaps/delivery-detail/evolution`, { headers: { "If-None-Match": childCatalogResponse.headers.get("etag") } })).status, 304);

    const childFrameResponse = await fetch(`${base}/api/submaps/delivery-detail/evolution/frames/${summary.historical_frame}`);
    assert.equal(childFrameResponse.status, 200);
    const childFrame = await childFrameResponse.json();
    assert.equal(childFrame.binding.path, "delivery-detail");
    assert.equal(childFrame.board.projection.binding_path, "delivery-detail");
    assert.equal(childFrame.board.map.actual_arrival, "audited");
    assert.equal((await fetch(`${base}/api/submaps/delivery-detail/evolution`, { method: "POST" })).status, 405);

    const currentChild = JSON.parse(fs.readFileSync(fixture.childState, "utf8"));
    currentChild.phase = "wayfinding";
    currentChild.runtime_status = "wayfinding";
    fs.writeFileSync(fixture.childState, `${JSON.stringify(currentChild, null, 2)}\n`, "utf8");
    const pinnedAgain = await (await fetch(`${base}/api/evolution/frames/${receiptFrame.id}`)).json();
    assert.equal(pinnedAgain.board.submaps[0].phase, "arrived");
    assert.equal(pinnedAgain.board.submaps[0].historical_frame, summary.historical_frame);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("nested submap history preserves receipt pins across the full binding path", async () => {
  const fixture = recordedSubmapFixture({ nested: true });
  const server = createBoardServer({ mapPath: fixture.parentMap, statePath: fixture.parentState });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const parentCatalog = await (await fetch(`${base}/api/evolution`)).json();
    const parentReceiptFrame = parentCatalog.frames.find((frame) => frame.type === "mapflow.submap.receipt.accepted.v1");
    assert.ok(parentReceiptFrame);
    const parent = await (await fetch(`${base}/api/evolution/frames/${parentReceiptFrame.id}`)).json();
    const childSummary = parent.board.submaps[0];
    assert.equal(childSummary.path, "delivery-detail");
    assert.equal(childSummary.receipt_status, "pinned");

    const childResponse = await fetch(`${base}/api/submaps/delivery-detail/evolution/frames/${childSummary.historical_frame}`);
    assert.equal(childResponse.status, 200);
    const child = await childResponse.json();
    const grandchildSummary = child.board.submaps[0];
    assert.equal(grandchildSummary.path, "delivery-detail/delivery-proof");
    assert.equal(grandchildSummary.receipt_status, "pinned");
    assert.equal(grandchildSummary.phase, "arrived");
    assert.equal(grandchildSummary.historical_expandable, true);
    assert.match(grandchildSummary.historical_frame, /^runtime:\d+$/);
    assert.equal(child.stream_heads.children["delivery-proof"].frame, grandchildSummary.historical_frame);
    assert.equal(child.stream_heads.children["delivery-proof"].basis.kind, "receipt-pin");

    const grandchildCatalog = await fetch(`${base}/api/submaps/delivery-detail/delivery-proof/evolution`);
    assert.equal(grandchildCatalog.status, 200);
    const grandchildFrame = await fetch(
      `${base}/api/submaps/delivery-detail/delivery-proof/evolution/frames/${grandchildSummary.historical_frame}`,
    );
    assert.equal(grandchildFrame.status, 200);
    const grandchild = await grandchildFrame.json();
    assert.equal(grandchild.binding.path, "delivery-detail/delivery-proof");
    assert.equal(grandchild.board.projection.binding_path, "delivery-detail/delivery-proof");
    assert.equal(grandchild.board.map.actual_arrival, "audited");

    const currentGrandchild = JSON.parse(fs.readFileSync(fixture.grandchildState, "utf8"));
    currentGrandchild.phase = "wayfinding";
    currentGrandchild.runtime_status = "wayfinding";
    fs.writeFileSync(fixture.grandchildState, `${JSON.stringify(currentGrandchild, null, 2)}\n`, "utf8");
    const childAgain = await (await fetch(
      `${base}/api/submaps/delivery-detail/evolution/frames/${childSummary.historical_frame}`,
    )).json();
    assert.equal(childAgain.board.submaps[0].phase, "arrived");
    assert.equal(childAgain.board.submaps[0].historical_frame, grandchildSummary.historical_frame);
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
    assert.match(page, /id="evolution-parent"/);
    assert.match(page, /id="evolution-breadcrumb"/);
    const app = await (await fetch(`${base}/app.js`)).text();
    assert.match(app, /\/api\/evolution/);
    assert.match(app, /enterSubmapHistory/);
    assert.match(app, /receipt.*fixed|回执固定/i);
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
  assert.equal(finalDraft.nodes.filter((node) => node.status === "confirmed").length, 5);
  assert.equal(finalDraft.edges.filter((edge) => edge.status === "confirmed").length, 8);
  assert.equal(finalDraft.questions.some((question) => (question.status ?? "pending") === "pending"), false);
  const runtimeEvents = fs.readFileSync(output.runtime_events, "utf8").trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(runtimeEvents[0].data.details.source_wayfinding.head_digest, wayfinding.head_digest);
  const reader = createBoardSnapshotReader({ statePath: output.state });
  const confirmedJourney = runtimeEvents.find((event) => event.data.details?.edge === "confirm-core-journey" && event.type === "mapflow.edge.verified.v1");
  const reviewDesign = runtimeEvents.find((event) => event.data.details?.edge === "review-engineering-design" && event.type === "mapflow.edge.verified.v1");
  const firstBranch = runtimeEvents.find((event) => event.data.details?.edge === "build-catalog-slice" && event.type === "mapflow.edge.verified.v1");
  const secondBranch = runtimeEvents.find((event) => event.data.details?.edge === "build-circulation-slice" && event.type === "mapflow.edge.verified.v1");
  assert.ok(confirmedJourney && reviewDesign && firstBranch && secondBranch);
  const afterJourney = reader.readEvolutionFrame(`runtime:${confirmedJourney.seq}`).model.board;
  assert.deepEqual(afterJourney.summary.ready_edges, ["design-domain-model", "design-api-contract"]);
  assert.equal(afterJourney.nodes.find((node) => node.id === "engineering-design-ready").satisfied, false);
  const splitFrame = reader.readEvolutionFrame(`runtime:${reviewDesign.seq}`).model.board;
  assert.deepEqual(splitFrame.summary.ready_edges, ["build-catalog-slice", "build-circulation-slice"]);
  assert.equal(splitFrame.summary.parallel_ready_edges, 2);
  assert.equal(splitFrame.nodes.find((node) => node.id === "engineering-design-ready").satisfied, true);
  assert.equal(splitFrame.nodes.find((node) => node.id === "engineering-design-reviewed").satisfied, true);
  assert.equal(splitFrame.nodes.find((node) => node.id === "independent-slices-ready").satisfied, false);
  const oneBranchFrame = reader.readEvolutionFrame(`runtime:${firstBranch.seq}`).model.board;
  assert.deepEqual(oneBranchFrame.summary.ready_edges, ["build-circulation-slice"]);
  assert.equal(oneBranchFrame.nodes.find((node) => node.id === "independent-slices-ready").satisfied, false);
  const joinedFrame = reader.readEvolutionFrame(`runtime:${secondBranch.seq}`).model.board;
  assert.equal(joinedFrame.nodes.find((node) => node.id === "independent-slices-ready").satisfied, true);
  assert.deepEqual(joinedFrame.summary.ready_edges, ["integrate-library-slices"]);
  assert.equal(runtimeEvents.at(-1).type, "mapflow.arrival.audited.v1");
  assert.equal(runtimeEvents.at(-1).data.projection.phase, "arrived");
});
