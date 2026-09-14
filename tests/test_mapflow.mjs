import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { initialFacts, proveBlueprint, readBlueprint } from "../tools/mapflow-core.mjs";
import { createBoardSnapshotReader } from "../tools/mapflow-board-core.mjs";
import { createBoardServer } from "../tools/mapflow-board.mjs";
import { readWayfinding, validateWayfinding } from "../tools/mapflow-wayfinding.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const CLI = path.join(ROOT, "tools", "mapflow.mjs");
const INSTALLER = path.join(ROOT, "tools", "install.mjs");
const TEMPLATE_MAP = path.join(ROOT, "templates", "blueprint.yaml");

function runCli(state, ...args) {
  return spawnSync(process.execPath, [CLI, "--state", state, ...args], {
    cwd: ROOT,
    encoding: "utf8",
  });
}

function requestAuthorization(state, edge, question = `May I execute ${edge}?`) {
  return runCli(
    state,
    "request-authorization", "--edge", edge,
    "--question", question,
    "--requester", "agent:codex",
    "--decision-owner", "human:owner",
    "--json",
  );
}

function requestArrivalAudit(state, question = "Have the destination contract, acceptance evidence, non-goals, and residual risks been independently audited?") {
  return runCli(
    state,
    "request-arrival-audit", "--question", question,
    "--requester", "agent:codex",
    "--decision-owner", "human:owner",
    "--json",
  );
}

function authorizeEdge(state, edge, answer = `Approved to execute ${edge}`) {
  const started = runCli(
    state,
    "start", "--edge", edge,
    "--reason", answer,
    "--actor", "agent:test",
  );
  if (started.status === 0) return started;
  if (!/declares an authorization requirement/.test(started.stderr)) return started;
  const requested = requestAuthorization(state, edge);
  assertExit(requested);
  const requestId = JSON.parse(requested.stdout).request_id;
  return runCli(
    state,
    "authorize", "--request", requestId,
    "--answer", answer,
    "--actor", "human:owner",
  );
}

function approveAndAuthorize(state, edge, reason = "The complete route is accepted") {
  return authorizeEdge(state, edge, reason);
}

function runInstaller(target, ...args) {
  return spawnSync(process.execPath, [INSTALLER, "--target", target, ...args], {
    cwd: ROOT,
    encoding: "utf8",
  });
}

function runGlobalInstaller(userProfile, ...args) {
  return spawnSync(process.execPath, [INSTALLER, "--global", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, USERPROFILE: userProfile },
  });
}

function assertExit(result, expected = 0) {
  assert.equal(result.status, expected, result.stderr || result.stdout);
}

function makeMap(directory, mutate = () => {}) {
  const blueprint = structuredClone(readBlueprint(TEMPLATE_MAP).blueprint);
  mutate(blueprint);
  for (const edge of blueprint.edges) {
    const source = blueprint.nodes.find((node) => node.id === edge.from);
    const invariantIds = new Set(edge.invariants);
    for (const invariantId of blueprint.destination.invariants) {
      const invariant = blueprint.invariants.find((item) => item.id === invariantId);
      if (invariant?.applies_to.includes(edge.id)) invariantIds.add(invariantId);
    }
    const premises = [...new Set([
      ...(source?.predicates ?? []),
      ...edge.preconditions,
      ...[...invariantIds].flatMap((invariantId) => blueprint.invariants.find((item) => item.id === invariantId)?.requires ?? []),
    ])];
    edge.causal_contract = {
      rule_id: `${edge.id}-rule`,
      premises,
      conclusions: [...edge.effects],
      proof_mode: "executed-verifier",
      rule_basis: { kind: "verifier", ref: "fixture-pass" },
      required_witnesses: edge.evidence_contract.filter((contract) => contract.required).map((contract) => contract.id),
      non_interference: [],
    };
  }
  const mapPath = path.join(directory, "blueprint.yaml");
  fs.writeFileSync(mapPath, `${JSON.stringify(blueprint, null, 2)}\n`, "utf8");
  for (const edge of blueprint.edges) {
    const briefPath = path.resolve(directory, edge.brief_ref);
    fs.mkdirSync(path.dirname(briefPath), { recursive: true });
    if (!fs.existsSync(briefPath)) fs.writeFileSync(
      briefPath,
      `---\nedge: ${edge.id}\ncontract:\n  scope:\n    in: [test fixture for ${edge.id}]\n    out: [all unrelated work]\n  authorization:\n    required: []\n    allowed_actions: [local test fixture]\n  evidence:\n    proves: [${edge.effects.join(", ")}]\n    exit_conditions: [fixture effects are observable]\n  verification:\n    commands:\n      - id: fixture-pass\n        program: node\n        args: [-e, "process.stdout.write('fixture pass')"]\n        cwd: workspace\n        timeout_seconds: 30\n        success_exit_codes: [0]\n        proves: [${edge.effects.join(", ")}]\n      - id: fixture-fail\n        program: node\n        args: [-e, "process.stderr.write('fixture fail'); process.exit(1)"]\n        cwd: workspace\n        timeout_seconds: 30\n        success_exit_codes: [0]\n        proves: [${edge.effects.join(", ")}]\n  failure:\n    action: ${edge.on_failure.action}\n    rollback: [discard temporary fixture]\n---\n\n# ${edge.id}\n`,
      "utf8",
    );
  }
  return mapPath;
}

function verify(state, edge, proves, acceptance = "", outcomeRef = "") {
  const issued = runCli(state, "issue-action", "--edge", edge, "--verifier", "fixture-pass", "--json");
  assertExit(issued);
  const args = [
    "verify-executed", "--edge", edge,
    "--evidence", `${edge} evidence`,
    "--verifier", "fixture-pass",
    "--capability", JSON.parse(issued.stdout).token,
    "--executor", "agent:codex",
    "--model", "gpt-5.6-sol",
    "--reasoning", "high",
  ];
  if (acceptance) args.push("--acceptance", acceptance);
  if (outcomeRef) args.push("--outcome-ref", outcomeRef);
  return runCli(state, ...args);
}

function verifyFailure(state, edge, claim = `${edge} failed`) {
  const issued = runCli(state, "issue-action", "--edge", edge, "--verifier", "fixture-fail", "--json");
  assertExit(issued);
  return runCli(
    state, "verify-executed", "--edge", edge,
    "--evidence", claim, "--verifier", "fixture-fail",
    "--capability", JSON.parse(issued.stdout).token,
    "--executor", "tool:test",
  );
}

function makeSubmapFixture({ childArrived = true } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-v04-submap-"));
  const childDirectory = path.join(directory, "child");
  fs.mkdirSync(childDirectory, { recursive: true });
  fs.cpSync(path.join(ROOT, "templates"), childDirectory, { recursive: true });
  const childMap = path.join(childDirectory, "blueprint.yaml");
  const childLoaded = readBlueprint(childMap);
  const childStatePath = path.join(childDirectory, "state.json");
  const childFacts = initialFacts(childLoaded.blueprint);
  for (const predicateId of ["article-published", "public-url-exists", "sensitive-content-checked", "owner-approved"]) {
    const predicate = childLoaded.blueprint.predicates.find((item) => item.id === predicateId);
    childFacts[predicate.fact] = { value: predicate.equals, evidence: [{ kind: "receipt", ref: `fixture-${predicateId}`, strength: "corroborated" }] };
  }
  const evidence = childLoaded.blueprint.destination.acceptance.map((acceptance, index) => ({
    id: `child-evidence-${index + 1}`,
    edge: index === 0 ? "publish-article" : "write-candidate",
    claim: `fixture ${acceptance.id}`,
    proves: [...acceptance.proves],
    acceptance_ids: [acceptance.id],
    outcome_refs: [{ kind: "receipt", ref: `fixture-${acceptance.id}` }],
    checks: [{ command: "fixture readback", result: "pass", observed: "present", mode: "readback" }],
    limits: { simulated: [], inferred: [], unverified: [], product_unknowns: [] },
    executor: "human:owner",
    recorded_at: "2026-09-03T00:00:00Z",
  }));
  const childState = {
    schema: 2,
    phase: childArrived ? "arrived" : "implementation",
    destination_status: "approved",
    map: "blueprint.yaml",
    map_digest: childLoaded.digest,
    map_id: childLoaded.blueprint.map_id,
    active_edge: null,
    active_run: null,
    runtime_status: childArrived ? "arrived" : "idle",
    edge_runs: [], decisions: [], work_events: [], proposals: [], map_receipts: [], receipt_invalidations: [], event_stream: null,
    verified_edges: ["write-candidate", "obtain-owner-approval", "publish-article"],
    verified_edge_contracts: {},
    blueprint_snapshot: structuredClone(childLoaded.blueprint),
    brief_digests: childLoaded.brief_digests,
    loop_iterations: {},
    facts: childFacts,
    satisfied_nodes: [],
    last_proof: proveBlueprint(childLoaded.blueprint, childFacts),
    evidence,
    updated_at: "2026-09-03T00:00:00Z",
    history: [],
    ...(childArrived ? { arrival_audit: { acceptance: childLoaded.blueprint.destination.acceptance.map((item) => item.id), risks: [], confirm: "fixture audit", recorded_at: "2026-09-03T00:00:00Z", run_id: "publish-article-arrival-1" } } : {}),
  };
  fs.writeFileSync(childStatePath, `${JSON.stringify(childState, null, 2)}\n`, "utf8");

  const parentDirectory = path.join(directory, "parent");
  fs.mkdirSync(path.join(parentDirectory, "briefs"), { recursive: true });
  const parentBlueprint = {
    schema_version: 2,
    map_id: "deliver-campaign",
    intent: { statement: "准备一项可交付活动", status: "shaped", open_questions: [] },
    destination: { statement: "活动准备已经验收", requires: ["campaign-ready"], invariants: [], acceptance: [{ id: "campaign-readiness-audited", proves: ["campaign-ready"], proof: "子地图到达回执存在" }] },
    predicates: [
      { id: "request-known", fact: "request-known", equals: "true", kind: "state" },
      { id: "campaign-ready", fact: "campaign-ready", equals: "true", kind: "state" },
    ],
    initial_state: { facts: [
      { id: "request-known", value: "true", evidence: [{ kind: "document", ref: "request.md" }] },
      { id: "campaign-ready", value: "false", evidence: [{ kind: "observation", ref: "not prepared" }] },
    ] },
    assumptions: [], invariants: [],
    boundaries: { in_scope: ["准备活动"], out_of_scope: ["实际举办"], authorization: ["只接受已审计子地图"] },
    nodes: [
      { id: "request-ready", kind: "state", label: "需求已明确", predicates: ["request-known"] },
      { id: "campaign-delivered", kind: "destination", label: "活动准备已交付", predicates: ["campaign-ready"] },
    ],
    edges: [{
      id: "prepare-campaign", from: "request-ready", to: "campaign-delivered", brief_ref: "briefs/prepare-campaign.md",
      preconditions: ["request-known"], effects: ["campaign-ready"], invariants: [], certainty: "conditional",
      evidence_contract: [{ id: "child-arrival-receipt", proves: ["campaign-ready"], required: true }], on_failure: { action: "replan" },
    }],
    loops: [],
    submaps: [{
      id: "campaign-preparation", parent_edge: "prepare-campaign", map_ref: "../child/blueprint.yaml", state_ref: "../child/state.json",
      expected_map_id: childLoaded.blueprint.map_id, expected_map_digest: childLoaded.digest, await: "arrival", on_parent_close: "preserve",
      exports: [{ id: "published-article-export", child_acceptance: "public-page-readable", child_predicates: ["article-published", "public-url-exists"], proves_parent: ["campaign-ready"] }],
    }],
  };
  const parentMap = path.join(parentDirectory, "blueprint.yaml");
  fs.writeFileSync(parentMap, `${JSON.stringify(parentBlueprint, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(parentDirectory, "briefs", "prepare-campaign.md"), `---\ntitle: 准备活动\nedge: prepare-campaign\ncontract:\n  scope:\n    in: [通过子地图准备活动]\n    out: [实际举办活动]\n  authorization:\n    required: []\n    allowed_actions: [读取子地图回执]\n  evidence:\n    proves: [campaign-ready]\n    exit_conditions: [子地图到达回执通过]\n  failure:\n    action: replan\n    rollback: [保留子地图证据]\n---\n\n# 准备活动\n`, "utf8");
  return { directory, parentMap, parentState: path.join(parentDirectory, "state.json"), childMap, childStatePath, childState };
}

test("template blueprint is structurally complete and conditionally reachable", () => {
  const { blueprint } = readBlueprint(TEMPLATE_MAP);
  const proof = proveBlueprint(blueprint);
  assert.equal(proof.structural, "complete");
  assert.equal(proof.reachability, "conditional");
  assert.deepEqual(proof.proof_gaps, []);
  assert.ok(proof.reachable_nodes.includes("material-present-audience-unknown"));
  assert.ok(proof.reachable_nodes.includes("article-live"));
  assert.deepEqual(new Set(proof.proven_edges), new Set(["settle-audience", "write-candidate", "obtain-owner-approval", "publish-article"]));
});

test("a proven ready edge without an authorization requirement starts directly", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-direct-start-"));
  const mapPath = makeMap(directory);
  const state = path.join(directory, "state.json");
  assertExit(runCli(state, "init", "--map", mapPath));

  const next = runCli(state, "next-actions", "--json");
  assertExit(next);
  const nextResult = JSON.parse(next.stdout);
  assert.ok(nextResult.actions.some((action) => action.id === "start" && action.edge === "settle-audience"));
  assert.equal(nextResult.actions.some((action) => action.id === "request-route-approval"), false);

  assertExit(runCli(state, "start", "--edge", "settle-audience", "--actor", "agent:test"));
  const status = runCli(state, "status", "--json");
  assertExit(status);
  const runtime = JSON.parse(status.stdout);
  assert.equal(runtime.phase, "implementation");
  assert.equal(runtime.destination_status, "confirmed");
  assert.equal(runtime.active_edge, "settle-audience");
  assert.equal(runtime.edge_runs.at(-1).authorization_request, null);
});

