import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { proveBlueprint, readBlueprint, validateBlueprint } from "../tools/mapflow-core.mjs";
import { createBoardSnapshotReader } from "../tools/mapflow-board-core.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const CLI = path.join(ROOT, "tools", "mapflow.mjs");
const TEMPLATE = path.join(ROOT, "templates", "blueprint.yaml");

function run(state, ...args) {
  return spawnSync(process.execPath, [CLI, "--state", state, ...args], {
    cwd: ROOT,
    encoding: "utf8",
  });
}

function assertExit(result, expected = 0) {
  assert.equal(result.status, expected, result.stderr || result.stdout);
}

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-core-contract-"));
  fs.cpSync(path.join(ROOT, "templates"), directory, { recursive: true });
  return {
    directory,
    map: path.join(directory, "blueprint.yaml"),
    state: path.join(directory, "state.json"),
  };
}

test("the default product surface contains only the destination-derived causal flow", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.version, "0.9.2");
  for (const removed of ["tools/mapflow-activity.mjs", "tools/mapflow-sdlc.mjs", "tests/test_activity.mjs", "tests/test_sdlc.mjs", "examples/ai-native-sdlc"]) {
    assert.equal(fs.existsSync(path.join(ROOT, removed)), false, `${removed} must stay outside the default product`);
  }

  const help = spawnSync(process.execPath, [CLI, "--help"], { cwd: ROOT, encoding: "utf8" });
  assertExit(help);
  assert.match(help.stdout, /prove\s+regress from Destination and build the forward derivation graph/);
  assert.match(help.stdout, /context\s+disclose bounded context/);
  assert.match(help.stdout, /start\s+activate one proven ready edge/);
  assert.doesNotMatch(help.stdout, /request-route-approval|\bobserve\b|sdlc/i);

  for (const relative of ["README.md", "skills/mapflow/SKILL.md", "skills/blueprint-planning/SKILL.md", "skills/edge-delivery/SKILL.md", "docs/skill-routing.md"]) {
    const content = fs.readFileSync(path.join(ROOT, relative), "utf8");
    assert.doesNotMatch(content, /request-route-approval|assign-decision-owner.*route|AI-Native SDLC|mapflow\.sdlc|activity\.jsonl/i, relative);
  }
});

test("schema 3 requires explicit causal rules and rejects fixed lifecycle fields", () => {
  const { blueprint } = readBlueprint(TEMPLATE);
  assert.equal(blueprint.schema_version, 3);
  assert.ok(blueprint.edges.every((edge) => (
    edge.causal_contract?.rule_basis
    && edge.causal_contract.required_witnesses?.length > 0
    && edge.causal_contract.conclusions.join("\0") === edge.effects.join("\0")
  )));
  const first = proveBlueprint(blueprint);
  const second = proveBlueprint(structuredClone(blueprint));
  assert.equal(first.structural, "complete");
  assert.equal(first.derivation_graph.digest, second.derivation_graph.digest);

  const workflow = structuredClone(blueprint);
  workflow.workflow = { profile: "fixed-lifecycle" };
  assert.throws(() => validateBlueprint(workflow), /workflow profiles are not part of Mapflow schema 3/);

  const staged = structuredClone(blueprint);
  staged.edges[0].sdlc_stage = "build";
  assert.throws(() => validateBlueprint(staged), /sdlc_stage is not part of Mapflow schema 3/);

  const continuous = structuredClone(blueprint);
  continuous.continuity = {
    predecessor: {
      checkpoint: "publish-article-arrival-checkpoint-1",
      receipt_digest: "a".repeat(64),
    },
    origin_node: "article-live",
    imported_predicates: [...blueprint.destination.requires],
    revalidate: ["article-published"],
  };
  assert.doesNotThrow(() => validateBlueprint(continuous));

  const unknownImport = structuredClone(continuous);
  unknownImport.continuity.imported_predicates.push("not-a-predicate");
  assert.throws(() => validateBlueprint(unknownImport), /continuity.imported_predicates references unknown id/);

  const unrelatedRevalidation = structuredClone(continuous);
  unrelatedRevalidation.continuity.revalidate = ["owner-approved"];
  assert.throws(() => validateBlueprint(unrelatedRevalidation), /continuity.revalidate must be imported/);
});

