import assert from "node:assert/strict";
import test from "node:test";

import {
  causalProofGaps,
  createProofCertificate,
  derivationTrace,
  normalizeCausalContract,
  verifyProofCertificate,
} from "../tools/mapflow-proof.mjs";
import { edgeReadiness, proveBlueprint, validateBlueprint } from "../tools/mapflow-core.mjs";

function blueprintFor(contract = {}) {
  const edge = {
    id: "publish-result",
    from: "input-ready",
    to: "result-ready",
    preconditions: ["input-available"],
    effects: ["result-recorded"],
    invariants: [],
    evidence_contract: [{ id: "result-record", proves: ["result-recorded"], required: true }],
    ...contract,
  };
  return {
    destination: { invariants: [] },
    predicates: [
      { id: "input-ready", fact: "input-ready", equals: "true", kind: "state" },
      { id: "input-available", fact: "input-available", equals: "true", kind: "resource" },
      { id: "result-recorded", fact: "result-recorded", equals: "true", kind: "state" },
      { id: "result-preserved", fact: "result-preserved", equals: "true", kind: "state" },
    ],
    nodes: [
      { id: "input-ready", predicates: ["input-ready"] },
      { id: "result-ready", predicates: ["result-recorded"] },
    ],
    invariants: [],
    edges: [edge],
  };
}

const facts = {
  "input-ready": { value: "true", evidence: [{ kind: "document", ref: "input.md", observed_at: new Date().toISOString() }] },
  "input-available": { value: "true", evidence: [{ kind: "document", ref: "source.md", observed_at: new Date().toISOString() }] },
};

test("causal contract rejects omitted structural premises and mismatched conclusions", () => {
  const blueprint = blueprintFor({ causal_contract: {
    rule_id: "publish-result-v1",
    premises: ["input-available"],
    conclusions: ["result-recorded"],
    proof_mode: "executed-verifier",
  } });
  assert.throws(() => normalizeCausalContract(blueprint, blueprint.edges[0]), /omits structural premises/);

  const mismatch = blueprintFor({ causal_contract: {
    rule_id: "publish-result-v1",
    premises: ["input-ready", "input-available"],
    conclusions: ["input-ready"],
    proof_mode: "executed-verifier",
  } });
  assert.throws(() => normalizeCausalContract(mismatch, mismatch.edges[0]), /must exactly match effects/);
});

test("derivation trace distinguishes a valid premise from a stale one", () => {
  const blueprint = blueprintFor({ causal_contract: {
    rule_id: "publish-result-v1",
    premises: ["input-ready", "input-available"],
    conclusions: ["result-recorded"],
    proof_mode: "executed-verifier",
    max_age_seconds: 1,
  } });
  const staleFacts = {
    ...facts,
    "input-ready": { value: "true", evidence: [{ kind: "document", ref: "old.md", observed_at: new Date(Date.now() - 10_000).toISOString() }] },
  };
  const trace = derivationTrace(blueprint, blueprint.edges[0], staleFacts);
  assert.equal(trace.valid, false);
  assert.equal(trace.premises.find((entry) => entry.predicate === "input-ready").stale, true);
  assert.ok(causalProofGaps(blueprint, staleFacts).some((gap) => gap.type === "causal-premise-stale"));
});

test("proof certificate binds the rule, witnesses, verifier, run, and digests", () => {
  const blueprint = blueprintFor({ causal_contract: {
    rule_id: "publish-result-v1",
    premises: ["input-ready", "input-available"],
    conclusions: ["result-recorded"],
    proof_mode: "executed-verifier",
    required_witnesses: ["result-record"],
    non_interference: ["result-preserved"],
  } });
  const verifier = { id: "result-check", digest: "verifier-digest", proves: ["result-recorded"] };
  const certificate = createProofCertificate({
    blueprint,
    edge: blueprint.edges[0],
    facts,
    run: "publish-result-run-1",
    evidence: "publish-result-evidence-1",
    witnesses: ["result-record", "result-check"],
    verifier,
    mapDigest: "map-digest",
    briefDigest: "brief-digest",
    recordedAt: new Date().toISOString(),
  });
  assert.equal(verifyProofCertificate(certificate, {
    blueprint,
    edge: blueprint.edges[0],
    facts,
    run: "publish-result-run-1",
    evidence: "publish-result-evidence-1",
    mapDigest: "map-digest",
    briefDigest: "brief-digest",
    verifier,
    requiredWitnesses: ["result-record"],
  }), true);
  certificate.witnesses = [];
  assert.throws(() => verifyProofCertificate(certificate, {
    blueprint,
    edge: blueprint.edges[0],
    facts,
    run: "publish-result-run-1",
    evidence: "publish-result-evidence-1",
    mapDigest: "map-digest",
    briefDigest: "brief-digest",
    verifier,
  }), /digest mismatch/);
});

