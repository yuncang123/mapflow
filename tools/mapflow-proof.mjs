import crypto from "node:crypto";

const ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const PROOF_MODES = new Set(["logical", "executed-verifier", "external-readback", "submap-receipt", "legacy-inferred"]);
const PROOF_BASIS_KINDS = new Set(["formal-rule", "verifier", "external-contract", "submap"]);
const BASIS_BY_MODE = new Map([
  ["logical", "formal-rule"],
  ["executed-verifier", "verifier"],
  ["external-readback", "external-contract"],
  ["submap-receipt", "submap"],
]);

export class ProofError extends Error {}

function fail(message) {
  throw new ProofError(message);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function unique(values) {
  return [...new Set(values)];
}

function nonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") fail(`${label} must be a non-empty string`);
  return value;
}

function ids(values, label) {
  if (!Array.isArray(values)) fail(`${label} must be a list`);
  for (const [index, value] of values.entries()) {
    nonEmptyString(value, `${label}[${index}]`);
    if (!ID_PATTERN.test(value)) fail(`${label}[${index}] must be a semantic slug: ${value}`);
  }
  if (new Set(values).size !== values.length) fail(`${label} must not contain duplicates`);
  return values;
}

function maps(blueprint) {
  return {
    nodes: new Map(blueprint.nodes.map((item) => [item.id, item])),
    predicates: new Map(blueprint.predicates.map((item) => [item.id, item])),
    invariants: new Map(blueprint.invariants.map((item) => [item.id, item])),
  };
}

export function causalPremises(blueprint, edge) {
  const { nodes, invariants } = maps(blueprint);
  const source = nodes.get(edge.from);
  const invariantIds = new Set(edge.invariants ?? []);
  for (const invariantId of blueprint.destination.invariants ?? []) {
    const invariant = invariants.get(invariantId);
    if (invariant?.applies_to.includes(edge.id)) invariantIds.add(invariantId);
  }
  return unique([
    ...(source?.predicates ?? []),
    ...(edge.preconditions ?? []),
    ...[...invariantIds].flatMap((invariantId) => invariants.get(invariantId)?.requires ?? []),
  ]);
}