test("independent branches collectively establish an AND Join and remain separately runnable", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-parallel-join-"));
  const mapPath = makeMap(directory, (blueprint) => {
    blueprint.map_id = "parallel-library-slices";
    blueprint.intent = { statement: "独立构建目录和借还切片", status: "shaped", open_questions: [] };
    blueprint.destination = {
      statement: "两个独立切片汇合后完成集成验收",
      requires: ["catalog-ready", "circulation-ready", "integration-verified"],
      invariants: [],
      acceptance: [{
        id: "parallel-slices-accepted",
        proves: ["catalog-ready", "circulation-ready", "integration-verified"],
        proof: "两条独立分支和汇合后的集成检查均可回读",
      }],
    };
    blueprint.predicates = [
      { id: "journey-confirmed", fact: "journey-confirmed", equals: "true", kind: "state" },
      { id: "catalog-ready", fact: "catalog-ready", equals: "true", kind: "state" },
      { id: "circulation-ready", fact: "circulation-ready", equals: "true", kind: "state" },
      { id: "integration-verified", fact: "integration-verified", equals: "true", kind: "state" },
    ];
    blueprint.initial_state = { facts: [
      { id: "journey-confirmed", value: "true", evidence: [{ kind: "note", ref: "owner-confirmed" }] },
      { id: "catalog-ready", value: "false", evidence: [{ kind: "observation", ref: "not built" }] },
      { id: "circulation-ready", value: "false", evidence: [{ kind: "observation", ref: "not built" }] },
      { id: "integration-verified", value: "false", evidence: [{ kind: "observation", ref: "not checked" }] },
    ] };
    blueprint.assumptions = [];
    blueprint.invariants = [];
    blueprint.boundaries = {
      in_scope: ["目录切片", "借还切片", "汇合集成"],
      out_of_scope: ["外部发布"],
      authorization: ["每条边独立授权"],
    };
    blueprint.nodes = [
      { id: "journey-ready", kind: "state", label: "核心旅程已确认", predicates: ["journey-confirmed"] },
      { id: "independent-slices-ready", kind: "join", label: "两个独立切片均就绪", predicates: ["catalog-ready", "circulation-ready"] },
      { id: "library-integrated", kind: "destination", label: "图书系统已集成验收", predicates: ["catalog-ready", "circulation-ready", "integration-verified"] },
    ];
    blueprint.edges = [
      {
        id: "build-catalog-slice", from: "journey-ready", to: "independent-slices-ready", brief_ref: "briefs/build-catalog-slice.md",
        preconditions: ["journey-confirmed"], effects: ["catalog-ready"], invariants: [], certainty: "expected",
        evidence_contract: [{ id: "catalog-check", proves: ["catalog-ready"], required: true }], on_failure: { action: "replan" },
      },
      {
        id: "build-circulation-slice", from: "journey-ready", to: "independent-slices-ready", brief_ref: "briefs/build-circulation-slice.md",
        preconditions: ["journey-confirmed"], effects: ["circulation-ready"], invariants: [], certainty: "expected",
        evidence_contract: [{ id: "circulation-check", proves: ["circulation-ready"], required: true }], on_failure: { action: "replan" },
      },
      {
        id: "integrate-library-slices", from: "independent-slices-ready", to: "library-integrated", brief_ref: "briefs/integrate-library-slices.md",
        preconditions: ["catalog-ready", "circulation-ready"], effects: ["integration-verified"], invariants: [], certainty: "expected",
        evidence_contract: [{ id: "integration-check", proves: ["integration-verified"], required: true }], on_failure: { action: "replan" },
      },
    ];
    blueprint.loops = [];
    blueprint.submaps = [];
    blueprint.extensions = { "x-purpose": "parallel-join-test" };
  });
  const loaded = readBlueprint(mapPath);
  const proof = proveBlueprint(loaded.blueprint);
  assert.equal(proof.structural, "complete");
  assert.equal(proof.reachability, "logical");
  assert.deepEqual(new Set(proof.proven_edges), new Set([
    "build-catalog-slice", "build-circulation-slice", "integrate-library-slices",
  ]));

  const state = path.join(directory, "state.json");
  assertExit(runCli(state, "init", "--map", mapPath));
  let model = createBoardSnapshotReader({ mapPath, statePath: state })().model;
  assert.deepEqual(model.summary.ready_edges, ["build-catalog-slice", "build-circulation-slice"]);
  assert.equal(model.summary.parallel_ready_edges, 2);
  assert.equal(model.nodes.find((node) => node.id === "independent-slices-ready").satisfied, false);
  const next = runCli(state, "next-actions", "--json");
  assertExit(next);
  assert.deepEqual(
    JSON.parse(next.stdout).actions.map((action) => action.edge),
    ["build-catalog-slice", "build-circulation-slice"],
  );

  assertExit(authorizeEdge(state, "build-catalog-slice"));
  assertExit(verify(state, "build-catalog-slice", "catalog-ready"));
  model = createBoardSnapshotReader({ mapPath, statePath: state })().model;
  assert.equal(model.edges.find((edge) => edge.id === "build-circulation-slice").status, "ready");
  assert.equal(model.nodes.find((node) => node.id === "independent-slices-ready").satisfied, false);

  assertExit(authorizeEdge(state, "build-circulation-slice"));
  assertExit(verify(state, "build-circulation-slice", "circulation-ready"));
  model = createBoardSnapshotReader({ mapPath, statePath: state })().model;
  assert.equal(model.nodes.find((node) => node.id === "independent-slices-ready").satisfied, true);
  assert.deepEqual(model.summary.ready_edges, ["integrate-library-slices"]);
});

test("pre-code design subgraph must converge before implementation branches become ready", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-design-network-"));
  const mapPath = makeMap(directory, (blueprint) => {
    blueprint.map_id = "design-gated-library";
    blueprint.intent = { statement: "先形成工程设计，再实现图书系统", status: "shaped", open_questions: [] };
    blueprint.destination = {
      statement: "设计已冻结且两个切片完成集成",
      requires: ["design-reviewed", "catalog-ready", "circulation-ready", "integration-verified"],
      invariants: [],
      acceptance: [{ id: "design-gated-accepted", proves: ["design-reviewed", "catalog-ready", "circulation-ready", "integration-verified"], proof: "设计文档、独立切片和集成检查均有证据" }],
    };
    blueprint.predicates = [
      { id: "journey-known", fact: "journey-known", equals: "true", kind: "state" },
      { id: "domain-model-ready", fact: "domain-model-ready", equals: "true", kind: "state" },
      { id: "api-contract-ready", fact: "api-contract-ready", equals: "true", kind: "state" },
      { id: "design-reviewed", fact: "design-reviewed", equals: "true", kind: "state" },
      { id: "catalog-ready", fact: "catalog-ready", equals: "true", kind: "state" },
      { id: "circulation-ready", fact: "circulation-ready", equals: "true", kind: "state" },
      { id: "integration-verified", fact: "integration-verified", equals: "true", kind: "state" },
    ];
    blueprint.initial_state = { facts: [
      { id: "journey-known", value: "true", evidence: [{ kind: "note", ref: "owner-journey" }] },
      { id: "domain-model-ready", value: "false", evidence: [{ kind: "observation", ref: "domain design missing" }] },
      { id: "api-contract-ready", value: "false", evidence: [{ kind: "observation", ref: "API design missing" }] },
      { id: "design-reviewed", value: "false", evidence: [{ kind: "observation", ref: "review missing" }] },
      { id: "catalog-ready", value: "false", evidence: [{ kind: "observation", ref: "catalog missing" }] },
      { id: "circulation-ready", value: "false", evidence: [{ kind: "observation", ref: "circulation missing" }] },
      { id: "integration-verified", value: "false", evidence: [{ kind: "observation", ref: "integration missing" }] },
    ] };
    blueprint.assumptions = [];
    blueprint.invariants = [];
    blueprint.boundaries = { in_scope: ["design", "catalog", "circulation", "integration"], out_of_scope: ["deployment"], authorization: ["each edge requires approval"] };
    blueprint.nodes = [
      { id: "journey-ready", kind: "state", label: "核心旅程已确认", predicates: ["journey-known"] },
      { id: "design-docs-ready", kind: "join", label: "两份工程设计文档均已形成", predicates: ["domain-model-ready", "api-contract-ready"] },
      { id: "design-reviewed", kind: "state", label: "设计已评审并冻结", predicates: ["domain-model-ready", "api-contract-ready", "design-reviewed"] },
      { id: "slices-ready", kind: "join", label: "两个实现切片均就绪", predicates: ["design-reviewed", "catalog-ready", "circulation-ready"] },
      { id: "library-destination", kind: "destination", label: "图书系统已集成", predicates: ["design-reviewed", "catalog-ready", "circulation-ready", "integration-verified"] },
    ];
    const edgeSpec = (id, from, to, preconditions, effects) => ({
      id, from, to, brief_ref: `briefs/${id}.md`, preconditions, effects, invariants: [], certainty: "expected",
      evidence_contract: [{ id: `${id}-evidence`, proves: effects, required: true }], on_failure: { action: "replan" },
    });
    blueprint.edges = [
      edgeSpec("design-domain", "journey-ready", "design-docs-ready", ["journey-known"], ["domain-model-ready"]),
      edgeSpec("design-api", "journey-ready", "design-docs-ready", ["journey-known"], ["api-contract-ready"]),
      edgeSpec("review-design", "design-docs-ready", "design-reviewed", ["domain-model-ready", "api-contract-ready"], ["design-reviewed"]),
      edgeSpec("build-catalog", "design-reviewed", "slices-ready", ["design-reviewed"], ["catalog-ready"]),
      edgeSpec("build-circulation", "design-reviewed", "slices-ready", ["design-reviewed"], ["circulation-ready"]),
      edgeSpec("integrate-library", "slices-ready", "library-destination", ["catalog-ready", "circulation-ready"], ["integration-verified"]),
    ];
    blueprint.loops = [];
    blueprint.submaps = [];
    blueprint.extensions = { "x-purpose": "design-network-gate" };
  });
  const loaded = readBlueprint(mapPath);
  const proof = proveBlueprint(loaded.blueprint);
  assert.equal(proof.structural, "complete");
  assert.equal(proof.reachability, "logical");
  assert.deepEqual(new Set(proof.proven_edges), new Set(loaded.blueprint.edges.map((edge) => edge.id)));

  const state = path.join(directory, "state.json");
  assertExit(runCli(state, "init", "--map", mapPath));
  let model = createBoardSnapshotReader({ mapPath, statePath: state })().model;
  assert.deepEqual(model.summary.ready_edges, ["design-domain", "design-api"]);
  assert.equal(model.edges.find((edge) => edge.id === "build-catalog").status, "blocked");
  assert.equal(model.edges.find((edge) => edge.id === "build-circulation").status, "blocked");

  assertExit(authorizeEdge(state, "design-domain"));
  assertExit(verify(state, "design-domain", "domain-model-ready"));
  model = createBoardSnapshotReader({ mapPath, statePath: state })().model;
  assert.deepEqual(model.summary.ready_edges, ["design-api"]);
  assert.equal(model.edges.find((edge) => edge.id === "review-design").status, "blocked");

  assertExit(authorizeEdge(state, "design-api"));
  assertExit(verify(state, "design-api", "api-contract-ready"));
  model = createBoardSnapshotReader({ mapPath, statePath: state })().model;
  assert.deepEqual(model.summary.ready_edges, ["review-design"]);
  assert.equal(model.nodes.find((node) => node.id === "design-docs-ready").satisfied, true);

  assertExit(authorizeEdge(state, "review-design"));
  assertExit(verify(state, "review-design", "design-reviewed"));
  model = createBoardSnapshotReader({ mapPath, statePath: state })().model;
  assert.deepEqual(model.summary.ready_edges, ["build-catalog", "build-circulation"]);
  assert.equal(model.nodes.find((node) => node.id === "design-reviewed").satisfied, true);
});

test("an unreachable OR alternative does not invalidate a reachable route", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-v03-or-"));
  const mapPath = makeMap(directory, (blueprint) => {
    blueprint.predicates.push({ id: "partner-api-ready", fact: "partner-api-ready", equals: "true", kind: "resource" });
    blueprint.initial_state.facts.push({ id: "partner-api-ready", value: "false", evidence: [{ kind: "observation", ref: "partner not configured" }] });
    blueprint.edges.push({
      id: "publish-through-partner",
      from: "candidate-approved",
      to: "article-live",
      brief_ref: "briefs/publish-through-partner.md",
      preconditions: ["partner-api-ready"],
      effects: ["article-published", "public-url-exists"],
      invariants: ["approval-before-publish"],
      certainty: "expected",
      evidence_contract: [{ id: "partner-publication-readback", proves: ["article-published", "public-url-exists"], required: true }],
      on_failure: { action: "replan" },
    });
    blueprint.invariants[0].applies_to.push("publish-through-partner");
  });
  const proof = proveBlueprint(readBlueprint(mapPath).blueprint);
  assert.equal(proof.structural, "complete");
  assert.equal(proof.reachability, "conditional");
  assert.ok(proof.candidate_edges.includes("publish-through-partner"));
  assert.deepEqual(proof.proof_gaps, []);
});

test("a ready dead-end edge cannot request authorization when it is not on a destination-reaching route", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-v03-dead-route-"));
  const mapPath = makeMap(directory, (blueprint) => {
    blueprint.predicates.push(
      { id: "safety-preserved", fact: "safety", equals: "true", kind: "state" },
      { id: "safety-broken", fact: "safety", equals: "false", kind: "state" },
    );
    blueprint.initial_state.facts.push({
      id: "safety",
      value: "true",
      evidence: [{ kind: "observation", ref: "safety starts preserved" }],
    });
    blueprint.destination.requires.push("safety-preserved");
    blueprint.destination.acceptance.push({
      id: "safety-remains-preserved",
      proves: ["safety-preserved"],
      proof: "safety is still preserved at arrival",
    });
    blueprint.nodes.find((node) => node.id === "article-live").predicates.push("safety-preserved");
    blueprint.edges.find((edge) => edge.id === "publish-article").preconditions.push("safety-preserved");
    blueprint.nodes.push({
      id: "dead-end",
      kind: "state",
      label: "目标效果出现但安全已破坏",
      predicates: ["article-published", "public-url-exists", "sensitive-content-checked", "safety-broken"],
    });
    blueprint.edges.push({
      id: "take-dead-route",
      from: "material-present-audience-unknown",
      to: "dead-end",
      brief_ref: "briefs/take-dead-route.md",
      preconditions: ["source-exists", "audience-unknown", "safety-preserved"],
      effects: ["article-published", "public-url-exists", "sensitive-content-checked", "safety-broken"],
      invariants: [],
      certainty: "expected",
      evidence_contract: [{
        id: "dead-route-observation",
        proves: ["article-published", "public-url-exists", "sensitive-content-checked", "safety-broken"],
        required: true,
      }],
      on_failure: { action: "stop" },
    });
  });
  const proof = proveBlueprint(readBlueprint(mapPath).blueprint);
  assert.equal(proof.reachability, "conditional");
  assert.ok(proof.candidate_edges.includes("take-dead-route"));
  assert.equal(proof.proven_edges.includes("take-dead-route"), false);

  const state = path.join(directory, "state.json");
  assertExit(runCli(state, "init", "--map", mapPath));
  const result = requestAuthorization(state, "take-dead-route");
  assertExit(result, 1);
  assert.match(result.stderr, /not on a destination-reaching route/);
});