test("non-interference cannot contradict a conclusion on the same fact", () => {
  const blueprint = blueprintFor({
    causal_contract: {
      rule_id: "publish-result-v1",
      premises: ["input-ready", "input-available"],
      conclusions: ["result-recorded"],
      proof_mode: "executed-verifier",
      non_interference: ["result-preserved"],
    },
  });
  const preserved = blueprint.predicates.find((predicate) => predicate.id === "result-preserved");
  preserved.fact = "result-recorded";
  preserved.equals = "false";
  assert.throws(() => normalizeCausalContract(blueprint, blueprint.edges[0]), /non_interference contradicts/);
});

test("an extra causal premise blocks readiness until its Fact is present", () => {
  const blueprint = blueprintFor({ causal_contract: {
    rule_id: "publish-result-v1",
    premises: ["input-ready", "input-available", "result-preserved"],
    conclusions: ["result-recorded"],
    proof_mode: "executed-verifier",
  } });
  const readiness = edgeReadiness(blueprint, facts, "publish-result");
  assert.equal(readiness.ready, false);
  assert.deepEqual(readiness.missing, [{ kind: "causal-premise", predicate: "result-preserved" }]);
});

function auditableBlueprint(edges = null) {
  const makeEdge = ({ id, from, to, premises, conclusion, witness }) => ({
    id,
    from,
    to,
    brief_ref: `briefs/${id}.md`,
    preconditions: [],
    effects: [conclusion],
    invariants: [],
    certainty: "expected",
    evidence_contract: [{ id: witness, proves: [conclusion], required: true }],
    causal_contract: {
      rule_id: `${id}-rule`,
      premises,
      conclusions: [conclusion],
      proof_mode: "executed-verifier",
      rule_basis: { kind: "verifier", ref: `${id}-check` },
      required_witnesses: [witness],
      non_interference: [],
    },
    on_failure: { action: "replan" },
  });
  return {
    schema_version: 3,
    map_id: "auditable-route",
    intent: { statement: "prove one complete route", status: "shaped", open_questions: [] },
    destination: {
      statement: "destination is derivable",
      requires: ["destination-ready"],
      invariants: [],
      acceptance: [{ id: "destination-proof", proves: ["destination-ready"], proof: "executed destination verifier" }],
    },
    predicates: [
      { id: "source-ready", fact: "source-ready", equals: "true", kind: "state" },
      { id: "middle-ready", fact: "middle-ready", equals: "true", kind: "state" },
      { id: "destination-ready", fact: "destination-ready", equals: "true", kind: "state" },
    ],
    initial_state: { facts: [
      { id: "source-ready", value: "true", evidence: [{ kind: "note", ref: "test:source" }] },
      { id: "middle-ready", value: "false", evidence: [{ kind: "note", ref: "test:missing" }] },
      { id: "destination-ready", value: "false", evidence: [{ kind: "note", ref: "test:missing" }] },
    ] },
    assumptions: [],
    invariants: [],
    boundaries: { in_scope: ["proof kernel"], out_of_scope: ["real execution"], authorization: [] },
    nodes: [
      { id: "source", kind: "state", label: "Source", predicates: ["source-ready"] },
      { id: "middle", kind: "state", label: "Middle", predicates: ["middle-ready"] },
      { id: "destination", kind: "destination", label: "Destination", predicates: ["destination-ready"] },
    ],
    edges: edges ?? [
      makeEdge({ id: "establish-middle", from: "source", to: "middle", premises: ["source-ready"], conclusion: "middle-ready", witness: "middle-proof" }),
      makeEdge({ id: "reach-destination", from: "middle", to: "destination", premises: ["middle-ready"], conclusion: "destination-ready", witness: "destination-proof" }),
    ],
    loops: [],
    submaps: [],
  };
}