function validateContractShape(contract, edge, blueprint) {
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) fail(`edge ${edge.id}.causal_contract must be an object`);
  const allowed = ["rule_id", "premises", "conclusions", "proof_mode", "rule_basis", "required_witnesses", "non_interference", "max_age_seconds"];
  const unexpected = Object.keys(contract).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) fail(`edge ${edge.id}.causal_contract has unsupported fields: ${unexpected.join(", ")}`);
  nonEmptyString(contract.rule_id, `edge ${edge.id}.causal_contract.rule_id`);
  if (!ID_PATTERN.test(contract.rule_id)) fail(`edge ${edge.id}.causal_contract.rule_id must be a semantic slug`);
  ids(contract.premises, `edge ${edge.id}.causal_contract.premises`);
  ids(contract.conclusions, `edge ${edge.id}.causal_contract.conclusions`);
  if (!PROOF_MODES.has(contract.proof_mode)) fail(`edge ${edge.id}.causal_contract.proof_mode is invalid: ${contract.proof_mode}`);
  if (contract.proof_mode === "legacy-inferred") fail(`edge ${edge.id}.causal_contract.proof_mode cannot explicitly use legacy-inferred`);
  if (blueprint.schema_version >= 3 && contract.rule_basis === undefined) {
    fail(`edge ${edge.id}.causal_contract.rule_basis is required by blueprint schema ${blueprint.schema_version}`);
  }
  let ruleBasis = null;
  if (contract.rule_basis !== undefined) {
    if (!contract.rule_basis || typeof contract.rule_basis !== "object" || Array.isArray(contract.rule_basis)) {
      fail(`edge ${edge.id}.causal_contract.rule_basis must be an object`);
    }
    const unexpectedBasis = Object.keys(contract.rule_basis).filter((key) => !["kind", "ref"].includes(key));
    if (unexpectedBasis.length > 0) fail(`edge ${edge.id}.causal_contract.rule_basis has unsupported fields: ${unexpectedBasis.join(", ")}`);
    nonEmptyString(contract.rule_basis.kind, `edge ${edge.id}.causal_contract.rule_basis.kind`);
    nonEmptyString(contract.rule_basis.ref, `edge ${edge.id}.causal_contract.rule_basis.ref`);
    if (!PROOF_BASIS_KINDS.has(contract.rule_basis.kind)) {
      fail(`edge ${edge.id}.causal_contract.rule_basis.kind is invalid: ${contract.rule_basis.kind}`);
    }
    const expectedBasis = BASIS_BY_MODE.get(contract.proof_mode);
    if (expectedBasis !== contract.rule_basis.kind) {
      fail(`edge ${edge.id}.causal_contract proof_mode ${contract.proof_mode} requires rule_basis.kind ${expectedBasis}`);
    }
    ruleBasis = { kind: contract.rule_basis.kind, ref: contract.rule_basis.ref };
  }
  if (blueprint.schema_version >= 3 && contract.required_witnesses === undefined) {
    fail(`edge ${edge.id}.causal_contract.required_witnesses is required by blueprint schema ${blueprint.schema_version}`);
  }
  if (contract.required_witnesses !== undefined) {
    if (!Array.isArray(contract.required_witnesses)) fail(`edge ${edge.id}.causal_contract.required_witnesses must be a list`);
    contract.required_witnesses.forEach((value, index) => nonEmptyString(value, `edge ${edge.id}.causal_contract.required_witnesses[${index}]`));
    if (new Set(contract.required_witnesses).size !== contract.required_witnesses.length) fail(`edge ${edge.id}.causal_contract.required_witnesses must not contain duplicates`);
  }
  ids(contract.non_interference ?? [], `edge ${edge.id}.causal_contract.non_interference`);
  if (contract.max_age_seconds !== undefined && (!Number.isInteger(contract.max_age_seconds) || contract.max_age_seconds < 1)) {
    fail(`edge ${edge.id}.causal_contract.max_age_seconds must be a positive integer`);
  }
  const predicateIds = new Set(blueprint.predicates.map((predicate) => predicate.id));
  const unknownPremises = contract.premises.filter((predicateId) => !predicateIds.has(predicateId));
  const unknownConclusions = contract.conclusions.filter((predicateId) => !predicateIds.has(predicateId));
  const unknownNonInterference = (contract.non_interference ?? []).filter((predicateId) => !predicateIds.has(predicateId));
  if (unknownPremises.length > 0) fail(`edge ${edge.id}.causal_contract references unknown premises: ${unknownPremises.join(", ")}`);
  if (unknownConclusions.length > 0) fail(`edge ${edge.id}.causal_contract references unknown conclusions: ${unknownConclusions.join(", ")}`);
  if (unknownNonInterference.length > 0) fail(`edge ${edge.id}.causal_contract references unknown non_interference predicates: ${unknownNonInterference.join(", ")}`);
  const requiredPremises = causalPremises(blueprint, edge);
  const missingPremises = requiredPremises.filter((predicateId) => !contract.premises.includes(predicateId));
  if (missingPremises.length > 0) fail(`edge ${edge.id}.causal_contract omits structural premises: ${missingPremises.join(", ")}`);
  const missingConclusions = edge.effects.filter((predicateId) => !contract.conclusions.includes(predicateId));
  const extraConclusions = contract.conclusions.filter((predicateId) => !edge.effects.includes(predicateId));
  if (missingConclusions.length > 0 || extraConclusions.length > 0) {
    fail(`edge ${edge.id}.causal_contract.conclusions must exactly match effects; missing=${missingConclusions.join(",") || "-"}; extra=${extraConclusions.join(",") || "-"}`);
  }
  const overlap = (contract.non_interference ?? []).filter((predicateId) => contract.conclusions.includes(predicateId));
  if (overlap.length > 0) fail(`edge ${edge.id}.causal_contract cannot both conclude and preserve: ${overlap.join(", ")}`);
  const conclusionsByFact = new Map();
  for (const predicateId of contract.conclusions) {
    const predicate = blueprint.predicates.find((item) => item.id === predicateId);
    conclusionsByFact.set(predicate.fact, predicate.equals);
  }
  for (const predicateId of contract.non_interference ?? []) {
    const predicate = blueprint.predicates.find((item) => item.id === predicateId);
    if (conclusionsByFact.has(predicate.fact) && conclusionsByFact.get(predicate.fact) !== predicate.equals) {
      fail(`edge ${edge.id}.causal_contract non_interference contradicts conclusion on fact ${predicate.fact}`);
    }
  }
  const requiredEvidence = (edge.evidence_contract ?? []).filter((item) => item.required).map((item) => item.id);
  const missingEvidenceWitnesses = requiredEvidence.filter((witness) => !(contract.required_witnesses ?? []).includes(witness));
  if (blueprint.schema_version >= 3 && missingEvidenceWitnesses.length > 0) {
    fail(`edge ${edge.id}.causal_contract.required_witnesses omits required evidence: ${missingEvidenceWitnesses.join(", ")}`);
  }
  return {
    rule_id: contract.rule_id,
    premises: [...contract.premises],
    conclusions: [...contract.conclusions],
    proof_mode: contract.proof_mode,
    rule_basis: ruleBasis,
    required_witnesses: [...(contract.required_witnesses ?? [])],
    non_interference: [...(contract.non_interference ?? [])],
    ...(contract.max_age_seconds === undefined ? {} : { max_age_seconds: contract.max_age_seconds }),
    legacy_inferred: false,
  };
}

