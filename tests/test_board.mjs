import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { compileBoardModel, createBoardSnapshotReader } from "../tools/mapflow-board-core.mjs";
import { createBoardServer } from "../tools/mapflow-board.mjs";
import { selectElementIds, topologySignature } from "../tools/board/app.js";
import { initialFacts, proveBlueprint, readBlueprint } from "../tools/mapflow-core.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const TEMPLATE_MAP = path.join(ROOT, "templates", "blueprint.yaml");

function copyTemplate() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-board-"));
  fs.cpSync(path.join(ROOT, "templates"), directory, { recursive: true });
  return { directory, mapPath: path.join(directory, "blueprint.yaml") };
}

function runtimeState(loaded, mapPath) {
  const facts = initialFacts(loaded.blueprint);
  return {
    schema: 2,
    phase: "wayfinding",
    destination_status: "draft",
    map: path.basename(mapPath),
    map_digest: loaded.digest,
    map_id: loaded.blueprint.map_id,
    active_edge: null,
    verified_edges: [],
    verified_edge_contracts: {},
    blueprint_snapshot: structuredClone(loaded.blueprint),
    brief_digests: loaded.brief_digests,
    loop_iterations: {},
    facts,
    satisfied_nodes: [],
    last_proof: proveBlueprint(loaded.blueprint, facts),
    evidence: [],
    updated_at: "2026-09-03T00:00:00Z",
    history: [],
  };
}

test("BoardModel preserves proof, fog, route, Brief, and acceptance semantics", () => {
  const loaded = readBlueprint(TEMPLATE_MAP);
  const model = compileBoardModel({
    blueprint: loaded.blueprint,
    digest: loaded.digest,
    briefs: loaded.briefs,
  });

  assert.equal(model.projection.read_only, true);
  assert.equal(model.map.actual_arrival, "not-audited");
  assert.equal(model.summary.structural, "complete");
  assert.equal(model.summary.reachability, "conditional");
  assert.equal(model.predicates.length, loaded.blueprint.predicates.length);
  assert.equal(model.nodes.find((node) => node.kind === "fog").status, "fog");
  const firstEdge = model.edges.find((edge) => edge.id === "settle-audience");
  assert.equal(firstEdge.proven, true);
  assert.equal(firstEdge.ready, true);
  assert.equal(firstEdge.status, "ready");
  assert.equal(firstEdge.brief.metadata.title, "明确文章读者");
  assert.match(firstEdge.brief.content, /# State transition/);
  assert.ok(model.acceptance.every((item) => item.status === "pending"));
});

test("BoardModel binds runtime evidence and acceptance to an edge", () => {
  const loaded = readBlueprint(TEMPLATE_MAP);
  const state = runtimeState(loaded, TEMPLATE_MAP);
  state.phase = "implementation";
  state.destination_status = "approved";
  state.verified_edges = ["settle-audience"];
  state.facts["audience-known"] = {
    value: "true",
    evidence: [{ kind: "meeting", ref: "minutes/audience" }],
  };
  state.evidence.push({
    edge: "settle-audience",
    claim: "audience confirmed",
    proves: ["audience-known"],
    acceptance_ids: [],
    outcome_refs: [{ kind: "meeting", ref: "minutes/audience" }],
    checks: [{ command: "read minutes", result: "pass", observed: "audience named" }],
    limits: { simulated: [], inferred: [], unverified: [], product_unknowns: [] },
    executor: "human:owner",
    recorded_at: "2026-09-03T00:01:00Z",
  });
  const model = compileBoardModel({
    blueprint: loaded.blueprint,
    digest: loaded.digest,
    briefs: loaded.briefs,
    state,
    stateDigest: "runtime-digest",
  });
  const edge = model.edges.find((item) => item.id === "settle-audience");
  assert.equal(edge.status, "verified");
  assert.equal(edge.evidence[0].executor, "human:owner");
  assert.equal(model.nodes.find((node) => node.id === "writing-ready").satisfied, true);
  assert.ok(model.timeline.some((entry) => entry.kind === "evidence"));
  assert.equal(model.nodes.find((node) => node.kind === "fog").status, "unsatisfied");
});

test("board lenses and search expose route context without changing topology", () => {
  const loaded = readBlueprint(TEMPLATE_MAP);
  const model = compileBoardModel({
    blueprint: loaded.blueprint,
    digest: loaded.digest,
    briefs: loaded.briefs,
  });
  const signature = topologySignature(model);
  const route = selectElementIds(model, "proven");
  assert.ok(route.edges.includes("settle-audience"));
  assert.ok(route.nodes.includes("writing-ready"));

  const searched = selectElementIds(model, "all", "audience-known");
  assert.ok(searched.matches.length > 0);
  assert.ok(searched.nodes.includes("writing-ready"));
  assert.ok(searched.edges.includes("settle-audience"));

  const changed = structuredClone(model);
  changed.edges[0].status = "active";
  changed.nodes[0].status = "satisfied";
  assert.equal(topologySignature(changed), signature);
});

test("snapshot reader uses registered truth for unregistered map changes", () => {
  const { directory, mapPath } = copyTemplate();
  const loaded = readBlueprint(mapPath);
  const statePath = path.join(directory, "state.json");
  fs.writeFileSync(statePath, `${JSON.stringify(runtimeState(loaded, mapPath), null, 2)}\n`, "utf8");
  const reader = createBoardSnapshotReader({ mapPath, statePath });
  const current = reader();
  assert.equal(current.model.projection.source_status, "current");

  fs.appendFileSync(mapPath, "\n# unregistered change\n", "utf8");
  const stale = reader();
  assert.equal(stale.model.projection.source_status, "stale");
  assert.match(stale.model.projection.source_error, /unregistered changes/);
  assert.equal(stale.model.map.id, loaded.blueprint.map_id);
});

test("snapshot reader retains last-known-good data during invalid writes", () => {
  const { mapPath } = copyTemplate();
  const reader = createBoardSnapshotReader({ mapPath });
  const current = reader();
  fs.writeFileSync(mapPath, "destination: [", "utf8");
  const stale = reader();
  assert.equal(stale.model.projection.source_status, "stale");
  assert.equal(stale.model.map.id, current.model.map.id);
  assert.match(stale.model.projection.source_error, /invalid blueprint YAML/);
});

test("board server serves a read-only ETag API and offline assets", async () => {
  const server = createBoardServer({ mapPath: TEMPLATE_MAP });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const first = await fetch(`${base}/api/board`);
    assert.equal(first.status, 200);
    assert.equal(first.headers.get("x-content-type-options"), "nosniff");
    assert.match(first.headers.get("content-security-policy"), /default-src 'self'/);
    const etag = first.headers.get("etag");
    assert.ok(etag);
    assert.equal((await first.json()).projection.read_only, true);

    const unchanged = await fetch(`${base}/api/board`, { headers: { "If-None-Match": etag } });
    assert.equal(unchanged.status, 304);

    const head = await fetch(`${base}/api/board`, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");

    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Mapflow Board/);
    const app = await fetch(`${base}/app.js`);
    assert.equal(app.status, 200);
    const appSource = await app.text();
    assert.match(appSource, /If-None-Match/);
    assert.doesNotMatch(appSource, /\.innerHTML\s*=/);
    const vendor = await fetch(`${base}/vendor/cytoscape.min.js`);
    assert.equal(vendor.status, 200);
    assert.ok((await vendor.text()).length > 400000);

    const write = await fetch(`${base}/api/board`, { method: "POST" });
    assert.equal(write.status, 405);
    assert.match((await write.json()).error, /read-only/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