test("schema 3 requires an explicit causal rule, basis, and evidence witnesses", () => {
  const missingContract = auditableBlueprint();
  delete missingContract.edges[0].causal_contract;
  assert.throws(() => validateBlueprint(missingContract), /causal_contract is required/);

  const missingBasis = auditableBlueprint();
  delete missingBasis.edges[0].causal_contract.rule_basis;
  assert.throws(() => validateBlueprint(missingBasis), /rule_basis is required/);

  const missingWitness = auditableBlueprint();
  missingWitness.edges[0].causal_contract.required_witnesses = [];
  assert.throws(() => validateBlueprint(missingWitness), /omits required evidence/);
});

test("forward proof records complete predicate provenance across future premises", () => {
  const proof = proveBlueprint(auditableBlueprint());
  assert.equal(proof.structural, "complete");
  assert.equal(proof.reachability, "logical");
  assert.equal(proof.causal_soundness, "explicit");
  assert.deepEqual(proof.causal_gaps, []);
  assert.deepEqual(proof.derivation_graph.primary_proof.edges, ["establish-middle", "reach-destination"]);
  assert.equal(proof.derivations["reach-destination"].status, "destination-proof");
  assert.ok(proof.derivation_graph.applications.every((application) => (
    application.premises.every((premise) => premise.satisfied && premise.support)
    && application.conclusions.every((conclusion) => conclusion.support)
  )));
  const destination = proof.derivation_graph.destinations[0];
  assert.equal(destination.predicates[0].predicate, "destination-ready");
  assert.ok(proof.derivation_graph.predicate_supports.some((support) => support.id === destination.predicates[0].support));
});

test("an already observed schema 3 destination remains explicitly causal", () => {
  const blueprint = auditableBlueprint();
  blueprint.initial_state.facts.find((fact) => fact.id === "destination-ready").value = "true";
  blueprint.initial_state.facts.find((fact) => fact.id === "destination-ready").evidence = [{
    kind: "command",
    ref: "destination verifier",
    strength: "observed",
  }];

  const proof = proveBlueprint(blueprint);
  assert.equal(proof.destination_reachable, true);
  assert.deepEqual(proof.candidate_edges, []);
  assert.equal(proof.causal_soundness, "explicit");
});

test("OR routes remain separate alternatives in the derivation graph", () => {
  const blueprint = auditableBlueprint();
  const base = blueprint.edges[0];
  blueprint.edges = [
    { ...structuredClone(base), id: "route-alpha", to: "destination", brief_ref: "briefs/route-alpha.md", effects: ["destination-ready"], evidence_contract: [{ id: "alpha-proof", proves: ["destination-ready"], required: true }], causal_contract: { rule_id: "route-alpha-rule", premises: ["source-ready"], conclusions: ["destination-ready"], proof_mode: "executed-verifier", rule_basis: { kind: "verifier", ref: "route-alpha-check" }, required_witnesses: ["alpha-proof"], non_interference: [] } },
    { ...structuredClone(base), id: "route-beta", to: "destination", brief_ref: "briefs/route-beta.md", effects: ["destination-ready"], evidence_contract: [{ id: "beta-proof", proves: ["destination-ready"], required: true }], causal_contract: { rule_id: "route-beta-rule", premises: ["source-ready"], conclusions: ["destination-ready"], proof_mode: "executed-verifier", rule_basis: { kind: "verifier", ref: "route-beta-check" }, required_witnesses: ["beta-proof"], non_interference: [] } },
  ];
  const proof = proveBlueprint(blueprint);
  assert.equal(proof.destination_reachable, true);
  assert.ok(BigInt(proof.derivation_graph.route_count) >= 2n);
  assert.ok(proof.derivation_graph.applications.some((application) => application.edge === "route-alpha" && application.on_destination_route));
  assert.ok(proof.derivation_graph.applications.some((application) => application.edge === "route-beta" && application.on_destination_route));
});