export function normalizeCausalContract(blueprint, edge) {
  if (edge.causal_contract !== undefined) return validateContractShape(edge.causal_contract, edge, blueprint);
  return {
    rule_id: `edge-${edge.id}-legacy-inferred`,
    premises: causalPremises(blueprint, edge),
    conclusions: [...edge.effects],
    proof_mode: "legacy-inferred",
    rule_basis: null,
    required_witnesses: (edge.evidence_contract ?? []).filter((contract) => contract.required).map((contract) => contract.id),
    non_interference: [],
    legacy_inferred: true,
  };
}

function factForPredicate(predicateId, blueprint, facts) {
  const predicate = new Map(blueprint.predicates.map((item) => [item.id, item])).get(predicateId);
  const fact = facts?.[predicate?.fact];
  return { predicate, fact, value: typeof fact === "string" ? fact : fact?.value };
}

function stale(value, maxAgeSeconds, now = Date.now()) {
  if (!maxAgeSeconds || !value?.evidence?.length) return false;
  const dates = value.evidence.map((entry) => Date.parse(entry.observed_at ?? "")).filter((entry) => !Number.isNaN(entry));
  if (dates.length === 0) return true;
  return now - Math.max(...dates) > maxAgeSeconds * 1000;
}

export function derivationTrace(blueprint, edge, facts = {}, { now = Date.now() } = {}) {
  const contract = normalizeCausalContract(blueprint, edge);
  const premises = contract.premises.map((predicateId) => {
    const { predicate, fact, value } = factForPredicate(predicateId, blueprint, facts);
    const satisfied = value === predicate?.equals && value !== "conflict";
    return {
      predicate: predicateId,
      fact: predicate?.fact ?? null,
      expected: predicate?.equals ?? null,
      actual: value ?? null,
      satisfied,
      stale: stale(fact, contract.max_age_seconds, now),
    };
  });
  const conclusions = contract.conclusions.map((predicateId) => {
    const { predicate } = factForPredicate(predicateId, blueprint, facts);
    return { predicate: predicateId, fact: predicate?.fact ?? null, expected: predicate?.equals ?? null };
  });
  return {
    rule: contract.rule_id,
    edge: edge.id,
    proof_mode: contract.proof_mode,
    rule_basis: contract.rule_basis,
    premises,
    conclusions,
    valid: premises.every((entry) => entry.satisfied && !entry.stale),
  };
}

export function causalProofGaps(blueprint, facts = {}) {
  const gaps = [];
  for (const edge of blueprint.edges) {
    if (edge.causal_contract === undefined) continue;
    try {
      const trace = derivationTrace(blueprint, edge, facts);
      const missing = trace.premises.filter((entry) => !entry.satisfied).map((entry) => entry.predicate);
      const stalePremises = trace.premises.filter((entry) => entry.stale).map((entry) => entry.predicate);
      if (missing.length > 0) gaps.push({ type: "causal-premise-not-established", at_edge: edge.id, missing: missing.join(","), caused_by: `causal rule ${trace.rule} has unsatisfied premise(s)`, repair_scope: `edge:${edge.id}`, category: "causal" });
      if (stalePremises.length > 0) gaps.push({ type: "causal-premise-stale", at_edge: edge.id, missing: stalePremises.join(","), caused_by: `causal rule ${trace.rule} has stale premise evidence`, repair_scope: `edge:${edge.id}`, category: "causal" });
    } catch (error) {
      gaps.push({ type: "invalid-causal-contract", at_edge: edge.id, missing: "causal_contract", caused_by: error.message, repair_scope: `edge:${edge.id}`, category: "structural" });
    }
  }
  return gaps;
}