test("forward proof keeps one value per fact instead of merging incompatible worlds", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-v03-worlds-"));
  const mapPath = makeMap(directory, (blueprint) => {
    blueprint.predicates.push(
      { id: "switch-off", fact: "switch", equals: "false", kind: "state" },
      { id: "switch-on", fact: "switch", equals: "true", kind: "state" },
      { id: "token-present", fact: "token", equals: "true", kind: "resource" },
      { id: "token-spent", fact: "token", equals: "false", kind: "resource" },
      { id: "witness-present", fact: "witness", equals: "true", kind: "state" },
    );
    blueprint.initial_state.facts.push(
      { id: "switch", value: "false", evidence: [{ kind: "observation", ref: "switch starts off" }] },
      { id: "token", value: "true", evidence: [{ kind: "observation", ref: "one token exists" }] },
      { id: "witness", value: "false", evidence: [{ kind: "observation", ref: "no witness yet" }] },
    );
    blueprint.destination.requires.push("switch-on", "witness-present");
    blueprint.destination.acceptance.push({
      id: "switch-and-witness-observed",
      proves: ["switch-on", "witness-present"],
      proof: "switch and witness are observed in the same world",
    });
    blueprint.nodes.push(
      { id: "switch-start", kind: "state", label: "开关关闭且令牌存在", predicates: ["switch-off", "token-present"] },
      { id: "switch-enabled", kind: "state", label: "开关打开且令牌耗尽", predicates: ["switch-on", "token-spent"] },
      { id: "witness-created", kind: "state", label: "见证存在但开关关闭", predicates: ["switch-off", "token-spent", "witness-present"] },
    );
    blueprint.nodes.find((node) => node.id === "article-live").predicates.push("switch-on", "witness-present");
    blueprint.edges.push(
      {
        id: "spend-token-to-enable",
        from: "switch-start",
        to: "switch-enabled",
        brief_ref: "briefs/spend-token-to-enable.md",
        preconditions: ["token-present", "switch-off"],
        effects: ["switch-on", "token-spent"],
        invariants: [],
        certainty: "expected",
        evidence_contract: [{ id: "switch-enabled-record", proves: ["switch-on", "token-spent"], required: true }],
        on_failure: { action: "stop" },
      },
      {
        id: "create-witness-and-disable",
        from: "switch-enabled",
        to: "witness-created",
        brief_ref: "briefs/create-witness-and-disable.md",
        preconditions: ["switch-on", "token-spent"],
        effects: ["switch-off", "witness-present"],
        invariants: [],
        certainty: "expected",
        evidence_contract: [{ id: "witness-record", proves: ["switch-off", "witness-present"], required: true }],
        on_failure: { action: "stop" },
      },
    );
  });
  const proof = proveBlueprint(readBlueprint(mapPath).blueprint);
  assert.equal(proof.reachability, "unreachable");
  assert.equal(proof.destination_reachable, false);
});

test("edge evidence requires a separate human arrival audit request before arrival", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-v03-"));
  const mapPath = makeMap(directory);
  const state = path.join(directory, "state.json");

  assertExit(runCli(state, "init", "--map", mapPath));
  assertExit(runCli(state, "gate"), 1);
  assertExit(approveAndAuthorize(state, "settle-audience"));
  assertExit(runCli(state, "gate"));
  assertExit(verify(state, "settle-audience", "audience-known"));
  assertExit(authorizeEdge(state, "write-candidate"));
  assertExit(verify(state, "write-candidate", "article-drafted,sensitive-content-checked", "sensitive-review-recorded"));
  assertExit(authorizeEdge(state, "obtain-owner-approval"));
  assertExit(verify(state, "obtain-owner-approval", "owner-approved"));
  const prematureAudit = requestArrivalAudit(state);
  assertExit(prematureAudit, 1);
  assert.match(prematureAudit.stderr, /destination predicates are not observed/);
  assertExit(authorizeEdge(state, "publish-article"));
  assertExit(verify(state, "publish-article", "article-published,public-url-exists", "public-page-readable", "external:https://example.invalid/article"));

  const finalActions = runCli(state, "next-actions", "--json");
  assertExit(finalActions);
  const finalView = JSON.parse(finalActions.stdout);
  assert.equal(finalView.proof.causal_soundness, "explicit");
  assert.equal(finalView.evidence_levels.executed_derivation.status, "complete");
  assert.deepEqual(finalView.evidence_levels.executed_derivation.verified_edges, [
    "settle-audience", "write-candidate", "obtain-owner-approval", "publish-article",
  ]);

  const legacyArrival = runCli(
    state,
    "arrive", "--confirm", "destination and acceptance evidence audited",
    "--acceptance", "public-page-readable,sensitive-review-recorded",
  );
  assertExit(legacyArrival, 1);
  assert.match(legacyArrival.stderr, /request-arrival-audit.*then arrive --request/i);

  const requested = requestArrivalAudit(state);
  assertExit(requested);
  const requestId = JSON.parse(requested.stdout).request_id;
  let data = JSON.parse(fs.readFileSync(state, "utf8"));
  assert.equal(data.phase, "implementation");
  assert.equal(data.runtime_status, "arrival-audit-required");
  assert.equal(data.arrival_audit, undefined);
  assert.equal(data.arrival_audit_requests.at(-1).status, "pending");
  assert.equal(data.arrival_audit_requests.at(-1).decision_owner, "human:owner");
  assert.deepEqual(data.arrival_audit_requests.at(-1).acceptance, ["public-page-readable", "sensitive-review-recorded"]);
  assert.equal(data.arrival_audit_requests.at(-1).state_revision, data.event_stream.last_seq);

  assertExit(runCli(
    state,
    "arrive", "--request", requestId,
    "--answer", "Agent cannot answer the human audit gate",
    "--actor", "agent:codex",
  ), 1);

  fs.rmSync(state);
  assertExit(runCli(state, "rebuild", "--force"));
  data = JSON.parse(fs.readFileSync(state, "utf8"));
  assert.equal(data.arrival_audit_requests.at(-1).id, requestId);
  assert.equal(data.arrival_audit_requests.at(-1).status, "pending");

  assertExit(runCli(
    state,
    "assign-decision-owner", "--request", requestId,
    "--decision-owner", "human:reviewer",
    "--actor", "agent:codex",
  ));
  data = JSON.parse(fs.readFileSync(state, "utf8"));
  assert.equal(data.arrival_audit_requests.at(-1).decision_owner, "human:reviewer");
  assert.equal(data.arrival_audit_requests.at(-1).status, "pending");
  assert.equal(data.arrival_audit_requests.at(-1).state_revision, data.event_stream.last_seq);

  const wrongAuditor = runCli(
    state,
    "arrive", "--request", requestId,
    "--answer", "Wrong human identity",
    "--actor", "human:owner",
  );
  assertExit(wrongAuditor, 1);
  assert.match(wrongAuditor.stderr, /actor must match decision owner human:reviewer/);

  assertExit(runCli(
    state,
    "arrive", "--request", requestId,
    "--answer", "destination and acceptance evidence audited",
    "--actor", "human:reviewer",
    "--non-goals", "automatic audience choice",
    "--risks", "none",
  ));

  data = JSON.parse(fs.readFileSync(state, "utf8"));
  assert.equal(data.phase, "arrived");
  assert.equal(data.arrival_audit.request, requestId);
  assert.equal(data.arrival_audit.actor, "human:reviewer");
  assert.equal(data.arrival_audit_requests.at(-1).status, "granted");
  assert.deepEqual(data.verified_edges, ["settle-audience", "write-candidate", "obtain-owner-approval", "publish-article"]);
  assert.ok(data.satisfied_nodes.includes("article-live"));
  assert.equal(data.facts["article-published"].value, "true");
  assert.equal(data.evidence.length, 4);
  assert.deepEqual(data.evidence[3].outcome_refs, [{ kind: "external", ref: "https://example.invalid/article" }]);
  assert.ok(data.facts["article-published"].evidence.some((entry) => entry.kind === "external"));
  assert.equal("current_node" in data, false);
  assert.equal("completed_nodes" in data, false);
  const status = runCli(state, "status", "--json");
  assertExit(status);
  assert.equal(JSON.parse(status.stdout).actual_arrival, "audited");
  const reprove = runCli(state, "prove");
  assertExit(reprove, 1);
  assert.match(reprove.stderr, /cannot refresh proof for an arrived map/);
});

test("pending arrival audit blocks proof refresh and still fails closed after replan", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-v05-arrival-stale-"));
  const mapPath = makeMap(directory);
  const state = path.join(directory, "state.json");

  assertExit(runCli(state, "init", "--map", mapPath));
  assertExit(approveAndAuthorize(state, "settle-audience"));
  assertExit(verify(state, "settle-audience", "audience-known"));
  assertExit(authorizeEdge(state, "write-candidate"));
  assertExit(verify(state, "write-candidate", "article-drafted,sensitive-content-checked", "sensitive-review-recorded"));
  assertExit(authorizeEdge(state, "obtain-owner-approval"));
  assertExit(verify(state, "obtain-owner-approval", "owner-approved"));
  assertExit(authorizeEdge(state, "publish-article"));
  assertExit(verify(state, "publish-article", "article-published,public-url-exists", "public-page-readable", "external:https://example.invalid/article"));

  const firstRequest = requestArrivalAudit(state);
  assertExit(firstRequest);
  const firstRequestId = JSON.parse(firstRequest.stdout).request_id;
  let data = JSON.parse(fs.readFileSync(state, "utf8"));
  const requestedRevision = data.event_stream.last_seq;
  const blockedProof = runCli(state, "prove");
  assertExit(blockedProof, 1);
  assert.match(blockedProof.stderr, new RegExp(`cannot refresh proof while arrival audit request is pending: ${firstRequestId}`));
  assert.match(blockedProof.stderr, /answer it with arrive --request/);
  assert.match(blockedProof.stderr, /replan explicitly/);
  data = JSON.parse(fs.readFileSync(state, "utf8"));
  assert.equal(data.event_stream.last_seq, requestedRevision);
  assert.equal(data.arrival_audit_requests.at(-1).status, "pending");

  assertExit(runCli(
    state,
    "arrive", "--request", firstRequestId,
    "--answer", "The frozen evidence and acceptance are accepted",
    "--actor", "human:owner",
  ));
  data = JSON.parse(fs.readFileSync(state, "utf8"));
  assert.equal(data.phase, "arrived");

  const secondDirectory = path.join(directory, "replan-case");
  fs.mkdirSync(secondDirectory, { recursive: true });
  const secondState = path.join(secondDirectory, "state.json");
  assertExit(runCli(secondState, "init", "--map", mapPath));
  assertExit(approveAndAuthorize(secondState, "settle-audience"));
  assertExit(verify(secondState, "settle-audience", "audience-known"));
  assertExit(authorizeEdge(secondState, "write-candidate"));
  assertExit(verify(secondState, "write-candidate", "article-drafted,sensitive-content-checked", "sensitive-review-recorded"));
  assertExit(authorizeEdge(secondState, "obtain-owner-approval"));
  assertExit(verify(secondState, "obtain-owner-approval", "owner-approved"));
  assertExit(authorizeEdge(secondState, "publish-article"));
  assertExit(verify(secondState, "publish-article", "article-published,public-url-exists", "public-page-readable", "external:https://example.invalid/article"));

  const secondRequest = requestArrivalAudit(secondState);
  assertExit(secondRequest);
  const secondRequestId = JSON.parse(secondRequest.stdout).request_id;
  assertExit(runCli(
    secondState,
    "replan", "--reason", "recheck residual risk before arrival",
    "--scope", "observation:arrival-risk", "--changes", "none",
  ));
  data = JSON.parse(fs.readFileSync(secondState, "utf8"));
  assert.equal(data.arrival_audit_requests.find((item) => item.id === secondRequestId).status, "stale");
  assert.equal(data.phase, "wayfinding");
});

test("unverified evidence cannot apply edge effects", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-v03-unverified-"));
  const mapPath = makeMap(directory);
  const state = path.join(directory, "state.json");
  assertExit(runCli(state, "init", "--map", mapPath));
  assertExit(approveAndAuthorize(state, "settle-audience"));
  const issued = runCli(state, "issue-action", "--edge", "settle-audience", "--verifier", "fixture-pass", "--json");
  assertExit(issued);
  const result = runCli(
    state,
    "verify-executed", "--edge", "settle-audience",
    "--evidence", "not actually checked",
    "--verifier", "fixture-pass",
    "--capability", JSON.parse(issued.stdout).token,
    "--unverified", "audience decision",
    "--executor", "agent:codex",
    "--model", "gpt-5.6-sol",
    "--reasoning", "high",
  );
  assertExit(result, 1);
  const data = JSON.parse(fs.readFileSync(state, "utf8"));
  assert.equal(data.facts["audience-known"].value, "unknown");
  assert.deepEqual(data.verified_edges, []);
  assert.equal(data.active_edge, null);
  assert.equal(data.edge_runs.at(-1).status, "blocked");
  assert.equal(data.evidence.length, 1);
});