test("Task Briefs expose compact role handoffs and bounded disclosure contracts", () => {
  const loaded = readBlueprint(TEMPLATE);
  for (const edge of loaded.blueprint.edges) {
    const contract = loaded.briefs[edge.id].metadata.contract;
    assert.deepEqual(Object.keys(contract.handoff), ["from_roles", "to_roles", "inputs", "outputs", "decision_rights"]);
    assert.ok(contract.context.focus.length > 0);
    assert.ok(contract.context.load_first.length <= 5);
    assert.ok(contract.context.load_first.length <= contract.context.budget.max_files);
    assert.ok(contract.context.load_on_demand.every((item) => item.when && item.refs.length));
  }
  const reference = fs.readFileSync(path.join(ROOT, "docs", "integration", "enterprise-handoffs.md"), "utf8");
  assert.match(reference, /不(?:是|建立)团队协作空间/);
  assert.match(reference, /Git\/PR 平台/);
  assert.match(reference, /max_files\/max_chars/);

  const evolution = readBlueprint(path.join(ROOT, "examples", "library-system-evolution", "blueprint.yaml"));
  assert.equal(evolution.blueprint.schema_version, 3);
  assert.ok(evolution.blueprint.edges.every((edge) => edge.causal_contract?.required_witnesses?.length > 0));
  const authorizationShapes = new Set();
  for (const edge of evolution.blueprint.edges) {
    const contract = evolution.briefs[edge.id].metadata.contract;
    assert.ok(contract.handoff?.inputs?.length > 0, edge.id);
    assert.ok(contract.handoff?.outputs?.length > 0, edge.id);
    assert.ok(contract.context?.focus, edge.id);
    assert.ok(contract.context.load_first.length <= contract.context.budget.max_files, edge.id);
    authorizationShapes.add(contract.authorization.required.length > 0 ? "protected" : "direct");
  }
  assert.deepEqual([...authorizationShapes].sort(), ["direct", "protected"]);
});

test("active benchmark contracts exercise map proof without a route-approval lifecycle", () => {
  const cases = path.join(ROOT, "benchmarks", "cases");
  for (const caseName of fs.readdirSync(cases)) {
    const oraclePath = path.join(cases, caseName, "oracle", "checkpoints.json");
    if (!fs.existsSync(oraclePath)) continue;
    const oracle = fs.readFileSync(oraclePath, "utf8");
    assert.doesNotMatch(oracle, /route[_-]approval|current_route|route-approved|route-proven/i, caseName);
  }
});

test("context disclosure starts with Focus and opens Work, Evidence, and History separately", () => {
  const sample = fixture();
  assertExit(run(sample.state, "init", "--map", sample.map));
  const layers = Object.fromEntries(["focus", "work", "evidence", "history"].map((layer) => {
    const result = run(sample.state, "context", "--layer", layer, "--json");
    assertExit(result);
    return [layer, JSON.parse(result.stdout)];
  }));

  assert.equal(layers.focus.focus.edge, "settle-audience");
  assert.ok(layers.focus.focus.handoff);
  assert.ok(layers.focus.focus.context);
  assert.equal(layers.focus.work, undefined);
  assert.equal(layers.focus.evidence, undefined);
  assert.equal(layers.focus.history, undefined);
  assert.equal(layers.work.work.edge.id, "settle-audience");
  assert.ok(layers.evidence.evidence.records);
  assert.ok(layers.history.history.length > 0);
  for (const pack of Object.values(layers)) {
    assert.equal(pack.budget.within_budget, true);
    assert.ok(pack.budget.included_chars <= pack.budget.max_chars);
  }

  const board = createBoardSnapshotReader({ mapPath: sample.map, statePath: sample.state })().model;
  assert.deepEqual(Object.keys(board.evidence_levels), [
    "structural_soundness",
    "declared_model_derivability",
    "runtime_readiness",
    "executed_derivation",
    "audited_arrival",
  ]);
  const edge = board.edges.find((item) => item.id === "settle-audience");
  assert.ok(edge.brief.metadata.contract.handoff);
  assert.ok(edge.brief.metadata.contract.context);
});