export function certificateDigest(certificate) {
  const payload = structuredClone(certificate);
  delete payload.certificate_digest;
  return crypto.createHash("sha256").update(stableJson(payload)).digest("hex");
}

export function createProofCertificate({ blueprint, edge, facts, run, evidence, witnesses = [], verifier = null, mapDigest, briefDigest, recordedAt }) {
  const contract = normalizeCausalContract(blueprint, edge);
  const trace = derivationTrace(blueprint, edge, facts);
  if (!trace.valid) {
    const missing = trace.premises.filter((entry) => !entry.satisfied || entry.stale).map((entry) => entry.predicate);
    fail(`causal proof cannot be certified for ${edge.id}; premises not valid: ${missing.join(", ")}`);
  }
  const actualWitnesses = unique(witnesses);
  const missingWitnesses = contract.required_witnesses.filter((witness) => !actualWitnesses.includes(witness));
  if (missingWitnesses.length > 0) fail(`causal proof is missing required witnesses for ${edge.id}: ${missingWitnesses.join(", ")}`);
  const certificate = {
    schema: "mapflow.proof-certificate/v1",
    edge: edge.id,
    run,
    evidence,
    rule: contract.rule_id,
    proof_mode: contract.proof_mode,
    rule_basis: contract.rule_basis,
    premises: [...contract.premises],
    conclusions: [...contract.conclusions],
    derivation: trace,
    witnesses: actualWitnesses,
    verifier: verifier === null ? null : structuredClone(verifier),
    map_digest: mapDigest,
    brief_digest: briefDigest,
    recorded_at: recordedAt,
  };
  certificate.certificate_digest = certificateDigest(certificate);
  return certificate;
}

export function verifyProofCertificate(certificate, { blueprint, edge, facts, run, evidence, mapDigest, briefDigest, verifier = null, requiredWitnesses = [] } = {}) {
  if (!certificate || certificate.schema !== "mapflow.proof-certificate/v1") fail("invalid proof certificate schema");
  if (certificate.certificate_digest !== certificateDigest(certificate)) fail("proof certificate digest mismatch");
  if (certificate.edge !== edge.id || certificate.run !== run || certificate.evidence !== evidence) fail("proof certificate identity mismatch");
  if (certificate.map_digest !== mapDigest || certificate.brief_digest !== briefDigest) fail("proof certificate is bound to a stale map or Task Brief");
  const contract = normalizeCausalContract(blueprint, edge);
  if (certificate.rule !== contract.rule_id || stableJson(certificate.rule_basis ?? null) !== stableJson(contract.rule_basis ?? null) || stableJson(certificate.premises) !== stableJson(contract.premises) || stableJson(certificate.conclusions) !== stableJson(contract.conclusions)) fail("proof certificate causal contract mismatch");
  const trace = derivationTrace(blueprint, edge, facts);
  if (!trace.valid) fail(`proof certificate premises are no longer valid: ${trace.premises.filter((entry) => !entry.satisfied || entry.stale).map((entry) => entry.predicate).join(", ")}`);
  if (stableJson(certificate.derivation) !== stableJson(trace)) fail("proof certificate derivation trace mismatch");
  const witnesses = new Set(certificate.witnesses ?? []);
  const missingWitnesses = unique([...requiredWitnesses, ...contract.required_witnesses]).filter((witness) => !witnesses.has(witness));
  if (missingWitnesses.length > 0) fail(`proof certificate is missing witnesses: ${missingWitnesses.join(", ")}`);
  if (verifier !== null && stableJson(certificate.verifier) !== stableJson(verifier)) fail("proof certificate verifier binding mismatch");
  if (verifier !== null && contract.conclusions.some((predicateId) => !verifier.proves?.includes(predicateId))) fail("proof certificate verifier does not cover all causal conclusions");
  return true;
}