test("reported pass remains an untrusted observation and cannot move the map", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-reported-evidence-"));
  const mapPath = makeMap(directory);
  const state = path.join(directory, "state.json");
  assertExit(runCli(state, "init", "--map", mapPath));
  assertExit(approveAndAuthorize(state, "settle-audience"));

  const reported = runCli(
    state, "verify", "--edge", "settle-audience",
    "--evidence", "model claims the audience is known",
    "--command", "not executed", "--observed", "claimed pass",
    "--result", "pass", "--proves", "audience-known",
    "--executor", "agent:codex", "--model", "gpt-5.6-sol", "--reasoning", "high",
  );
  assertExit(reported);
  assert.match(reported.stdout, /facts unchanged/);
  let data = JSON.parse(fs.readFileSync(state, "utf8"));
  assert.equal(data.facts["audience-known"].value, "unknown");
  assert.equal(data.active_edge, "settle-audience");
  assert.deepEqual(data.verified_edges, []);
  assert.equal(data.evidence[0].trust, "reported");
  assert.equal(data.evidence[0].checks[0].mode, "reported");

  const next = runCli(state, "next-actions", "--json");
  assertExit(next);
  const actions = JSON.parse(next.stdout).actions;
  assert.equal(actions.some((entry) => entry.id === "issue-action"), true);

  const issued = runCli(state, "issue-action", "--edge", "settle-audience", "--verifier", "fixture-pass", "--json");
  assertExit(issued);
  const capability = JSON.parse(issued.stdout);
  const wrongVerifier = runCli(
    state, "verify-executed", "--edge", "settle-audience", "--verifier", "fixture-fail",
    "--capability", capability.token, "--evidence", "wrong verifier", "--executor", "tool:test",
  );
  assertExit(wrongVerifier, 1);
  assert.match(wrongVerifier.stderr, /not bound to this frozen verifier/);

  const verified = runCli(
    state, "verify-executed", "--edge", "settle-audience", "--verifier", "fixture-pass",
    "--capability", capability.token, "--evidence", "runtime executed the frozen verifier", "--executor", "tool:test",
  );
  assertExit(verified);
  data = JSON.parse(fs.readFileSync(state, "utf8"));
  assert.equal(data.facts["audience-known"].value, "true");
  assert.equal(data.capabilities[0].status, "consumed");
  assert.equal(data.evidence.at(-1).trust, "verified");
  assert.equal(data.evidence.at(-1).checks[0].exit_code, 0);
  assert.match(data.evidence.at(-1).checks[0].stdout_digest, /^[a-f0-9]{64}$/);

  const replay = runCli(
    state, "verify-executed", "--edge", "settle-audience", "--verifier", "fixture-pass",
    "--capability", capability.token, "--evidence", "replayed token", "--executor", "tool:test",
  );
  assertExit(replay, 1);
  data = JSON.parse(fs.readFileSync(state, "utf8"));
  assert.equal(data.evidence.length, 2);
});

test("executed verification rejects caller supplied result and consumes actual failure", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-executed-failure-"));
  const mapPath = makeMap(directory);
  const state = path.join(directory, "state.json");
  assertExit(runCli(state, "init", "--map", mapPath));
  assertExit(approveAndAuthorize(state, "settle-audience"));
  const issued = runCli(state, "issue-action", "--edge", "settle-audience", "--verifier", "fixture-fail", "--json");
  assertExit(issued);
  const token = JSON.parse(issued.stdout).token;
  const spoof = runCli(
    state, "verify-executed", "--edge", "settle-audience", "--verifier", "fixture-fail",
    "--capability", token, "--evidence", "spoofed pass", "--result", "pass", "--executor", "tool:test",
  );
  assertExit(spoof, 1);
  assert.match(spoof.stderr, /--result is not accepted/);
  const failed = runCli(
    state, "verify-executed", "--edge", "settle-audience", "--verifier", "fixture-fail",
    "--capability", token, "--evidence", "actual process failure", "--executor", "tool:test",
  );
  assertExit(failed, 1);
  const data = JSON.parse(fs.readFileSync(state, "utf8"));
  assert.equal(data.facts["audience-known"].value, "unknown");
  assert.equal(data.edge_runs.at(-1).status, "failed");
  assert.equal(data.evidence.at(-1).checks[0].result, "fail");
  assert.equal(data.evidence.at(-1).checks[0].exit_code, 1);
  assert.equal(data.capabilities.at(-1).status, "consumed");
});

test("human work can produce evidence without agent metadata", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-v03-human-evidence-"));
  const mapPath = makeMap(directory);
  const state = path.join(directory, "state.json");
  assertExit(runCli(state, "init", "--map", mapPath));
  assertExit(approveAndAuthorize(state, "settle-audience"));
  const result = runCli(
    state,
    "verify", "--edge", "settle-audience",
    "--evidence", "owner confirmed the intended audience in meeting minutes",
    "--command", "read meeting minutes",
    "--observed", "audience is explicitly named",
    "--result", "pass",
    "--proves", "audience-known",
    "--executor", "human:owner",
    "--outcome-ref", "meeting:minutes/audience-decision",
  );
  assertExit(result);
  const evidence = JSON.parse(fs.readFileSync(state, "utf8")).evidence.at(-1);
  assert.equal(evidence.executor, "human:owner");
  assert.equal("agent" in evidence, false);
});

test("backward closure reports missing authorization", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-v03-gap-"));
  const mapPath = makeMap(directory, (blueprint) => {
    blueprint.edges = blueprint.edges.filter((edge) => edge.id !== "obtain-owner-approval");
  });
  const proof = proveBlueprint(readBlueprint(mapPath).blueprint);
  assert.equal(proof.reachability, "unreachable");
  assert.ok(proof.proof_gaps.some((gap) => gap.type === "missing-authorization" && gap.missing === "owner-approved"));
  assert.equal(proof.proof_gaps.some((gap) => gap.at_edge === "settle-audience"), false);
  assert.equal(proof.proof_gaps.filter((gap) => gap.type === "missing-authorization").length, 1);
});

test("destination invariants participate in reachability", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-v03-destination-invariant-"));
  const mapPath = makeMap(directory, (blueprint) => {
    for (const goalId of blueprint.destination.requires) {
      const predicate = blueprint.predicates.find((item) => item.id === goalId);
      const fact = blueprint.initial_state.facts.find((item) => item.id === predicate.fact);
      fact.value = predicate.equals;
    }
    blueprint.predicates.push({ id: "safety-preserved", fact: "safety-preserved", equals: "true", kind: "authorization" });
    blueprint.initial_state.facts.push({
      id: "safety-preserved",
      value: "false",
      evidence: [{ kind: "observation", ref: "safety authorization is absent" }],
    });
    blueprint.invariants.push({ id: "preserve-safety", applies_to: ["publish-article"], requires: ["safety-preserved"] });
    blueprint.destination.invariants.push("preserve-safety");
  });
  const proof = proveBlueprint(readBlueprint(mapPath).blueprint);
  assert.equal(proof.reachability, "unreachable");
  assert.equal(proof.destination_reachable, false);
  assert.ok(proof.proof_gaps.some((gap) => gap.missing === "safety-preserved"));
});

test("an unreachable OR choice reports only the best branch gap", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-v03-or-gap-"));
  const mapPath = makeMap(directory, (blueprint) => {
    blueprint.edges = blueprint.edges.filter((edge) => edge.id !== "obtain-owner-approval");
    blueprint.destination.invariants = [];
    blueprint.edges.find((edge) => edge.id === "publish-article").invariants = [];
    blueprint.predicates.push({ id: "partner-authorized", fact: "partner-authorized", equals: "true", kind: "authorization" });
    blueprint.initial_state.facts.push({
      id: "partner-authorized",
      value: "false",
      evidence: [{ kind: "observation", ref: "partner authorization absent" }],
    });
    blueprint.edges.push({
      id: "publish-through-partner",
      from: "candidate-ready",
      to: "article-live",
      brief_ref: "briefs/publish-through-partner.md",
      preconditions: ["partner-authorized"],
      effects: ["article-published", "public-url-exists"],
      invariants: [],
      certainty: "expected",
      evidence_contract: [{ id: "partner-publication-readback", proves: ["article-published", "public-url-exists"], required: true }],
      on_failure: { action: "stop" },
    });
  });
  const proof = proveBlueprint(readBlueprint(mapPath).blueprint);
  const logicalGaps = proof.proof_gaps.filter((gap) => gap.category === "logical");
  assert.equal(proof.reachability, "unreachable");
  assert.equal(logicalGaps.length, 1);
  assert.equal(logicalGaps[0].missing, "owner-approved");
  assert.equal(logicalGaps.some((gap) => gap.at_edge === "settle-audience"), false);
});

test("same-source edge invariant dependency is rejected as hidden coupling", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-v03-coupling-"));
  const mapPath = makeMap(directory, (blueprint) => {
    blueprint.nodes.push({
      id: "sibling-result",
      kind: "state",
      label: "同源边结果",
      predicates: ["sensitive-content-checked"],
    });
    blueprint.invariants.push({
      id: "draft-required-for-check",
      applies_to: ["check-after-writing"],
      requires: ["article-drafted"],
    });
    blueprint.edges.push({
      id: "check-after-writing",
      from: "writing-ready",
      to: "sibling-result",
      brief_ref: "briefs/check-after-writing.md",
      preconditions: ["source-exists", "audience-known"],
      effects: ["sensitive-content-checked"],
      invariants: ["draft-required-for-check"],
      certainty: "expected",
      evidence_contract: [{ id: "sensitive-check", proves: ["sensitive-content-checked"], required: true }],
      on_failure: { action: "replan" },
    });
  });
  const proof = proveBlueprint(readBlueprint(mapPath).blueprint);
  assert.equal(proof.structural, "incomplete");
  assert.ok(proof.proof_gaps.some((gap) => gap.type === "hidden-edge-coupling" && gap.at_edge === "check-after-writing"));
});

test("uncovered effects produce an evidence-contract proof gap", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-v03-evidence-gap-"));
  const mapPath = makeMap(directory, (blueprint) => {
    blueprint.edges.find((edge) => edge.id === "publish-article").evidence_contract = [];
  });
  const proof = proveBlueprint(readBlueprint(mapPath).blueprint);
  assert.equal(proof.structural, "incomplete");
  assert.ok(proof.proof_gaps.some((gap) => gap.type === "missing-evidence-contract" && gap.at_edge === "publish-article"));
});

test("an edge must establish every predicate of its target state", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-v03-target-gap-"));
  const mapPath = makeMap(directory, (blueprint) => {
    const edge = blueprint.edges.find((item) => item.id === "settle-audience");
    edge.effects = ["article-drafted"];
    edge.evidence_contract = [{ id: "draft-record", proves: ["article-drafted"], required: true }];
  });
  const proof = proveBlueprint(readBlueprint(mapPath).blueprint);
  assert.equal(proof.structural, "incomplete");
  assert.ok(proof.proof_gaps.some((gap) => gap.type === "insufficient-edge-effect" && gap.at_edge === "settle-audience"));
});

test("cycles require an explicit progress, exit, and budget contract", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-v03-loop-gap-"));
  const mapPath = makeMap(directory, (blueprint) => {
    blueprint.edges.push({
      id: "reopen-audience",
      from: "article-live",
      to: "material-present-audience-unknown",
      brief_ref: "briefs/reopen-audience.md",
      preconditions: ["article-published"],
      effects: ["audience-unknown"],
      invariants: [],
      certainty: "conditional",
      evidence_contract: [{ id: "reopened-audience", proves: ["audience-unknown"], required: true }],
      on_failure: { action: "stop" },
    });
  });
  const proof = proveBlueprint(readBlueprint(mapPath).blueprint);
  assert.equal(proof.structural, "incomplete");
  assert.ok(proof.proof_gaps.some((gap) => gap.type === "loop-without-progress-contract"));
});

test("a loop progress predicate must be produced by every loop edge", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-v03-loop-progress-"));
  const mapPath = makeMap(directory, (blueprint) => {
    blueprint.edges.push({
      id: "reopen-audience",
      from: "writing-ready",
      to: "material-present-audience-unknown",
      brief_ref: "briefs/reopen-audience.md",
      preconditions: ["audience-known"],
      effects: ["audience-unknown"],
      invariants: [],
      certainty: "conditional",
      evidence_contract: [{ id: "audience-reopened", proves: ["audience-unknown"], required: true }],
      on_failure: { action: "stop" },
    });
    blueprint.loops.push({
      id: "audience-loop",
      edges: ["settle-audience", "reopen-audience"],
      progress_predicate: "source-exists",
      exit_predicate: "audience-known",
      max_iterations: 2,
    });
  });
  const proof = proveBlueprint(readBlueprint(mapPath).blueprint);
  assert.equal(proof.structural, "incomplete");
  assert.ok(proof.proof_gaps.some((gap) => gap.type === "loop-progress-not-produced"));
});

test("loop edges can repeat only until their runtime budget is exhausted", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-v03-loop-runtime-"));
  const mapPath = makeMap(directory, (blueprint) => {
    blueprint.predicates.push(
      { id: "loop-progress", fact: "loop-progress", equals: "true", kind: "progress" },
      { id: "loop-exited", fact: "loop-exited", equals: "true", kind: "state" },
    );
    blueprint.initial_state.facts.push(
      { id: "loop-progress", value: "false", evidence: [{ kind: "observation", ref: "loop has not advanced" }] },
      { id: "loop-exited", value: "false", evidence: [{ kind: "observation", ref: "loop has not exited" }] },
    );
    blueprint.destination.requires.push("loop-exited");
    blueprint.destination.acceptance.push({ id: "loop-exit-observed", proves: ["loop-exited"], proof: "loop exit is observed" });
    blueprint.nodes.push(
      { id: "loop-ready", kind: "state", label: "循环可以推进", predicates: ["source-exists"] },
      { id: "loop-progressed", kind: "state", label: "循环已有进展", predicates: ["source-exists", "loop-progress"] },
      { id: "loop-finished", kind: "state", label: "循环已经退出", predicates: ["loop-exited"] },
    );
    blueprint.nodes.find((node) => node.id === "article-live").predicates.push("loop-exited");
    blueprint.edges.find((edge) => edge.id === "publish-article").preconditions.push("loop-exited");
    blueprint.edges.push(
      {
        id: "advance-loop",
        from: "loop-ready",
        to: "loop-progressed",
        brief_ref: "briefs/advance-loop.md",
        preconditions: ["source-exists"],
        effects: ["loop-progress"],
        invariants: [],
        certainty: "expected",
        evidence_contract: [{ id: "loop-progress-record", proves: ["loop-progress"], required: true }],
        on_failure: { action: "stop" },
      },
      {
        id: "return-loop",
        from: "loop-progressed",
        to: "loop-ready",
        brief_ref: "briefs/return-loop.md",
        preconditions: ["source-exists", "loop-progress"],
        effects: ["loop-progress"],
        invariants: [],
        certainty: "expected",
        evidence_contract: [{ id: "loop-return-record", proves: ["loop-progress"], required: true }],
        on_failure: { action: "stop" },
      },
      {
        id: "exit-loop",
        from: "loop-progressed",
        to: "loop-finished",
        brief_ref: "briefs/exit-loop.md",
        preconditions: ["loop-progress"],
        effects: ["loop-exited"],
        invariants: [],
        certainty: "expected",
        evidence_contract: [{ id: "loop-exit-record", proves: ["loop-exited"], required: true }],
        on_failure: { action: "stop" },
      },
    );
    blueprint.loops.push({
      id: "bounded-loop",
      edges: ["advance-loop", "return-loop"],
      progress_predicate: "loop-progress",
      exit_predicate: "loop-exited",
      max_iterations: 2,
    });
  });
  const blueprint = readBlueprint(mapPath).blueprint;
  const proof = proveBlueprint(blueprint);
  assert.equal(proof.structural, "complete");
  assert.equal(proof.reachability, "conditional");
  const exhaustedProof = proveBlueprint(blueprint, undefined, { loopIterations: { "bounded-loop": 2 } });
  assert.equal(exhaustedProof.reachability, "unreachable");
  assert.ok(exhaustedProof.proof_gaps.some((gap) => gap.type === "loop-budget-exhausted"));

  const state = path.join(directory, "state.json");
  assertExit(runCli(state, "init", "--map", mapPath));
  assertExit(approveAndAuthorize(state, "advance-loop"));
  assertExit(verify(state, "advance-loop", "loop-progress"));
  assertExit(authorizeEdge(state, "advance-loop"));
  assertExit(verify(state, "advance-loop", "loop-progress"));
  const exhausted = requestAuthorization(state, "advance-loop");
  assertExit(exhausted, 1);
  assert.match(exhausted.stderr, /loop budget exhausted/);
  assert.equal(JSON.parse(fs.readFileSync(state, "utf8")).loop_iterations["bounded-loop"], 2);
});

