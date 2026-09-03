import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { proveBlueprint, readBlueprint } from "../tools/mapflow-core.mjs";

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
  const mapPath = path.join(directory, "blueprint.yaml");
  fs.writeFileSync(mapPath, `${JSON.stringify(blueprint, null, 2)}\n`, "utf8");
  for (const edge of blueprint.edges) {
    const briefPath = path.resolve(directory, edge.brief_ref);
    fs.mkdirSync(path.dirname(briefPath), { recursive: true });
    if (!fs.existsSync(briefPath)) fs.writeFileSync(
      briefPath,
      `---\nedge: ${edge.id}\ncontract:\n  scope:\n    in: [test fixture for ${edge.id}]\n    out: [all unrelated work]\n  authorization:\n    required: []\n    allowed_actions: [local test fixture]\n  evidence:\n    proves: [${edge.effects.join(", ")}]\n    exit_conditions: [fixture effects are observable]\n  failure:\n    action: ${edge.on_failure.action}\n    rollback: [discard temporary fixture]\n---\n\n# ${edge.id}\n`,
      "utf8",
    );
  }
  return mapPath;
}

function verify(state, edge, proves, acceptance = "", outcomeRef = "") {
  const args = [
    "verify", "--edge", edge,
    "--evidence", `${edge} evidence`,
    "--command", `check ${edge}`,
    "--observed", `${edge} observed`,
    "--proves", proves,
    "--executor", "agent:codex",
    "--model", "gpt-5.6-sol",
    "--reasoning", "high",
  ];
  if (acceptance) args.push("--acceptance", acceptance);
  if (outcomeRef) args.push("--outcome-ref", outcomeRef);
  return runCli(state, ...args);
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

test("a ready dead-end edge cannot be approved when it is not on a destination-reaching route", () => {
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
  const result = runCli(state, "approve", "--edge", "take-dead-route");
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

test("edge evidence drives facts, satisfied nodes, and arrival", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-v03-"));
  const mapPath = makeMap(directory);
  const state = path.join(directory, "state.json");

  assertExit(runCli(state, "init", "--map", mapPath));
  assertExit(runCli(state, "gate"), 1);
  assertExit(runCli(state, "approve", "--edge", "settle-audience"));
  assertExit(runCli(state, "gate"));
  assertExit(verify(state, "settle-audience", "audience-known"));
  assertExit(runCli(state, "select", "--edge", "write-candidate"));
  assertExit(verify(state, "write-candidate", "article-drafted,sensitive-content-checked", "sensitive-review-recorded"));
  assertExit(runCli(state, "select", "--edge", "obtain-owner-approval"));
  assertExit(verify(state, "obtain-owner-approval", "owner-approved"));
  assertExit(runCli(state, "select", "--edge", "publish-article"));
  assertExit(verify(state, "publish-article", "article-published,public-url-exists", "public-page-readable", "external:https://example.invalid/article"));
  assertExit(runCli(state, "arrive", "--confirm", "wrong acceptance", "--acceptance", "public-page-readable"), 1);
  assertExit(runCli(
    state,
    "arrive", "--confirm", "destination and acceptance evidence audited",
    "--acceptance", "public-page-readable,sensitive-review-recorded",
    "--non-goals", "automatic audience choice",
    "--risks", "none",
  ));

  const data = JSON.parse(fs.readFileSync(state, "utf8"));
  assert.equal(data.phase, "arrived");
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

test("unverified evidence cannot apply edge effects", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-v03-unverified-"));
  const mapPath = makeMap(directory);
  const state = path.join(directory, "state.json");
  assertExit(runCli(state, "init", "--map", mapPath));
  assertExit(runCli(state, "approve", "--edge", "settle-audience"));
  const result = runCli(
    state,
    "verify", "--edge", "settle-audience",
    "--evidence", "not actually checked",
    "--command", "not run",
    "--observed", "unknown",
    "--proves", "audience-known",
    "--unverified", "audience decision",
    "--executor", "agent:codex",
    "--model", "gpt-5.6-sol",
    "--reasoning", "high",
  );
  assertExit(result, 1);
  const data = JSON.parse(fs.readFileSync(state, "utf8"));
  assert.equal(data.facts["audience-known"].value, "unknown");
  assert.deepEqual(data.verified_edges, []);
  assert.equal(data.active_edge, "settle-audience");
  assert.equal(data.evidence.length, 1);
});

test("human work can produce evidence without agent metadata", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-v03-human-evidence-"));
  const mapPath = makeMap(directory);
  const state = path.join(directory, "state.json");
  assertExit(runCli(state, "init", "--map", mapPath));
  assertExit(runCli(state, "approve", "--edge", "settle-audience"));
  const result = runCli(
    state,
    "verify", "--edge", "settle-audience",
    "--evidence", "owner confirmed the intended audience in meeting minutes",
    "--command", "read meeting minutes",
    "--observed", "audience is explicitly named",
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
  assertExit(runCli(state, "approve", "--edge", "advance-loop"));
  assertExit(verify(state, "advance-loop", "loop-progress"));
  assertExit(runCli(state, "select", "--edge", "advance-loop"));
  assertExit(verify(state, "advance-loop", "loop-progress"));
  const exhausted = runCli(state, "select", "--edge", "advance-loop");
  assertExit(exhausted, 1);
  assert.match(exhausted.stderr, /loop budget exhausted/);
  assert.equal(JSON.parse(fs.readFileSync(state, "utf8")).loop_iterations["bounded-loop"], 2);
});

test("map changes after approval block the write gate", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-v03-digest-"));
  const mapPath = makeMap(directory);
  const state = path.join(directory, "state.json");
  assertExit(runCli(state, "init", "--map", mapPath));
  assertExit(runCli(state, "approve", "--edge", "settle-audience"));
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
  assertExit(runCli(state, "approve", "--edge", "settle-audience"));
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
  assertExit(runCli(state, "approve", "--edge", "settle-audience"));
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
  assertExit(runCli(state, "approve", "--edge", "settle-audience"));
  assertExit(verify(state, "settle-audience", "audience-known"));
  const changed = JSON.parse(fs.readFileSync(mapPath, "utf8"));
  changed.edges.find((edge) => edge.id === "settle-audience").certainty = "conditional";
  fs.writeFileSync(mapPath, `${JSON.stringify(changed, null, 2)}\n`, "utf8");
  const result = runCli(
    state,
    "replan", "--reason", "try redefining completed work", "--scope", "edge:settle-audience", "--changes", "edge:settle-audience",
  );
  assertExit(result, 1);
  assert.match(result.stderr, /verified edge contract cannot be removed or redefined/);
});

test("replan cannot reinterpret predicates referenced by a verified edge", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-v03-replan-predicate-contract-"));
  const mapPath = makeMap(directory);
  const state = path.join(directory, "state.json");
  assertExit(runCli(state, "init", "--map", mapPath));
  assertExit(runCli(state, "approve", "--edge", "settle-audience"));
  assertExit(verify(state, "settle-audience", "audience-known"));
  const changed = JSON.parse(fs.readFileSync(mapPath, "utf8"));
  changed.predicates.find((predicate) => predicate.id === "audience-known").fact = "source-exists";
  fs.writeFileSync(mapPath, `${JSON.stringify(changed, null, 2)}\n`, "utf8");
  const result = runCli(
    state,
    "replan", "--reason", "try reinterpreting completed evidence", "--scope", "predicate:audience-known", "--changes", "predicate:audience-known",
  );
  assertExit(result, 1);
  assert.match(result.stderr, /verified edge contract cannot be removed or redefined/);
});

test("replan cannot change a destination invariant applicable to a verified edge", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-v03-replan-destination-invariant-"));
  const mapPath = makeMap(directory);
  const state = path.join(directory, "state.json");
  assertExit(runCli(state, "init", "--map", mapPath));
  assertExit(runCli(state, "approve", "--edge", "settle-audience"));
  assertExit(verify(state, "settle-audience", "audience-known"));
  const changed = JSON.parse(fs.readFileSync(mapPath, "utf8"));
  changed.invariants.find((invariant) => invariant.id === "approval-before-publish").applies_to.push("settle-audience");
  fs.writeFileSync(mapPath, `${JSON.stringify(changed, null, 2)}\n`, "utf8");
  const result = runCli(
    state,
    "replan", "--reason", "try changing completed execution conditions", "--scope", "destination:approval-before-publish", "--changes", "invariant:approval-before-publish",
  );
  assertExit(result, 1);
  assert.match(result.stderr, /verified edge contract cannot be removed or redefined/);
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

test("prove and approve cannot accept edits made after a bounded replan", () => {
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
  const approval = runCli(state, "approve", "--edge", "settle-audience");
  assertExit(approval, 1);
  assert.match(approval.stderr, /Blueprint or bound Task Brief changed/);
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
  assertExit(runCli(state, "approve", "--edge", "settle-audience"));
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

test("installer creates a self-contained v0.3 runtime without touching AGENTS.md", async () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-target-"));
  const agents = path.join(target, "AGENTS.md");
  fs.writeFileSync(agents, "# project rules\n", "utf8");
  assertExit(runInstaller(target, "--profile", "core"));
  assert.equal(fs.readFileSync(agents, "utf8"), "# project rules\n");
  assert.ok(fs.existsSync(path.join(target, ".mapflow", "mapflow.mjs")));
  assert.ok(fs.existsSync(path.join(target, ".mapflow", "mapflow-core.mjs")));
  assert.ok(fs.existsSync(path.join(target, ".mapflow", "mapflow-board.mjs")));
  assert.ok(fs.existsSync(path.join(target, ".mapflow", "mapflow-board-core.mjs")));
  assert.ok(fs.existsSync(path.join(target, ".mapflow", "board", "index.html")));
  assert.ok(fs.existsSync(path.join(target, ".mapflow", "board", "app.js")));
  assert.ok(fs.existsSync(path.join(target, ".mapflow", "vendor", "js-yaml", "js-yaml.mjs")));
  assert.ok(fs.existsSync(path.join(target, ".mapflow", "vendor", "cytoscape", "cytoscape.min.js")));
  assert.ok(fs.existsSync(path.join(target, ".mapflow", "templates", "task-brief.md")));
  assert.ok(fs.existsSync(path.join(target, ".mapflow", "templates", "briefs", "publish-article.md")));
  assert.equal(fs.existsSync(path.join(target, ".mapflow", "templates", "work-item.md")), false);
  const installedWorkflow = fs.readFileSync(path.join(target, ".mapflow", "workflow.md"), "utf8");
  assert.match(installedWorkflow, /\.mapflow\/templates\/task-brief\.md/);
  assert.match(installedWorkflow, /active_edge/);
  assert.ok(fs.existsSync(path.join(target, ".agents", "skills", "edge-delivery", "SKILL.md")));
  assert.match(
    fs.readFileSync(path.join(target, ".agents", "skills", "mapflow", "SKILL.md"), "utf8"),
    /相邻 Skill：`\.\.\/<name>\/SKILL\.md`/,
  );
  assert.equal(fs.existsSync(path.join(target, ".agents", "skills", "node-delivery")), false);
  const manifest = JSON.parse(fs.readFileSync(path.join(target, ".mapflow", "install-manifest.json"), "utf8"));
  assert.equal(manifest.version, "0.3.0");
  const installedInit = spawnSync(process.execPath, [
    path.join(target, ".mapflow", "mapflow.mjs"),
    "init", "--map", path.join(target, ".mapflow", "templates", "blueprint.yaml"),
  ], { cwd: target, encoding: "utf8" });
  assertExit(installedInit);
  assert.ok(fs.existsSync(path.join(target, ".mapflow", "state.json")));
  const installedBoardModule = await import(`${pathToFileURL(path.join(target, ".mapflow", "mapflow-board.mjs")).href}?test=${Date.now()}`);
  const boardServer = installedBoardModule.createBoardServer({
    mapPath: path.join(target, ".mapflow", "templates", "blueprint.yaml"),
  });
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
  assertExit(runInstaller(target), 1);
  fs.mkdirSync(path.join(target, ".agents", "skills", "node-delivery"), { recursive: true });
  fs.writeFileSync(path.join(target, ".agents", "skills", "node-delivery", "SKILL.md"), "obsolete\n", "utf8");
  fs.writeFileSync(path.join(target, ".mapflow", "templates", "work-item.md"), "obsolete\n", "utf8");
  assertExit(runInstaller(target, "--force"));
  assert.equal(fs.existsSync(path.join(target, ".agents", "skills", "node-delivery")), false);
  assert.equal(fs.existsSync(path.join(target, ".mapflow", "templates", "work-item.md")), false);
});

test("global installer preserves the user-authored entry behavior and installs edge skills", () => {
  const userProfile = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-global-"));
  const globalRoot = path.join(userProfile, ".agents", "skills");
  assertExit(runGlobalInstaller(userProfile));
  assert.ok(fs.existsSync(path.join(globalRoot, "mapflow", "SKILL.md")));
  assert.ok(fs.existsSync(path.join(globalRoot, "mapflow", "references", "workflow.md")));
  assert.ok(fs.existsSync(path.join(globalRoot, "mapflow", "references", "blueprint.md")));
  assert.ok(fs.existsSync(path.join(globalRoot, "mapflow", "references", "skill-routing.md")));
  assert.ok(fs.existsSync(path.join(globalRoot, "mapflow", "skills", "edge-slicing", "SKILL.md")));
  assert.ok(fs.existsSync(path.join(globalRoot, "mapflow", "skills", "edge-delivery", "SKILL.md")));
  const entry = fs.readFileSync(path.join(globalRoot, "mapflow", "SKILL.md"), "utf8");
  assert.match(entry, /全局包：`references\/workflow\.md`/);
  assert.match(entry, /项目状态：`\.mapflow\/state\.json`/);
  assert.match(entry, /内含 Skill：`skills\/<name>\/SKILL\.md`/);
  assert.doesNotMatch(entry, /`\.\.\/<name>\/SKILL\.md`/);
  assert.match(fs.readFileSync(path.join(globalRoot, "mapflow", "agents", "openai.yaml"), "utf8"), /allow_implicit_invocation: true/);
  const globalManifest = JSON.parse(fs.readFileSync(path.join(globalRoot, "mapflow", "install-manifest.json"), "utf8"));
  assert.equal(globalManifest.runtime, "project-local:.mapflow/mapflow.mjs");
  assertExit(runGlobalInstaller(userProfile), 1);
  fs.mkdirSync(path.join(globalRoot, "mapflow", "skills", "node-slicing"), { recursive: true });
  fs.writeFileSync(path.join(globalRoot, "mapflow", "skills", "node-slicing", "SKILL.md"), "obsolete\n", "utf8");
  assertExit(runGlobalInstaller(userProfile, "--force"));
  assert.equal(fs.existsSync(path.join(globalRoot, "mapflow", "skills", "node-slicing")), false);
});