test("map changes after approval block the write gate", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-v03-digest-"));
  const mapPath = makeMap(directory);
  const state = path.join(directory, "state.json");
  assertExit(runCli(state, "init", "--map", mapPath));
  assertExit(approveAndAuthorize(state, "settle-audience"));
  fs.appendFileSync(mapPath, "\n", "utf8");
  const result = runCli(state, "gate");
  assertExit(result, 1);
  assert.match(result.stderr, /Blueprint or bound Task Brief changed after approval/);
});

test("bound Task Brief changes after approval block the write gate", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-v03-brief-digest-"));
  const mapPath = makeMap(directory);
  const state = path.join(directory, "state.json");
  assertExit(runCli(state, "init", "--map", mapPath));
  assertExit(approveAndAuthorize(state, "settle-audience"));
  fs.appendFileSync(path.join(directory, "briefs", "settle-audience.md"), "\nchanged execution boundary\n", "utf8");
  const result = runCli(state, "gate");
  assertExit(result, 1);
  assert.match(result.stderr, /Blueprint or bound Task Brief changed after approval/);
});

test("replan preserves verified edges and evidence", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-v03-replan-"));
  const mapPath = makeMap(directory);
  const state = path.join(directory, "state.json");
  assertExit(runCli(state, "init", "--map", mapPath));
  assertExit(approveAndAuthorize(state, "settle-audience"));
  assertExit(verify(state, "settle-audience", "audience-known"));
  assertExit(runCli(state, "replan", "--reason", "new constraint discovered", "--scope", "observation:new-constraint", "--changes", "none"));
  assertExit(runCli(state, "gate"), 1);
  const data = JSON.parse(fs.readFileSync(state, "utf8"));
  assert.equal(data.phase, "wayfinding");
  assert.equal(data.destination_status, "changed");
  assert.deepEqual(data.verified_edges, ["settle-audience"]);
  assert.equal(data.evidence.length, 1);
  assert.equal(data.facts["audience-known"].value, "true");
});

test("replan can revise an unverified future Brief without rebinding earlier proof certificates", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-replan-future-brief-"));
  const mapPath = makeMap(directory);
  const state = path.join(directory, "state.json");
  assertExit(runCli(state, "init", "--map", mapPath));
  assertExit(approveAndAuthorize(state, "settle-audience"));
  assertExit(verify(state, "settle-audience", "audience-known"));

  const before = JSON.parse(fs.readFileSync(state, "utf8"));
  const certificate = structuredClone(before.evidence[0].proof_certificate);
  fs.appendFileSync(
    path.join(directory, "briefs", "write-candidate.md"),
    "\nFuture-edge clarification that does not reinterpret completed work.\n",
    "utf8",
  );

  assertExit(runCli(
    state,
    "replan", "--reason", "clarify an unverified future edge",
    "--scope", "edge:write-candidate", "--changes", "brief:write-candidate",
  ));
  assertExit(runCli(state, "status", "--json"));
  const after = JSON.parse(fs.readFileSync(state, "utf8"));
  assert.notEqual(after.map_digest, certificate.map_digest);
  assert.deepEqual(after.evidence[0].proof_certificate, certificate);
  assert.deepEqual(after.verified_edges, ["settle-audience"]);
  assert.equal(after.facts["audience-known"].value, "true");
});

test("replan requires an explicit change set even when the map is unchanged", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-v03-replan-explicit-changes-"));
  const mapPath = makeMap(directory);
  const state = path.join(directory, "state.json");
  assertExit(runCli(state, "init", "--map", mapPath));
  const result = runCli(state, "replan", "--reason", "inspect new information", "--scope", "observation:new-information");
  assertExit(result, 1);
  assert.match(result.stderr, /changes is required/);
});

test("replan cannot redefine a verified edge contract", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-v03-replan-contract-"));
  const mapPath = makeMap(directory);
  const state = path.join(directory, "state.json");
  assertExit(runCli(state, "init", "--map", mapPath));
  assertExit(approveAndAuthorize(state, "settle-audience"));
  assertExit(verify(state, "settle-audience", "audience-known"));
  const changed = JSON.parse(fs.readFileSync(mapPath, "utf8"));
  changed.edges.find((edge) => edge.id === "settle-audience").certainty = "conditional";
  fs.writeFileSync(mapPath, `${JSON.stringify(changed, null, 2)}\n`, "utf8");
  const result = runCli(
    state,
    "replan", "--reason", "try redefining completed work", "--scope", "edge:settle-audience", "--changes", "edge:settle-audience",
  );
  assertExit(result, 1);
  assert.match(result.stderr, /causal_contract omits structural premises|verified edge contract cannot be removed or redefined/);
});

test("replan cannot reinterpret predicates referenced by a verified edge", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-v03-replan-predicate-contract-"));
  const mapPath = makeMap(directory);
  const state = path.join(directory, "state.json");
  assertExit(runCli(state, "init", "--map", mapPath));
  assertExit(approveAndAuthorize(state, "settle-audience"));
  assertExit(verify(state, "settle-audience", "audience-known"));
  const changed = JSON.parse(fs.readFileSync(mapPath, "utf8"));
  changed.predicates.find((predicate) => predicate.id === "audience-known").fact = "source-exists";
  fs.writeFileSync(mapPath, `${JSON.stringify(changed, null, 2)}\n`, "utf8");
  const result = runCli(
    state,
    "replan", "--reason", "try reinterpreting completed evidence", "--scope", "predicate:audience-known", "--changes", "predicate:audience-known",
  );
  assertExit(result, 1);
  assert.match(result.stderr, /causal_contract omits structural premises|verified edge contract cannot be removed or redefined/);
});

test("replan cannot change a destination invariant applicable to a verified edge", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-v03-replan-destination-invariant-"));
  const mapPath = makeMap(directory);
  const state = path.join(directory, "state.json");
  assertExit(runCli(state, "init", "--map", mapPath));
  assertExit(approveAndAuthorize(state, "settle-audience"));
  assertExit(verify(state, "settle-audience", "audience-known"));
  const changed = JSON.parse(fs.readFileSync(mapPath, "utf8"));
  changed.invariants.find((invariant) => invariant.id === "approval-before-publish").applies_to.push("settle-audience");
  fs.writeFileSync(mapPath, `${JSON.stringify(changed, null, 2)}\n`, "utf8");
  const result = runCli(
    state,
    "replan", "--reason", "try changing completed execution conditions", "--scope", "destination:approval-before-publish", "--changes", "invariant:approval-before-publish",
  );
  assertExit(result, 1);
  assert.match(result.stderr, /causal_contract omits structural premises|verified edge contract cannot be removed or redefined/);
});

test("replan checks the declared bounded change set against the Blueprint diff", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-v03-replan-diff-"));
  const mapPath = makeMap(directory);
  const state = path.join(directory, "state.json");
  assertExit(runCli(state, "init", "--map", mapPath));
  const changed = JSON.parse(fs.readFileSync(mapPath, "utf8"));
  changed.edges.find((edge) => edge.id === "publish-article").certainty = "conditional";
  fs.writeFileSync(mapPath, `${JSON.stringify(changed, null, 2)}\n`, "utf8");
  const mismatch = runCli(
    state,
    "replan", "--reason", "publication failure must stop", "--scope", "edge:publish-article", "--changes", "node:article-live",
  );
  assertExit(mismatch, 1);
  assert.match(mismatch.stderr, /change set mismatch/);
  assertExit(runCli(
    state,
    "replan", "--reason", "publication failure must stop", "--scope", "edge:publish-article", "--changes", "edge:publish-article",
  ));
  const data = JSON.parse(fs.readFileSync(state, "utf8"));
  assert.deepEqual(data.history.at(-1).changed_refs, ["edge:publish-article"]);
});

test("replan rejects a declared change set outside its repair scope", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-v03-replan-scope-"));
  const mapPath = makeMap(directory);
  const state = path.join(directory, "state.json");
  assertExit(runCli(state, "init", "--map", mapPath));
  const changed = JSON.parse(fs.readFileSync(mapPath, "utf8"));
  changed.edges.find((edge) => edge.id === "publish-article").certainty = "conditional";
  fs.writeFileSync(mapPath, `${JSON.stringify(changed, null, 2)}\n`, "utf8");
  const result = runCli(
    state,
    "replan", "--reason", "unrelated edit", "--scope", "edge:settle-audience", "--changes", "edge:publish-article",
  );
  assertExit(result, 1);
  assert.match(result.stderr, /outside repair scope/);
});

test("prove and start cannot accept edits made after a bounded replan", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-v03-replan-bypass-"));
  const mapPath = makeMap(directory);
  const state = path.join(directory, "state.json");
  assertExit(runCli(state, "init", "--map", mapPath));
  assertExit(runCli(
    state,
    "replan", "--reason", "inspect a new observation", "--scope", "observation:new-constraint", "--changes", "none",
  ));
  const changed = JSON.parse(fs.readFileSync(mapPath, "utf8"));
  changed.edges.find((edge) => edge.id === "publish-article").certainty = "conditional";
  fs.writeFileSync(mapPath, `${JSON.stringify(changed, null, 2)}\n`, "utf8");
  const proof = runCli(state, "prove");
  assertExit(proof, 1);
  assert.match(proof.stderr, /Blueprint or bound Task Brief changed/);
  const start = runCli(state, "start", "--edge", "settle-audience");
  assertExit(start, 1);
  assert.match(start.stderr, /Blueprint or bound Task Brief changed/);
});

test("predicate repair scope cannot modify unrelated destination fields", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-v03-predicate-scope-"));
  const mapPath = makeMap(directory);
  const state = path.join(directory, "state.json");
  assertExit(runCli(state, "init", "--map", mapPath));
  const changed = JSON.parse(fs.readFileSync(mapPath, "utf8"));
  changed.destination.statement = "an unrelated destination rewrite";
  fs.writeFileSync(mapPath, `${JSON.stringify(changed, null, 2)}\n`, "utf8");
  const result = runCli(
    state,
    "replan", "--reason", "repair one predicate only", "--scope", "predicate:audience-known", "--changes", "destination:statement",
  );
  assertExit(result, 1);
  assert.match(result.stderr, /outside repair scope/);
});

test("blueprint loading requires real relative Task Briefs", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-v03-brief-"));
  const mapPath = makeMap(directory);
  fs.rmSync(path.join(directory, "briefs", "publish-article.md"));
  assert.throws(() => readBlueprint(mapPath), /brief_ref not found/);
});

test("each edge requires its own correctly bound Task Brief", () => {
  const duplicateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-v03-brief-duplicate-"));
  const duplicateMap = makeMap(duplicateDirectory, (blueprint) => {
    blueprint.edges[1].brief_ref = blueprint.edges[0].brief_ref;
  });
  assert.throws(() => readBlueprint(duplicateMap), /independent Task Brief/);

  const wrongBindingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-v03-brief-binding-"));
  const wrongBindingMap = makeMap(wrongBindingDirectory);
  fs.writeFileSync(
    path.join(wrongBindingDirectory, "briefs", "publish-article.md"),
    "---\nedge: write-candidate\n---\n\n# Wrong binding\n",
    "utf8",
  );
  assert.throws(() => readBlueprint(wrongBindingMap), /expected publish-article/);
});

test("an empty Task Brief cannot satisfy the edge contract", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-v03-brief-empty-"));
  const mapPath = makeMap(directory);
  fs.writeFileSync(path.join(directory, "briefs", "publish-article.md"), "---\nedge: publish-article\n---\n", "utf8");
  assert.throws(() => readBlueprint(mapPath), /lacks required contract metadata/);
});

test("Task Brief machine contract must match edge effects and failure action", () => {
  const effectsDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-v03-brief-effects-"));
  const effectsMap = makeMap(effectsDirectory);
  const effectsBrief = path.join(effectsDirectory, "briefs", "publish-article.md");
  fs.writeFileSync(
    effectsBrief,
    fs.readFileSync(effectsBrief, "utf8").replace(
      "proves: [article-published, public-url-exists]",
      "proves: [article-published]",
    ),
    "utf8",
  );
  assert.throws(() => readBlueprint(effectsMap), /evidence\.proves must exactly match edge effects/);

  const failureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-v03-brief-failure-"));
  const failureMap = makeMap(failureDirectory);
  const failureBrief = path.join(failureDirectory, "briefs", "publish-article.md");
  fs.writeFileSync(
    failureBrief,
    fs.readFileSync(failureBrief, "utf8").replace("action: replan", "action: stop"),
    "utf8",
  );
  assert.throws(() => readBlueprint(failureMap), /failure\.action must match edge on_failure\.action/);
});

test("replan cannot change a verified edge Task Brief", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-v03-replan-brief-contract-"));
  const mapPath = makeMap(directory);
  const state = path.join(directory, "state.json");
  assertExit(runCli(state, "init", "--map", mapPath));
  assertExit(approveAndAuthorize(state, "settle-audience"));
  assertExit(verify(state, "settle-audience", "audience-known"));
  fs.appendFileSync(path.join(directory, "briefs", "settle-audience.md"), "\nchanged after verification\n", "utf8");
  const result = runCli(
    state,
    "replan", "--reason", "try changing completed brief", "--scope", "edge:settle-audience", "--changes", "brief:settle-audience",
  );
  assertExit(result, 1);
  assert.match(result.stderr, /verified edge contract cannot be removed or redefined/);
});

test("blueprint validation rejects schema fields and evidence kinds outside the contract", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-v03-schema-"));
  const mapPath = makeMap(directory, (blueprint) => {
    blueprint.initial_state.facts[0].unexpected = true;
  });
  assert.throws(() => readBlueprint(mapPath), /unsupported fields/);

  const invalidKindPath = makeMap(directory, (blueprint) => {
    blueprint.initial_state.facts[0].evidence[0].kind = "memory";
  });
  assert.throws(() => readBlueprint(invalidKindPath), /kind is invalid/);
});

test("v0.2 state is rejected with an archive migration message", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-v02-state-"));
  const state = path.join(directory, "state.json");
  fs.writeFileSync(state, JSON.stringify({ schema: 1 }), "utf8");
  const result = runCli(state, "status");
  assertExit(result, 1);
  assert.match(result.stderr, /v0\.2 node state is archived and must be re-initialized/);
});

test("wayfinding-answer persists the answer and advances the modeling cursor", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-wayfinding-answer-"));
  const current = path.join(directory, "current");
  fs.mkdirSync(current, { recursive: true });
  fs.writeFileSync(path.join(current, "wayfinding.yaml"), `schema_version: 1
phase: shaping
intent:
  statement: 收敛一个可验收目的地
  status: draft
  open_questions: [需要确认范围]
origin:
  id: origin-fog
  kind: fog
  label: 起始迷雾
  facts: []
destination:
  id: destination-fog
  kind: fog
  label: 目的地迷雾
  statement: 目标
  status: pending
nodes: []
edges: []
questions:
  - id: settle-scope
    prompt: 这次要做什么？
    target:
      kind: destination
      id: destination-fog
      label: 目的地迷雾
      purpose: 收敛目标边界
    status: pending
    answer_updates: [wayfinding.intent.status, wayfinding.intent.open_questions]
`, "utf8");
  const state = path.join(current, "state.json");
  const result = runCli(state, "wayfinding-answer", "--question", "settle-scope", "--answer", "只验证核心路径", "--evidence-ref", "note:owner");
  assertExit(result);
  assert.match(result.stdout, /automatically advanced: wayfinding\.intent\.open_questions/);
  assert.match(result.stdout, /still requires modeling confirmation: wayfinding\.intent\.status/);
  const draft = readWayfinding(path.join(current, "wayfinding.yaml")).draft;
  assert.equal(draft.questions[0].status, "answered");
  assert.equal(draft.questions[0].answer, "只验证核心路径");
  assert.deepEqual(draft.questions[0].evidence_refs, [{ kind: "note", ref: "owner" }]);
  assert.deepEqual(draft.intent.open_questions, []);
});

test("wayfinding-write validates and atomically canonicalizes a complete draft", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-v05-wayfinding-write-"));
  const current = path.join(directory, "current");
  fs.mkdirSync(current, { recursive: true });
  const state = path.join(current, "state.json");
  const target = path.join(current, "wayfinding.yaml");
  const source = path.join(directory, "candidate.json");
  const draft = {
    schema_version: 1,
    phase: "survey",
    intent: { statement: "Build a small local service", status: "draft", open_questions: ["Who uses it?"] },
    origin: {
      id: "origin-fog",
      kind: "fog",
      label: "Current workspace",
      facts: [{ id: "audience-known", value: "unknown", evidence: [] }],
    },
    destination: {
      id: "destination-fog",
      kind: "fog",
      label: "Destination not shaped",
      statement: "A useful local service exists",
      status: "pending",
    },
    nodes: [],
    edges: [],
    questions: [{
      id: "settle-audience",
      prompt: "Who is the first user?",
      target: { kind: "destination", id: "destination-fog", label: "Destination not shaped", purpose: "Shape the user-visible outcome" },
      status: "pending",
      answer_updates: ["wayfinding.intent.open_questions", "wayfinding.destination.status"],
    }],
  };
  fs.writeFileSync(source, `${JSON.stringify(draft, null, 2)}\n`, "utf8");

  const written = runCli(state, "wayfinding-write", "--draft-file", source, "--json");
  assertExit(written);
  const summary = JSON.parse(written.stdout);
  assert.equal(summary.phase, "survey");
  assert.equal(summary.nodes, 0);
  assert.equal(summary.questions, 1);
  const persisted = readWayfinding(target).draft;
  assert.equal(persisted.origin.id, "origin-fog");
  assert.equal((fs.readFileSync(target, "utf8").match(/^updated_at:/gm) ?? []).length, 1);

  const before = fs.readFileSync(target, "utf8");
  draft.origin.kind = "destination";
  fs.writeFileSync(source, `${JSON.stringify(draft, null, 2)}\n`, "utf8");
  const invalid = runCli(state, "wayfinding-write", "--draft-file", source);
  assertExit(invalid, 1);
  assert.match(invalid.stderr, /origin.kind is invalid/);
  assert.equal(fs.readFileSync(target, "utf8"), before);

  draft.origin.kind = "fog";
  const factualAnswer = runCli(
    state,
    "wayfinding-answer", "--question", "settle-audience",
    "--answer", "The first user is a local librarian",
    "--evidence-ref", "note:owner",
  );
  assertExit(factualAnswer);
  let revised = structuredClone(readWayfinding(target).draft);
  revised.phase = "regression";
  revised.intent.status = "shaped";
  revised.destination.kind = "destination";
  revised.destination.status = "confirmed";
  revised.destination.requires = ["service-usable"];
  revised.destination.invariants = [];
  revised.destination.acceptance = [{ id: "service-accepted", proves: ["service-usable"], proof: "核心路径可回读" }];
  revised.boundaries = { in_scope: ["核心路径"], out_of_scope: ["非核心功能"], authorization: [] };
  fs.writeFileSync(source, `${JSON.stringify(revised, null, 2)}\n`, "utf8");
  const implicitConfirmation = runCli(state, "wayfinding-write", "--draft-file", source);
  assertExit(implicitConfirmation, 1);
  assert.match(implicitConfirmation.stderr, /factual constraints or candidate revisions are not confirmation/);
  assert.equal(readWayfinding(target).draft.destination.status, "pending");

  revised = structuredClone(readWayfinding(target).draft);
  revised.intent.status = "draft";
  revised.destination.kind = "fog";
  revised.destination.status = "pending";
  revised.destination.requires = ["service-usable"];
  revised.destination.invariants = [];
  revised.destination.acceptance = [{ id: "service-accepted", proves: ["service-usable"], proof: "核心路径可回读" }];
  revised.boundaries = { in_scope: ["核心路径"], out_of_scope: ["非核心功能"], authorization: [] };
  revised.questions.push({
    id: "confirm-revised-destination",
    prompt: "Do you explicitly confirm the revised destination contract?",
    target: { kind: "destination", id: "destination-fog", label: "Destination not shaped", purpose: "Confirm the revised contract" },
    status: "pending",
    answer_updates: ["wayfinding.intent.status", "wayfinding.destination.status"],
  });
  fs.writeFileSync(source, `${JSON.stringify(revised, null, 2)}\n`, "utf8");
  assertExit(runCli(state, "wayfinding-write", "--draft-file", source));
  assertExit(runCli(
    state,
    "wayfinding-answer", "--question", "confirm-revised-destination",
    "--answer", "I confirm the revised destination contract",
    "--evidence-ref", "note:owner",
  ));
  revised = structuredClone(readWayfinding(target).draft);
  revised.phase = "regression";
  revised.intent.status = "shaped";
  revised.destination.kind = "destination";
  revised.destination.status = "confirmed";
  fs.writeFileSync(source, `${JSON.stringify(revised, null, 2)}\n`, "utf8");
  assertExit(runCli(state, "wayfinding-write", "--draft-file", source));
  assert.equal(readWayfinding(target).draft.destination.status, "confirmed");
});

test("wayfinding permits one current confirmation question and preserves answered history", () => {
  const draft = {
    schema_version: 1,
    phase: "shaping",
    intent: { statement: "Shape one destination", status: "draft", open_questions: ["Which outcome matters?"] },
    origin: { id: "origin-fog", kind: "fog", label: "Current situation", facts: [] },
    destination: {
      id: "destination-fog",
      kind: "fog",
      label: "Destination not shaped",
      statement: "A useful outcome exists",
      status: "pending",
    },
    nodes: [],
    edges: [],
    questions: [
      {
        id: "audience-answered",
        prompt: "Who is the first user?",
        target: { kind: "destination", id: "destination-fog", label: "Destination not shaped", purpose: "Fix the audience" },
        status: "answered",
        answer: "A local librarian",
      },
      {
        id: "outcome-current",
        prompt: "Which outcome matters first?",
        target: { kind: "destination", id: "destination-fog", label: "Destination not shaped", purpose: "Fix the first outcome" },
        status: "pending",
      },
    ],
  };

  assert.equal(validateWayfinding(structuredClone(draft)).questions.length, 2);

  draft.questions.push(
    {
      id: "scope-hidden",
      prompt: "Which scope is excluded?",
      target: { kind: "destination", id: "destination-fog", label: "Destination not shaped", purpose: "Fix the non-goal" },
      status: "pending",
    },
    {
      id: "storage-hidden",
      prompt: "Which storage is allowed?",
      target: { kind: "destination", id: "destination-fog", label: "Destination not shaped", purpose: "Fix the storage boundary" },
    },
  );
  assert.throws(
    () => validateWayfinding(draft),
    /at most one pending question; found: outcome-current, scope-hidden, storage-hidden/,
  );
});

test("wayfinding cannot enter regression with an incomplete destination contract", () => {
  const draft = {
    schema_version: 1,
    phase: "regression",
    intent: { statement: "Deliver one auditable result", status: "shaped", open_questions: [] },
    origin: { id: "origin", kind: "state", label: "Observed origin", facts: [] },
    destination: {
      id: "destination",
      kind: "destination",
      label: "Auditable destination",
      statement: "The goal is reached",
      status: "confirmed",
      requires: ["goal-reached", "scope-preserved"],
      invariants: [],
      acceptance: [{ id: "goal-readback", proves: ["goal-reached"], proof: "Goal can be read back" }],
    },
    boundaries: { in_scope: ["goal route"], out_of_scope: ["unrelated expansion"], authorization: [] },
    nodes: [],
    edges: [],
    questions: [],
  };

  assert.throws(
    () => validateWayfinding(draft),
    /acceptance does not cover required predicates: scope-preserved/,
  );
  draft.destination.acceptance.push({ id: "scope-readback", proves: ["scope-preserved"], proof: "Scope remains bounded" });
  delete draft.boundaries;
  assert.throws(() => validateWayfinding(draft), /requires explicit boundaries/);
});

test("wayfinding-write reviews a complete candidate chain without per-object confirmation gates", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-candidate-confirmation-"));
  const current = path.join(directory, "current");
  fs.mkdirSync(current, { recursive: true });
  const state = path.join(current, "state.json");
  const target = path.join(current, "wayfinding.yaml");
  const source = path.join(directory, "candidate.json");
  const draft = {
    schema_version: 1,
    phase: "regression",
    intent: { statement: "Deliver one auditable result", status: "shaped", open_questions: [] },
    origin: {
      id: "origin",
      kind: "state",
      label: "Observed origin",
      facts: [{ id: "source-ready", value: "true", evidence: [{ kind: "observation", ref: "source-readback" }] }],
    },
    destination: {
      id: "destination",
      kind: "destination",
      label: "Auditable destination",
      statement: "The goal is reached",
      status: "confirmed",
      requires: ["goal-reached"],
      invariants: ["scope-preserved"],
      acceptance: [{ id: "goal-readback", proves: ["goal-reached"], proof: "Goal can be read back" }],
    },
    boundaries: { in_scope: ["goal route"], out_of_scope: ["unrelated expansion"], authorization: [] },
    nodes: [{ id: "milestone", kind: "state", label: "Milestone ready", purpose: "Provide an independent verification start", status: "pending" }],
    edges: [{
      id: "verify-goal",
      from: "milestone",
      to: "destination",
      label: "Verify the goal",
      purpose: "Establish the destination through readback",
      status: "pending",
      brief_ref: "briefs/verify-goal.md",
      preconditions: ["source-ready"],
      effects: ["goal-reached"],
      invariants: ["scope-preserved"],
      evidence_contract: [{ id: "goal-evidence", proves: ["goal-reached"], required: true, proof: "Readback passes" }],
      acceptance: [{ id: "goal-readback", proves: ["goal-reached"], proof: "Goal can be read back" }],
      non_goals: ["Do not expand scope"],
      certainty: "expected",
      on_failure: { action: "replan", scope: "edge:verify-goal" },
      proof: { status: "logical", summary: "The readback establishes the goal", missing: [], evidence_refs: [] },
    }],
    questions: [{
      id: "confirm-milestone",
      prompt: "Do you confirm this milestone?",
      target: { kind: "node", id: "milestone", label: "Milestone ready", purpose: "Confirm the independent state" },
      status: "pending",
      answer_updates: ["wayfinding.nodes.milestone.status"],
    }],
  };
  fs.writeFileSync(target, `${JSON.stringify(draft, null, 2)}\n`, "utf8");

  const candidate = structuredClone(draft);
  candidate.nodes[0].status = "confirmed";
  candidate.edges[0].status = "confirmed";
  fs.writeFileSync(source, `${JSON.stringify(candidate, null, 2)}\n`, "utf8");
  assertExit(runCli(state, "wayfinding-write", "--draft-file", source));
  const persisted = readWayfinding(target).draft;
  assert.equal(persisted.nodes[0].status, "confirmed");
  assert.equal(persisted.edges[0].status, "confirmed");
  assert.equal(persisted.questions[0].status, "pending");
});

test("a draft Intent or open question blocks implementation", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-v04-intent-"));
  const mapPath = makeMap(directory, (blueprint) => {
    blueprint.intent = { statement: "也许写点东西", status: "draft", open_questions: ["真正读者是谁"] };
  });
  const state = path.join(directory, "state.json");
  assertExit(runCli(state, "init", "--map", mapPath));
  const result = runCli(state, "start", "--edge", "settle-audience");
  assertExit(result, 1);
  assert.match(result.stderr, /shaped Intent with no open questions/);

  const shapedDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-v04-decision-"));
  const shapedMap = makeMap(shapedDirectory);
  const shapedState = path.join(shapedDirectory, "state.json");
  assertExit(runCli(shapedState, "init", "--map", shapedMap));
  assertExit(runCli(shapedState, "start", "--edge", "settle-audience", "--actor", "agent:test"));
});

test("legacy route approval is absent and only protected edges require authorization", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-v05-authorization-"));
  const mapPath = makeMap(directory);
  const state = path.join(directory, "state.json");
  assertExit(runCli(state, "init", "--map", mapPath));

  for (const command of ["request-route-approval", "approve"]) {
    const removed = runCli(state, command);
    assertExit(removed, 1);
    assert.match(removed.stderr, new RegExp(`unknown command: ${command}`));
  }
  const unprotectedRequest = requestAuthorization(state, "settle-audience");
  assertExit(unprotectedRequest, 1);
  assert.match(unprotectedRequest.stderr, /has no declared authorization requirement; use start/);

  const briefPath = path.join(directory, "briefs", "settle-audience.md");
  const protectedBrief = fs.readFileSync(briefPath, "utf8").replace("required: []", "required: [human review]");
  fs.writeFileSync(briefPath, protectedBrief, "utf8");
  assertExit(runCli(state, "replan", "--reason", "protect the edge", "--scope", "edge:settle-audience", "--changes", "brief:settle-audience"));
  const directStart = runCli(state, "start", "--edge", "settle-audience");
  assertExit(directStart, 1);
  assert.match(directStart.stderr, /declares an authorization requirement/);

  const requested = requestAuthorization(state, "settle-audience", "May I interview the owner to settle the audience?");
  assertExit(requested);
  const requestId = JSON.parse(requested.stdout).request_id;
  let data = JSON.parse(fs.readFileSync(state, "utf8"));
  assert.equal(data.authorization_requests.at(-1).status, "pending");
  assert.equal(data.authorization_requests.at(-1).decision_owner, "human:owner");
  assert.equal(data.active_run, null);

  assertExit(runCli(
    state,
    "authorize", "--request", requestId,
    "--answer", "Approved for this work only",
    "--actor", "human:owner",
  ));
  data = JSON.parse(fs.readFileSync(state, "utf8"));
  assert.equal(data.authorization_requests.at(-1).status, "granted");
  assert.equal(data.active_edge, "settle-audience");
  assert.equal(data.edge_runs.at(-1).authorization_request, requestId);
  assert.equal(data.decisions.at(-1).authorization_request, requestId);

  assertExit(runCli(state, "cancel", "--reason", "exercise reuse guard"));
  const reused = runCli(
    state,
    "authorize", "--request", requestId,
    "--answer", "Try to reuse the same answer",
    "--actor", "human:owner",
  );
  assertExit(reused, 1);
  assert.match(reused.stderr, /not pending/);
});

test("Work Events create Proposals; confirmation alone changes Facts and events rebuild state", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-v04-proposal-"));
  const mapPath = makeMap(directory);
  const state = path.join(directory, "state.json");
  assertExit(runCli(state, "init", "--map", mapPath));
  assertExit(runCli(
    state, "propose", "--id", "audience-from-interview", "--fact", "audience-known", "--value", "true",
    "--source", "conversation:owner", "--summary", "Owner named the audience", "--strength", "observed",
    "--outcome-ref", "meeting:minutes/audience", "--actor", "human:owner",
  ));
  let data = JSON.parse(fs.readFileSync(state, "utf8"));
  assert.equal(data.facts["audience-known"].value, "unknown");
  assert.equal(data.proposals[0].status, "pending");
  assertExit(runCli(state, "confirm", "--proposal", "audience-from-interview", "--by", "human:owner"));
  data = JSON.parse(fs.readFileSync(state, "utf8"));
  assert.equal(data.facts["audience-known"].value, "true");
  assert.equal(data.facts["audience-known"].evidence.at(-1).strength, "observed");
  assert.equal(data.proposals[0].status, "confirmed");

  assertExit(runCli(
    state, "propose", "--id", "draft-from-tool", "--fact", "article-drafted", "--value", "true",
    "--source", "tool:editor", "--summary", "Editor reported a draft", "--strength", "asserted",
    "--outcome-ref", "document:drafts/article.md", "--actor", "tool:editor",
  ));
  assertExit(runCli(state, "prove"));
  const stale = runCli(state, "confirm", "--proposal", "draft-from-tool", "--by", "human:owner");
  assertExit(stale, 1);
  assert.match(stale.stderr, /base revision is stale/);
  data = JSON.parse(fs.readFileSync(state, "utf8"));
  assert.equal(data.proposals.find((item) => item.id === "draft-from-tool").status, "stale");
  assert.equal(data.facts["article-drafted"].value, "false");

  const eventsPath = path.join(directory, "events.jsonl");
  const before = JSON.parse(fs.readFileSync(state, "utf8"));
  fs.rmSync(state);
  assertExit(runCli(state, "rebuild", "--events", eventsPath));
  const rebuilt = JSON.parse(fs.readFileSync(state, "utf8"));
  assert.equal(rebuilt.event_stream.head_digest, before.event_stream.head_digest);
  assert.deepEqual(rebuilt.proposals, before.proposals);
  assert.equal(rebuilt.facts["audience-known"].value, "true");

  rebuilt.facts["audience-known"].value = "false";
  fs.writeFileSync(state, `${JSON.stringify(rebuilt, null, 2)}\n`, "utf8");
  const projectionTampered = runCli(state, "status");
  assertExit(projectionTampered, 1);
  assert.match(projectionTampered.stderr, /state content does not match the event projection/);
  assertExit(runCli(state, "rebuild", "--events", eventsPath));

  const lines = fs.readFileSync(eventsPath, "utf8").trimEnd().split(/\r?\n/);
  const first = JSON.parse(lines[0]);
  first.data.details.reachability = "tampered";
  lines[0] = JSON.stringify(first);
  fs.writeFileSync(eventsPath, `${lines.join("\n")}\n`, "utf8");
  const tampered = runCli(state, "status");
  assertExit(tampered, 1);
  assert.match(tampered.stderr, /event digest mismatch/);
});

test("Edge Runs expose wait, resume, cancel, retry, and failure replan states", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-v04-run-"));
  const mapPath = makeMap(directory);
  const state = path.join(directory, "state.json");
  assertExit(runCli(state, "init", "--map", mapPath));
  assertExit(approveAndAuthorize(state, "settle-audience", "路线完整且首项可独立执行"));
  let data = JSON.parse(fs.readFileSync(state, "utf8"));
  assert.equal(data.decisions[0].reason, "路线完整且首项可独立执行");
  assert.equal(data.edge_runs[0].status, "active");
  assertExit(runCli(state, "wait", "--reason", "等待 Owner 访谈"));
  data = JSON.parse(fs.readFileSync(state, "utf8"));
  assert.equal(data.edge_runs[0].status, "waiting");
  assert.equal(data.active_edge, null);
  assertExit(runCli(state, "resume", "--run", "settle-audience-run-1", "--reason", "访谈已开始"));
  assertExit(runCli(state, "block", "--reason", "记录缺页"));
  assertExit(runCli(state, "resume", "--run", "settle-audience-run-1", "--reason", "记录已补齐"));
  assertExit(runCli(state, "cancel", "--reason", "改用新的访谈"));
  assertExit(authorizeEdge(state, "settle-audience", "批准重新执行受众确认"));
  const failed = verifyFailure(state, "settle-audience", "访谈没有形成结论");
  assertExit(failed, 1);
  assert.match(failed.stderr, /on_failure replan applied/);
  data = JSON.parse(fs.readFileSync(state, "utf8"));
  assert.equal(data.edge_runs.at(-1).status, "failed");
  assert.equal(data.active_run, null);
  assert.equal(data.phase, "wayfinding");
  assert.equal(data.runtime_status, "needs-replan");
});

test("waiting and blocked runs release the active slot without corrupting another active run", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-v04-dormant-run-"));
  const mapPath = makeMap(directory, (blueprint) => {
    const alternative = structuredClone(blueprint.edges.find((edge) => edge.id === "settle-audience"));
    alternative.id = "interview-audience";
    alternative.brief_ref = "briefs/interview-audience.md";
    blueprint.edges.push(alternative);
  });
  const state = path.join(directory, "state.json");
  assertExit(runCli(state, "init", "--map", mapPath));
  assertExit(approveAndAuthorize(state, "settle-audience", "路线完整，先等待资料"));
  assertExit(runCli(state, "wait", "--reason", "资料尚未到达"));
  assertExit(authorizeEdge(state, "interview-audience", "批准改走可立即执行的访谈"));
  assertExit(runCli(state, "cancel", "--run", "settle-audience-run-1", "--reason", "不再等待资料"));
  let data = JSON.parse(fs.readFileSync(state, "utf8"));
  assert.equal(data.active_edge, "interview-audience");
  assert.equal(data.runtime_status, "running");
  assert.equal(data.edge_runs.find((run) => run.id === "settle-audience-run-1").status, "cancelled");
  assertExit(runCli(state, "cancel", "--reason", "测试完成"));
  data = JSON.parse(fs.readFileSync(state, "utf8"));
  assert.equal(data.runtime_status, "idle");
});

test("a cold board keeps the registered Task Brief when the live Brief changed", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-v04-brief-snapshot-"));
  const mapPath = makeMap(directory);
  const state = path.join(directory, "state.json");
  assertExit(runCli(state, "init", "--map", mapPath));
  const registered = JSON.parse(fs.readFileSync(state, "utf8")).brief_snapshots["settle-audience"].content;
  const briefPath = path.join(directory, "briefs", "settle-audience.md");
  fs.appendFileSync(briefPath, "\nUNREGISTERED BRIEF CHANGE\n", "utf8");
  const reader = createBoardSnapshotReader({ mapPath, statePath: state });
  const snapshot = reader();
  assert.equal(snapshot.model.projection.source_status, "stale");
  const projected = snapshot.model.edges.find((edge) => edge.id === "settle-audience").brief.content;
  assert.equal(projected, registered);
  assert.doesNotMatch(projected, /UNREGISTERED BRIEF CHANGE/);
});

test("a branch failure action waits for fresh authorization before starting the alternative edge", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-v04-branch-"));
  const mapPath = makeMap(directory, (blueprint) => {
    const original = blueprint.edges.find((edge) => edge.id === "settle-audience");
    original.on_failure = { action: "branch", to: "interview-audience" };
    blueprint.edges.push({
      ...structuredClone(original),
      id: "interview-audience",
      brief_ref: "briefs/interview-audience.md",
      on_failure: { action: "replan" },
    });
  });
  const state = path.join(directory, "state.json");
  assertExit(runCli(state, "init", "--map", mapPath));
  assertExit(approveAndAuthorize(state, "settle-audience", "路线完整，先读取已有资料"));
  const failed = verifyFailure(state, "settle-audience", "资料没有明确读者");
  assertExit(failed, 1);
  let data = JSON.parse(fs.readFileSync(state, "utf8"));
  assert.equal(data.edge_runs.find((run) => run.edge === "settle-audience").status, "failed");
  assert.equal(data.active_edge, null);
  assert.equal(data.edge_runs.some((run) => run.edge === "interview-audience"), false);
  assert.equal(data.pending_branch, "interview-audience");
  assert.equal(data.runtime_status, "authorization-required");
  assert.equal(data.history.at(-1).event, "edge_failed_branch_available");
  assertExit(authorizeEdge(state, "interview-audience", "批准执行失败分支"));
  data = JSON.parse(fs.readFileSync(state, "utf8"));
  assert.equal(data.active_edge, "interview-audience");
  assert.equal(data.edge_runs.find((run) => run.edge === "interview-audience").status, "active");
});

test("a parent edge accepts only an arrived child receipt and propagates stale state to the board", async () => {
  const fixture = makeSubmapFixture({ childArrived: false });
  const parentBlueprint = JSON.parse(fs.readFileSync(fixture.parentMap, "utf8"));
  parentBlueprint.submaps[0].on_parent_close = "invalidate";
  fs.writeFileSync(fixture.parentMap, `${JSON.stringify(parentBlueprint, null, 2)}\n`, "utf8");
  assertExit(runCli(fixture.parentState, "init", "--map", fixture.parentMap));
  assertExit(approveAndAuthorize(fixture.parentState, "prepare-campaign", "复杂准备工作由独立子地图验收"));
  const premature = runCli(fixture.parentState, "verify-submap", "--edge", "prepare-campaign", "--executor", "human:owner");
  assertExit(premature, 1);
  assert.match(premature.stderr, /has not completed an arrival audit/);

  const childState = { ...fixture.childState, phase: "arrived", runtime_status: "arrived", arrival_audit: { acceptance: ["public-page-readable", "sensitive-review-recorded"], risks: [], confirm: "fixture audit", recorded_at: "2026-09-03T00:00:00Z", run_id: "publish-article-arrival-1" } };
  fs.writeFileSync(fixture.childStatePath, `${JSON.stringify(childState, null, 2)}\n`, "utf8");
  assertExit(runCli(fixture.parentState, "verify-submap", "--edge", "prepare-campaign", "--executor", "human:owner"));
  let parent = JSON.parse(fs.readFileSync(fixture.parentState, "utf8"));
  assert.equal(parent.facts["campaign-ready"].value, "true");
  assert.equal(parent.edge_runs[0].status, "passed");
  assert.equal(parent.map_receipts.length, 1);
  assert.equal(parent.map_receipts[0].arrival.acceptance[0].id, "public-page-readable");

  const reader = createBoardSnapshotReader({ mapPath: fixture.parentMap, statePath: fixture.parentState });
  let snapshot = reader();
  assert.equal(snapshot.model.submaps[0].receipt_status, "current");
  assert.equal(snapshot.model.edges[0].status, "verified");
  assert.equal(reader.readSubmap("campaign-preparation").model.map.actual_arrival, "audited");

  const server = createBoardServer({ mapPath: fixture.parentMap, statePath: fixture.parentState });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/submaps/campaign-preparation`);
    assert.equal(response.status, 200);
    const childModel = await response.json();
    assert.equal(childModel.projection.binding_id, "campaign-preparation");
    assert.equal(childModel.map.actual_arrival, "audited");
    assert.equal((await fetch(`http://127.0.0.1:${address.port}/api/submaps/campaign-preparation`, { method: "POST" })).status, 405);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  const invalidatingReplan = runCli(fixture.parentState, "replan", "--reason", "try to replace accepted child", "--scope", "observation:receipt-integrity", "--changes", "none");
  assertExit(invalidatingReplan, 1);
  assert.match(invalidatingReplan.stderr, /cannot invalidate accepted submap receipts in place.*initialize a successor parent map/);
  parent = JSON.parse(fs.readFileSync(fixture.parentState, "utf8"));
  assert.equal(parent.phase, "implementation");
  assert.deepEqual(parent.receipt_invalidations, []);

  fs.appendFileSync(fixture.childMap, "\n# changed after receipt\n", "utf8");
  snapshot = reader();
  assert.equal(snapshot.model.submaps[0].source_status, "stale");
  assert.equal(snapshot.model.submaps[0].receipt_status, "stale");
  assert.equal(snapshot.model.edges[0].status, "stale");
  const invalidTree = runCli(fixture.parentState, "validate", "--map", fixture.parentMap);
  assertExit(invalidTree, 1);
  assert.match(invalidTree.stderr, /restore the pinned child version or initialize a successor parent map/);
  const arrivalRequest = runCli(fixture.parentState, "request-arrival-audit", "--question", "May the parent map arrive?");
  assertExit(arrivalRequest, 1);
  assert.match(arrivalRequest.stderr, /submap receipt is stale.*restore the pinned child Blueprint\/state revision or initialize a successor parent map/);
});

test("the board resolves nested submaps by semantic binding path", async () => {
  const fixture = makeSubmapFixture({ childArrived: true });
  const grandDirectory = path.join(fixture.directory, "grandchild");
  fs.cpSync(path.join(ROOT, "templates"), grandDirectory, { recursive: true });
  const grandMap = path.join(grandDirectory, "blueprint.yaml");
  const grandBlueprint = structuredClone(readBlueprint(grandMap).blueprint);
  grandBlueprint.map_id = "publish-article-detail";
  fs.writeFileSync(grandMap, `${JSON.stringify(grandBlueprint, null, 2)}\n`, "utf8");
  const grandLoaded = readBlueprint(grandMap);

  const childBlueprint = structuredClone(readBlueprint(fixture.childMap).blueprint);
  childBlueprint.submaps.push({
    id: "publishing-detail",
    parent_edge: "publish-article",
    map_ref: "../grandchild/blueprint.yaml",
    state_ref: "../grandchild/.mapflow/state.json",
    expected_map_id: grandLoaded.blueprint.map_id,
    expected_map_digest: grandLoaded.digest,
    await: "arrival",
    on_parent_close: "preserve",
    exports: [{
      id: "publishing-detail-export",
      child_acceptance: "public-page-readable",
      child_predicates: ["article-published", "public-url-exists"],
      proves_parent: ["article-published", "public-url-exists"],
    }],
  });
  fs.writeFileSync(fixture.childMap, `${JSON.stringify(childBlueprint, null, 2)}\n`, "utf8");
  const changedChild = readBlueprint(fixture.childMap);
  const childState = JSON.parse(fs.readFileSync(fixture.childStatePath, "utf8"));
  childState.map_digest = changedChild.digest;
  childState.blueprint_snapshot = structuredClone(changedChild.blueprint);
  childState.brief_digests = changedChild.brief_digests;
  fs.writeFileSync(fixture.childStatePath, `${JSON.stringify(childState, null, 2)}\n`, "utf8");

  const parentBlueprint = JSON.parse(fs.readFileSync(fixture.parentMap, "utf8"));
  parentBlueprint.submaps[0].expected_map_digest = changedChild.digest;
  fs.writeFileSync(fixture.parentMap, `${JSON.stringify(parentBlueprint, null, 2)}\n`, "utf8");
  assertExit(runCli(fixture.parentState, "init", "--map", fixture.parentMap));

  const reader = createBoardSnapshotReader({ mapPath: fixture.parentMap, statePath: fixture.parentState });
  const child = reader.readSubmap("campaign-preparation").model;
  assert.equal(child.submaps[0].path, "campaign-preparation/publishing-detail");
  const grandchild = reader.readSubmap("campaign-preparation/publishing-detail").model;
  assert.equal(grandchild.map.id, grandLoaded.blueprint.map_id);
  assert.equal(grandchild.projection.binding_path, "campaign-preparation/publishing-detail");

  const server = createBoardServer({ mapPath: fixture.parentMap, statePath: fixture.parentState });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/submaps/campaign-preparation/publishing-detail`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).projection.binding_path, "campaign-preparation/publishing-detail");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("project-local installation is rejected without touching the target workspace", () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-target-"));
  const agents = path.join(target, "AGENTS.md");
  fs.writeFileSync(agents, "# project rules\n", "utf8");
  const before = fs.readdirSync(target).sort();
  const result = runInstaller(target, "--profile", "core");
  assertExit(result, 1);
  assert.match(result.stderr, /--target is no longer supported/);
  assert.equal(fs.readFileSync(agents, "utf8"), "# project rules\n");
  assert.deepEqual(fs.readdirSync(target).sort(), before);
  assert.equal(fs.existsSync(path.join(target, ".mapflow")), false);
});

test("global installer provides explicit-enable runtime and keeps workspace state outside Git", async () => {
  const userProfile = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-global-"));
  const globalRoot = path.join(userProfile, ".agents", "skills");
  assertExit(runGlobalInstaller(userProfile));
  const installedRoot = path.join(globalRoot, "mapflow");
  const runtime = path.join(installedRoot, "runtime", "mapflow.mjs");
  assert.ok(fs.existsSync(path.join(globalRoot, "mapflow", "SKILL.md")));
  assert.ok(fs.existsSync(path.join(globalRoot, "mapflow", "references", "workflow.md")));
  assert.ok(fs.existsSync(path.join(globalRoot, "mapflow", "references", "blueprint", "map-model.md")));
  assert.ok(fs.existsSync(path.join(globalRoot, "mapflow", "references", "integration", "enterprise-handoffs.md")));
  assert.ok(fs.existsSync(path.join(globalRoot, "mapflow", "references", "skill-routing.md")));
  assert.ok(fs.existsSync(path.join(globalRoot, "mapflow", "skills", "edge-slicing", "SKILL.md")));
  assert.ok(fs.existsSync(path.join(globalRoot, "mapflow", "skills", "edge-delivery", "SKILL.md")));
  assert.ok(fs.existsSync(runtime));
  assert.ok(fs.existsSync(path.join(installedRoot, "runtime", "mapflow-workspace.mjs")));
  assert.equal(fs.existsSync(path.join(installedRoot, "runtime", "mapflow-sdlc.mjs")), false);
  assert.equal(fs.existsSync(path.join(installedRoot, "runtime", "mapflow-activity.mjs")), false);
  assert.ok(fs.existsSync(path.join(installedRoot, "runtime", "mapflow-wayfinding.mjs")));
  assert.ok(fs.existsSync(path.join(installedRoot, "runtime", "board", "index.html")));
  assert.ok(fs.existsSync(path.join(installedRoot, "runtime", "vendor", "js-yaml", "js-yaml.mjs")));
  assert.ok(fs.existsSync(path.join(installedRoot, "runtime", "vendor", "cytoscape", "cytoscape.min.js")));
  assert.ok(fs.existsSync(path.join(installedRoot, "templates", "task-brief.md")));
  assert.match(
    fs.readFileSync(path.join(installedRoot, "examples", "community-workshop", "README.md"), "utf8"),
    /node <mapflow-package>\/runtime\/mapflow\.mjs/,
  );
  const entry = fs.readFileSync(path.join(globalRoot, "mapflow", "SKILL.md"), "utf8");
  assert.match(entry, /行为真源：`references\/workflow\.md`/);
  assert.match(entry, /运行时：`runtime\/mapflow\.mjs`/);
  assert.match(entry, /enable --root <当前工作目录> --json/);
  assert.match(entry, /服务人的仓库外 sidecar/);
  assert.doesNotMatch(entry, /node \.mapflow\/mapflow\.mjs/);
  assert.match(entry, /内含 Skill：`skills\/<name>\/SKILL\.md`/);
  assert.doesNotMatch(entry, /`\.\.\/<name>\/SKILL\.md`/);
  assert.match(fs.readFileSync(path.join(globalRoot, "mapflow", "agents", "openai.yaml"), "utf8"), /allow_implicit_invocation: false/);
  assert.doesNotMatch(fs.readFileSync(path.join(globalRoot, "mapflow", "agents", "openai.yaml"), "utf8"), /allow_implicit_invocation: true/);
  assert.match(entry, /disable-model-invocation: true/);
  const globalManifest = JSON.parse(fs.readFileSync(path.join(globalRoot, "mapflow", "install-manifest.json"), "utf8"));
  assert.equal(globalManifest.version, "0.8.0");
  assert.equal(globalManifest.runtime, "mapflow/runtime/mapflow.mjs");
  assert.equal(globalManifest.workspace_schema, "mapflow.workspace/v1");
  assert.ok(globalManifest.capabilities.includes("workspace-sidecar"));
  assert.ok(globalManifest.capabilities.includes("causal-contracts"));
  assert.ok(globalManifest.capabilities.includes("derivation-graph"));
  assert.ok(globalManifest.capabilities.includes("enterprise-handoff-contract"));
  assert.ok(globalManifest.capabilities.includes("progressive-context-disclosure"));
  assert.ok(globalManifest.capabilities.includes("explicit-enable"));
  assert.ok(!globalManifest.capabilities.includes("auto-enable"));
  assert.ok(globalManifest.capabilities.includes("arrival-audit-request"));
  assert.ok(globalManifest.capabilities.includes("evolution-playback"));
  assert.equal(globalManifest.wayfinding_event_schema, "mapflow.wayfinding-event/v1");
  assert.ok(fs.existsSync(path.join(installedRoot, "runtime", "mapflow-evolution.mjs")));

  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-consumer-"));
  assertExit(spawnSync("git", ["init", "--quiet", workspace], { encoding: "utf8", windowsHide: true }));
  fs.writeFileSync(path.join(workspace, "project.txt"), "project-owned\n", "utf8");
  const workspaceBefore = fs.readdirSync(workspace).sort();
  const gitStatusBefore = spawnSync("git", ["-C", workspace, "status", "--short"], { encoding: "utf8", windowsHide: true }).stdout;
  const mapflowHome = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-sidecars-"));
  const enableArgs = ["enable", "--root", workspace, "--mapflow-home", mapflowHome, "--json"];
  const firstEnable = spawnSync(process.execPath, [runtime, ...enableArgs], { cwd: workspace, encoding: "utf8" });
  assertExit(firstEnable);
  const enabled = JSON.parse(firstEnable.stdout);
  assert.equal(enabled.created, true);
  assert.equal(enabled.wayfinding_exists, true);
  assert.equal(enabled.wayfinding_initialized, true);
  assert.deepEqual(enabled.formal_topology, { present: false, nodes: 0, edges: 0 });
  assert.equal(enabled.wayfinding.phase, "survey");
  assert.equal(enabled.wayfinding.draft_nodes, 2);
  assert.equal(enabled.wayfinding.draft_edges, 0);
  assert.equal(enabled.wayfinding.current_question.target.id, "workspace-origin-fog");
  const initialWayfinding = readWayfinding(enabled.paths.wayfinding).draft;
  assert.equal(initialWayfinding.origin.kind, "fog");
  assert.equal(initialWayfinding.destination.kind, "fog");
  assert.equal(initialWayfinding.questions.filter((question) => question.status === "pending").length, 1);
  assert.equal(path.relative(workspace, enabled.sidecar).startsWith(".."), true);
  assert.equal(fs.existsSync(path.join(workspace, ".mapflow")), false);
  const secondEnable = spawnSync(process.execPath, [runtime, ...enableArgs], { cwd: workspace, encoding: "utf8" });
  assertExit(secondEnable);
  assert.equal(JSON.parse(secondEnable.stdout).created, false);
  assert.equal(JSON.parse(secondEnable.stdout).sidecar, enabled.sidecar);
  assert.equal(JSON.parse(secondEnable.stdout).wayfinding_initialized, false);

  fs.copyFileSync(path.join(installedRoot, "templates", "blueprint.yaml"), enabled.paths.map);
  fs.cpSync(path.join(installedRoot, "templates", "briefs"), enabled.paths.briefs, { recursive: true });
  const init = spawnSync(process.execPath, [
    runtime, "init", "--root", workspace, "--mapflow-home", mapflowHome,
  ], { cwd: workspace, encoding: "utf8" });
  assertExit(init);
  assert.ok(fs.existsSync(enabled.paths.state));
  assert.ok(fs.existsSync(enabled.paths.events));
  const status = spawnSync(process.execPath, [
    runtime, "status", "--root", workspace, "--mapflow-home", mapflowHome, "--json",
  ], { cwd: workspace, encoding: "utf8" });
  assertExit(status);
  assert.equal(JSON.parse(status.stdout).map_id, "publish-article");
  assert.deepEqual(fs.readdirSync(workspace).sort(), workspaceBefore);
  const gitStatusAfter = spawnSync("git", ["-C", workspace, "status", "--short"], { encoding: "utf8", windowsHide: true }).stdout;
  assert.equal(gitStatusAfter, gitStatusBefore);

  const installedBoardModule = await import(`${pathToFileURL(path.join(installedRoot, "runtime", "mapflow-board.mjs")).href}?test=${Date.now()}`);
  const boardServer = installedBoardModule.createBoardServer({ mapPath: enabled.paths.map, statePath: enabled.paths.state });
  await new Promise((resolve, reject) => {
    boardServer.once("error", reject);
    boardServer.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = boardServer.address();
    const boardBase = `http://127.0.0.1:${address.port}`;
    assert.equal((await fetch(`${boardBase}/api/board`)).status, 200);
    assert.equal((await fetch(`${boardBase}/app.js`)).status, 200);
    assert.equal((await fetch(`${boardBase}/vendor/cytoscape.min.js`)).status, 200);
  } finally {
    await new Promise((resolve) => boardServer.close(resolve));
  }

  assertExit(runGlobalInstaller(userProfile), 1);
  fs.mkdirSync(path.join(globalRoot, "mapflow", "skills", "node-slicing"), { recursive: true });
  fs.writeFileSync(path.join(globalRoot, "mapflow", "skills", "node-slicing", "SKILL.md"), "obsolete\n", "utf8");
  fs.writeFileSync(path.join(globalRoot, "mapflow", "references", "blueprint.md"), "obsolete\n", "utf8");
  fs.writeFileSync(
    path.join(globalRoot, "mapflow", "examples", "library-system-evolution", "briefs", "removed-brief.md"),
    "obsolete\n",
    "utf8",
  );
  assertExit(runGlobalInstaller(userProfile, "--force"));
  assert.equal(fs.existsSync(path.join(globalRoot, "mapflow", "skills", "node-slicing")), false);
  assert.equal(fs.existsSync(path.join(globalRoot, "mapflow", "references", "blueprint.md")), false);
  assert.equal(
    fs.existsSync(path.join(globalRoot, "mapflow", "examples", "library-system-evolution", "briefs", "removed-brief.md")),
    false,
  );
  assert.deepEqual(
    fs.readdirSync(globalRoot).filter((entry) => entry.startsWith(".mapflow-install-") || entry.startsWith(".mapflow-backup-")),
    [],
  );
});
