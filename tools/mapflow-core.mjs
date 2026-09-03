import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { load as loadYaml } from "./vendor/js-yaml/js-yaml.mjs";

export const BLUEPRINT_SCHEMA_VERSION = 2;
export const STATE_SCHEMA_VERSION = 2;
export const TRUTH_VALUES = new Set(["true", "false", "unknown", "conflict"]);

const ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const NODE_KINDS = new Set(["state", "decision", "fog", "join", "destination"]);
const PREDICATE_KINDS = new Set(["state", "authorization", "resource", "progress"]);
const CERTAINTIES = new Set(["expected", "conditional"]);
const FAILURE_ACTIONS = new Set(["replan", "branch", "stop"]);
const EVIDENCE_KINDS = new Set(["git", "document", "command", "receipt", "meeting", "note", "observation", "external"]);

export class ModelError extends Error {}

function fail(message) {
  throw new ModelError(message);
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  return value;
}

function allowedKeys(value, keys, label) {
  const unexpected = Object.keys(value).filter((key) => !keys.includes(key));
  if (unexpected.length > 0) fail(`${label} has unsupported fields: ${unexpected.join(", ")}`);
}

function array(value, label, { nonEmpty = false } = {}) {
  if (!Array.isArray(value)) fail(`${label} must be a list`);
  if (nonEmpty && value.length === 0) fail(`${label} must not be empty`);
  return value;
}

function string(value, label) {
  if (typeof value !== "string" || value.trim() === "") fail(`${label} must be a non-empty string`);
  return value;
}

function meaningfulStrings(value, label, { nonEmpty = true } = {}) {
  const values = array(value, label, { nonEmpty });
  values.forEach((entry, index) => {
    string(entry, `${label}[${index}]`);
    if (/^(?:todo|tbd|n\/a|待填写)$/i.test(entry.trim())) fail(`${label}[${index}] must be actionable, not a placeholder`);
  });
  return values;
}

function id(value, label) {
  string(value, label);
  if (!ID_PATTERN.test(value)) fail(`${label} must be a semantic slug: ${value}`);
  return value;
}

function ids(value, label, options) {
  const values = array(value, label, options);
  values.forEach((entry, index) => id(entry, `${label}[${index}]`));
  if (new Set(values).size !== values.length) fail(`${label} must not contain duplicates`);
  return values;
}

function collectionMap(items, label) {
  const result = new Map();
  for (const item of items) {
    const itemId = id(item.id, `${label}.id`);
    if (result.has(itemId)) fail(`${label} contains duplicate id: ${itemId}`);
    result.set(itemId, item);
  }
  return result;
}

function requireReferences(values, known, label) {
  for (const value of values) {
    if (!known.has(value)) fail(`${label} references unknown id: ${value}`);
  }
}

function validateEvidenceRef(value, label) {
  const ref = object(value, label);
  allowedKeys(ref, ["kind", "ref", "observed_at"], label);
  string(ref.kind, `${label}.kind`);
  if (!EVIDENCE_KINDS.has(ref.kind)) fail(`${label}.kind is invalid: ${ref.kind}`);
  string(ref.ref, `${label}.ref`);
  if (ref.observed_at !== undefined) string(ref.observed_at, `${label}.observed_at`);
}

function assertCompatiblePredicates(predicateIds, predicateMap, label) {
  const byFact = new Map();
  for (const predicateId of predicateIds) {
    const predicate = predicateMap.get(predicateId);
    const existing = byFact.get(predicate.fact);
    if (existing && existing.equals !== predicate.equals) {
      fail(`${label} requires incompatible values for fact ${predicate.fact}: ${existing.id}, ${predicate.id}`);
    }
    byFact.set(predicate.fact, predicate);
  }
}

export function validateBlueprint(value) {
  const blueprint = object(value, "blueprint");
  allowedKeys(blueprint, [
    "schema_version", "map_id", "destination", "predicates", "initial_state", "assumptions",
    "invariants", "boundaries", "nodes", "edges", "loops", "extensions",
  ], "blueprint");
  if (blueprint.schema_version !== BLUEPRINT_SCHEMA_VERSION) {
    fail(`unsupported blueprint schema: ${blueprint.schema_version}`);
  }
  id(blueprint.map_id, "map_id");

  const destination = object(blueprint.destination, "destination");
  allowedKeys(destination, ["statement", "requires", "invariants", "acceptance"], "destination");
  string(destination.statement, "destination.statement");
  ids(destination.requires, "destination.requires", { nonEmpty: true });
  ids(destination.invariants, "destination.invariants");
  const acceptance = array(destination.acceptance, "destination.acceptance", { nonEmpty: true });
  const acceptanceMap = collectionMap(acceptance, "destination.acceptance");
  for (const item of acceptanceMap.values()) {
    allowedKeys(item, ["id", "proves", "proof"], `acceptance ${item.id}`);
    ids(item.proves, `acceptance ${item.id}.proves`, { nonEmpty: true });
    string(item.proof, `acceptance ${item.id}.proof`);
  }

  const predicates = array(blueprint.predicates, "predicates", { nonEmpty: true });
  const predicateMap = collectionMap(predicates, "predicates");
  for (const predicate of predicateMap.values()) {
    allowedKeys(predicate, ["id", "fact", "equals", "kind"], `predicate ${predicate.id}`);
    id(predicate.fact, `predicate ${predicate.id}.fact`);
    if (!TRUTH_VALUES.has(predicate.equals)) fail(`predicate ${predicate.id}.equals has invalid truth value: ${predicate.equals}`);
    if (!PREDICATE_KINDS.has(predicate.kind)) fail(`predicate ${predicate.id}.kind is invalid: ${predicate.kind}`);
  }

  requireReferences(destination.requires, predicateMap, "destination.requires");
  assertCompatiblePredicates(destination.requires, predicateMap, "destination.requires");
  for (const item of acceptanceMap.values()) {
    requireReferences(item.proves, predicateMap, `acceptance ${item.id}.proves`);
    assertCompatiblePredicates(item.proves, predicateMap, `acceptance ${item.id}.proves`);
  }

  const initialState = object(blueprint.initial_state, "initial_state");
  allowedKeys(initialState, ["facts"], "initial_state");
  const facts = array(initialState.facts, "initial_state.facts");
  const factMap = collectionMap(facts, "initial_state.facts");
  for (const fact of factMap.values()) {
    allowedKeys(fact, ["id", "value", "evidence"], `fact ${fact.id}`);
    if (!TRUTH_VALUES.has(fact.value)) fail(`fact ${fact.id}.value has invalid truth value: ${fact.value}`);
    const evidence = array(fact.evidence, `fact ${fact.id}.evidence`);
    evidence.forEach((entry, index) => validateEvidenceRef(entry, `fact ${fact.id}.evidence[${index}]`));
    if (fact.value !== "unknown" && evidence.length === 0) fail(`fact ${fact.id} requires evidence for value ${fact.value}`);
    if (fact.value === "conflict" && evidence.length < 2) fail(`fact ${fact.id} requires at least two evidence refs for conflict`);
  }

  const assumptions = array(blueprint.assumptions, "assumptions");
  const assumptionMap = collectionMap(assumptions, "assumptions");
  for (const assumption of assumptionMap.values()) {
    allowedKeys(assumption, ["id", "predicate", "source", "status"], `assumption ${assumption.id}`);
    id(assumption.predicate, `assumption ${assumption.id}.predicate`);
    requireReferences([assumption.predicate], predicateMap, `assumption ${assumption.id}`);
    string(assumption.source, `assumption ${assumption.id}.source`);
    if (!new Set(["accepted", "unverified"]).has(assumption.status)) {
      fail(`assumption ${assumption.id}.status is invalid: ${assumption.status}`);
    }
  }
  assertCompatiblePredicates(
    assumptions.filter((assumption) => assumption.status === "accepted").map((assumption) => assumption.predicate),
    predicateMap,
    "accepted assumptions",
  );

  const invariants = array(blueprint.invariants, "invariants");
  const invariantMap = collectionMap(invariants, "invariants");
  requireReferences(destination.invariants, invariantMap, "destination.invariants");
  for (const invariant of invariantMap.values()) {
    allowedKeys(invariant, ["id", "applies_to", "requires"], `invariant ${invariant.id}`);
    ids(invariant.applies_to, `invariant ${invariant.id}.applies_to`, { nonEmpty: true });
    ids(invariant.requires, `invariant ${invariant.id}.requires`, { nonEmpty: true });
    requireReferences(invariant.requires, predicateMap, `invariant ${invariant.id}.requires`);
    assertCompatiblePredicates(invariant.requires, predicateMap, `invariant ${invariant.id}.requires`);
  }

  const boundaries = object(blueprint.boundaries, "boundaries");
  allowedKeys(boundaries, ["in_scope", "out_of_scope", "authorization"], "boundaries");
  for (const name of ["in_scope", "out_of_scope", "authorization"]) {
    array(boundaries[name], `boundaries.${name}`).forEach((entry, index) => string(entry, `boundaries.${name}[${index}]`));
  }

  const nodes = array(blueprint.nodes, "nodes", { nonEmpty: true });
  const nodeMap = collectionMap(nodes, "nodes");
  for (const node of nodeMap.values()) {
    allowedKeys(node, ["id", "kind", "label", "predicates", "realization_refs"], `node ${node.id}`);
    if (!NODE_KINDS.has(node.kind)) fail(`node ${node.id}.kind is invalid: ${node.kind}`);
    string(node.label, `node ${node.id}.label`);
    ids(node.predicates, `node ${node.id}.predicates`, { nonEmpty: true });
    requireReferences(node.predicates, predicateMap, `node ${node.id}.predicates`);
    assertCompatiblePredicates(node.predicates, predicateMap, `node ${node.id}.predicates`);
    if (node.kind === "join" && node.predicates.length < 2) fail(`join node ${node.id} requires at least two predicates`);
    if (node.kind === "fog" && !node.predicates.some((predicateId) => {
      const expected = predicateMap.get(predicateId).equals;
      return expected === "unknown" || expected === "conflict";
    })) {
      fail(`fog node ${node.id} must include an unknown or conflict predicate`);
    }
    if (node.realization_refs !== undefined) {
      array(node.realization_refs, `node ${node.id}.realization_refs`).forEach((entry, index) => (
        validateEvidenceRef(entry, `node ${node.id}.realization_refs[${index}]`)
      ));
    }
  }
  const destinationNodes = nodes.filter((node) => node.kind === "destination");
  if (!destinationNodes.some((node) => destination.requires.every((predicateId) => node.predicates.includes(predicateId)))) {
    fail("a destination node must contain every destination.required predicate");
  }

  const edges = array(blueprint.edges, "edges", { nonEmpty: true });
  const edgeMap = collectionMap(edges, "edges");
  for (const edge of edgeMap.values()) {
    allowedKeys(edge, [
      "id", "from", "to", "brief_ref", "preconditions", "effects", "invariants",
      "certainty", "evidence_contract", "on_failure",
    ], `edge ${edge.id}`);
    id(edge.from, `edge ${edge.id}.from`);
    id(edge.to, `edge ${edge.id}.to`);
    requireReferences([edge.from, edge.to], nodeMap, `edge ${edge.id}`);
    string(edge.brief_ref, `edge ${edge.id}.brief_ref`);
    ids(edge.preconditions, `edge ${edge.id}.preconditions`);
    ids(edge.effects, `edge ${edge.id}.effects`, { nonEmpty: true });
    ids(edge.invariants, `edge ${edge.id}.invariants`);
    requireReferences(edge.preconditions, predicateMap, `edge ${edge.id}.preconditions`);
    requireReferences(edge.effects, predicateMap, `edge ${edge.id}.effects`);
    assertCompatiblePredicates(edge.preconditions, predicateMap, `edge ${edge.id}.preconditions`);
    assertCompatiblePredicates(edge.effects, predicateMap, `edge ${edge.id}.effects`);
    requireReferences(edge.invariants, invariantMap, `edge ${edge.id}.invariants`);
    if (!CERTAINTIES.has(edge.certainty)) fail(`edge ${edge.id}.certainty is invalid: ${edge.certainty}`);
    const contracts = array(edge.evidence_contract, `edge ${edge.id}.evidence_contract`);
    const contractMap = collectionMap(contracts, `edge ${edge.id}.evidence_contract`);
    for (const contract of contractMap.values()) {
      allowedKeys(contract, ["id", "proves", "required"], `edge ${edge.id} contract ${contract.id}`);
      ids(contract.proves, `edge ${edge.id} contract ${contract.id}.proves`, { nonEmpty: true });
      requireReferences(contract.proves, predicateMap, `edge ${edge.id} contract ${contract.id}.proves`);
      const unrelated = contract.proves.filter((predicateId) => !edge.effects.includes(predicateId));
      if (unrelated.length > 0) fail(`edge ${edge.id} contract ${contract.id} proves predicates outside effects: ${unrelated.join(", ")}`);
      if (typeof contract.required !== "boolean") fail(`edge ${edge.id} contract ${contract.id}.required must be boolean`);
    }
    const onFailure = object(edge.on_failure, `edge ${edge.id}.on_failure`);
    allowedKeys(onFailure, ["action", "to"], `edge ${edge.id}.on_failure`);
    if (!FAILURE_ACTIONS.has(onFailure.action)) fail(`edge ${edge.id}.on_failure.action is invalid: ${onFailure.action}`);
    if (onFailure.action === "branch") {
      id(onFailure.to, `edge ${edge.id}.on_failure.to`);
      requireReferences([onFailure.to], nodeMap, `edge ${edge.id}.on_failure.to`);
    } else if (onFailure.to !== undefined) {
      fail(`edge ${edge.id}.on_failure.to is only valid for branch`);
    }
  }
  for (const invariant of invariantMap.values()) {
    requireReferences(invariant.applies_to, edgeMap, `invariant ${invariant.id}.applies_to`);
  }
  const destinationInvariantPredicates = destination.invariants.flatMap((invariantId) => invariantMap.get(invariantId).requires);
  assertCompatiblePredicates(
    [...destination.requires, ...destinationInvariantPredicates],
    predicateMap,
    "destination and invariant requirements",
  );
  for (const edge of edgeMap.values()) {
    assertCompatiblePredicates(
      [
        ...nodeMap.get(edge.from).predicates,
        ...edge.preconditions,
        ...invariantPredicates(edge, blueprint, invariantMap),
      ],
      predicateMap,
      `edge ${edge.id} requirements`,
    );
  }

  const loops = array(blueprint.loops, "loops");
  const loopMap = collectionMap(loops, "loops");
  for (const loop of loopMap.values()) {
    allowedKeys(loop, ["id", "edges", "progress_predicate", "exit_predicate", "max_iterations"], `loop ${loop.id}`);
    ids(loop.edges, `loop ${loop.id}.edges`, { nonEmpty: true });
    requireReferences(loop.edges, edgeMap, `loop ${loop.id}.edges`);
    id(loop.progress_predicate, `loop ${loop.id}.progress_predicate`);
    id(loop.exit_predicate, `loop ${loop.id}.exit_predicate`);
    requireReferences([loop.progress_predicate, loop.exit_predicate], predicateMap, `loop ${loop.id}`);
    if (!Number.isInteger(loop.max_iterations) || loop.max_iterations < 1) {
      fail(`loop ${loop.id}.max_iterations must be a positive integer`);
    }
  }

  const acceptanceCoverage = new Set(acceptance.flatMap((item) => item.proves));
  const uncovered = destination.requires.filter((predicateId) => !acceptanceCoverage.has(predicateId));
  if (uncovered.length > 0) fail(`destination predicates lack acceptance coverage: ${uncovered.join(", ")}`);

  if (blueprint.extensions !== undefined) {
    const extensions = object(blueprint.extensions, "extensions");
    const invalid = Object.keys(extensions).filter((key) => !key.startsWith("x-"));
    if (invalid.length > 0) fail(`extensions keys must start with x-: ${invalid.join(", ")}`);
  }

  return blueprint;
}

export function readBlueprint(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    fail(`cannot read blueprint: ${filePath}: ${error.message}`);
  }
  let parsed;
  try {
    parsed = loadYaml(content);
  } catch (error) {
    fail(`invalid blueprint YAML: ${filePath}: ${error.message}`);
  }
  const blueprint = validateBlueprint(parsed);
  const blueprintDirectory = path.dirname(path.resolve(filePath));
  const briefPaths = new Set();
  const briefContents = [];
  const briefs = {};
  for (const edge of blueprint.edges) {
    const briefRef = edge.brief_ref.replaceAll("/", path.sep);
    if (path.isAbsolute(briefRef)) fail(`edge ${edge.id}.brief_ref must be relative to the blueprint`);
    const briefPath = path.resolve(blueprintDirectory, briefRef);
    const briefIdentity = process.platform === "win32" ? briefPath.toLowerCase() : briefPath;
    if (briefPaths.has(briefIdentity)) fail(`each edge requires an independent Task Brief; duplicate brief_ref: ${edge.brief_ref}`);
    briefPaths.add(briefIdentity);
    if (!fs.existsSync(briefPath) || !fs.statSync(briefPath).isFile()) {
      fail(`edge ${edge.id}.brief_ref not found: ${edge.brief_ref}`);
    }
    const briefContent = fs.readFileSync(briefPath, "utf8");
    const frontmatter = briefContent.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!frontmatter) fail(`edge ${edge.id}.brief_ref lacks YAML frontmatter: ${edge.brief_ref}`);
    let metadata;
    try {
      metadata = object(loadYaml(frontmatter[1]), `Task Brief ${edge.brief_ref} frontmatter`);
    } catch (error) {
      if (error instanceof ModelError) throw error;
      fail(`invalid Task Brief frontmatter: ${edge.brief_ref}: ${error.message}`);
    }
    if (metadata.edge !== edge.id) {
      fail(`Task Brief ${edge.brief_ref} is bound to ${metadata.edge ?? "no edge"}, expected ${edge.id}`);
    }
    if (metadata.contract === undefined) fail(`Task Brief ${edge.brief_ref} lacks required contract metadata`);
    const contract = object(metadata.contract, `Task Brief ${edge.brief_ref} frontmatter.contract`);
    allowedKeys(contract, ["scope", "authorization", "evidence", "failure"], `Task Brief ${edge.brief_ref} contract`);
    const scope = object(contract.scope, `Task Brief ${edge.brief_ref} contract.scope`);
    allowedKeys(scope, ["in", "out"], `Task Brief ${edge.brief_ref} contract.scope`);
    meaningfulStrings(scope.in, `Task Brief ${edge.brief_ref} contract.scope.in`);
    meaningfulStrings(scope.out, `Task Brief ${edge.brief_ref} contract.scope.out`);
    const authorization = object(contract.authorization, `Task Brief ${edge.brief_ref} contract.authorization`);
    allowedKeys(authorization, ["required", "allowed_actions"], `Task Brief ${edge.brief_ref} contract.authorization`);
    meaningfulStrings(authorization.required, `Task Brief ${edge.brief_ref} contract.authorization.required`, { nonEmpty: false });
    meaningfulStrings(authorization.allowed_actions, `Task Brief ${edge.brief_ref} contract.authorization.allowed_actions`);
    const evidence = object(contract.evidence, `Task Brief ${edge.brief_ref} contract.evidence`);
    allowedKeys(evidence, ["proves", "exit_conditions"], `Task Brief ${edge.brief_ref} contract.evidence`);
    const briefProves = ids(evidence.proves, `Task Brief ${edge.brief_ref} contract.evidence.proves`, { nonEmpty: true });
    requireReferences(briefProves, new Map(edge.effects.map((predicateId) => [predicateId, true])), `Task Brief ${edge.brief_ref} evidence.proves`);
    if (new Set(briefProves).size !== new Set(edge.effects).size || edge.effects.some((predicateId) => !briefProves.includes(predicateId))) {
      fail(`Task Brief ${edge.brief_ref} evidence.proves must exactly match edge effects`);
    }
    meaningfulStrings(evidence.exit_conditions, `Task Brief ${edge.brief_ref} contract.evidence.exit_conditions`);
    const failure = object(contract.failure, `Task Brief ${edge.brief_ref} contract.failure`);
    allowedKeys(failure, ["action", "rollback"], `Task Brief ${edge.brief_ref} contract.failure`);
    if (failure.action !== edge.on_failure.action) {
      fail(`Task Brief ${edge.brief_ref} failure.action must match edge on_failure.action`);
    }
    meaningfulStrings(failure.rollback, `Task Brief ${edge.brief_ref} contract.failure.rollback`);
    briefContents.push({ edge: edge.id, ref: edge.brief_ref, content: briefContent });
    briefs[edge.id] = {
      ref: edge.brief_ref,
      metadata: structuredClone(metadata),
      content: briefContent,
    };
  }
  const digest = crypto.createHash("sha256").update(content);
  const briefDigests = {};
  for (const brief of briefContents.sort((left, right) => left.edge.localeCompare(right.edge))) {
    digest.update(`\0${brief.edge}\0${brief.ref}\0${brief.content}`);
    briefDigests[brief.edge] = crypto.createHash("sha256").update(brief.content).digest("hex");
  }
  return {
    blueprint,
    digest: digest.digest("hex"),
    brief_digests: briefDigests,
    briefs,
  };
}

export function initialFacts(blueprint) {
  return Object.fromEntries(blueprint.initial_state.facts.map((fact) => [fact.id, {
    value: fact.value,
    evidence: fact.evidence.map((entry) => ({ ...entry })),
  }]));
}

function maps(blueprint) {
  return {
    predicates: new Map(blueprint.predicates.map((item) => [item.id, item])),
    nodes: new Map(blueprint.nodes.map((item) => [item.id, item])),
    edges: new Map(blueprint.edges.map((item) => [item.id, item])),
    invariants: new Map(blueprint.invariants.map((item) => [item.id, item])),
  };
}

function factValue(facts, factId) {
  const value = facts[factId];
  return typeof value === "string" ? value : value?.value;
}

export function predicateSatisfied(predicateId, facts, blueprint) {
  const predicate = maps(blueprint).predicates.get(predicateId);
  if (!predicate) fail(`unknown predicate: ${predicateId}`);
  return factValue(facts, predicate.fact) === predicate.equals;
}

export function deriveSatisfiedNodes(blueprint, facts) {
  return blueprint.nodes
    .filter((node) => node.predicates.every((predicateId) => predicateSatisfied(predicateId, facts, blueprint)))
    .map((node) => node.id);
}

function invariantPredicates(edge, blueprint, invariantMap) {
  const idsForEdge = new Set(edge.invariants);
  for (const invariantId of blueprint.destination.invariants) {
    const invariant = invariantMap.get(invariantId);
    if (invariant.applies_to.includes(edge.id)) idsForEdge.add(invariantId);
  }
  return [...idsForEdge].flatMap((invariantId) => invariantMap.get(invariantId).requires);
}

export function edgeReadiness(blueprint, facts, edgeId) {
  const { edges, nodes, invariants } = maps(blueprint);
  const edge = edges.get(edgeId);
  if (!edge) fail(`edge is not declared by the map: ${edgeId}`);
  const source = nodes.get(edge.from);
  const missing = [];
  for (const predicateId of source.predicates) {
    if (!predicateSatisfied(predicateId, facts, blueprint)) missing.push({ kind: "source", predicate: predicateId });
  }
  for (const predicateId of edge.preconditions) {
    if (!predicateSatisfied(predicateId, facts, blueprint)) missing.push({ kind: "precondition", predicate: predicateId });
  }
  for (const predicateId of invariantPredicates(edge, blueprint, invariants)) {
    if (!predicateSatisfied(predicateId, facts, blueprint)) missing.push({ kind: "invariant", predicate: predicateId });
  }
  return { ready: missing.length === 0, edge, missing };
}

function acceptedAssumptionFacts(blueprint, facts, predicateMap) {
  const result = structuredClone(facts);
  const conditionalFacts = new Set();
  const usedAssumptions = [];
  for (const assumption of blueprint.assumptions) {
    if (assumption.status !== "accepted") continue;
    const predicate = predicateMap.get(assumption.predicate);
    const current = factValue(result, predicate.fact);
    if (current === undefined || current === "unknown") {
      result[predicate.fact] = { value: predicate.equals, evidence: [] };
      conditionalFacts.add(predicate.fact);
      usedAssumptions.push(assumption.id);
    }
  }
  return { facts: result, conditionalFacts, usedAssumptions };
}

function backwardClosure(blueprint, facts, predicateMap, nodeMap, edgeMap, invariantMap) {
  const neededPredicates = new Set();
  const candidateEdges = new Set();
  const rootPredicates = new Set(blueprint.destination.requires);
  const queue = [...rootPredicates];
  for (const invariantId of blueprint.destination.invariants) {
    for (const predicateId of invariantMap.get(invariantId).requires) queue.push(predicateId);
  }
  const gaps = [];
  while (queue.length > 0) {
    const predicateId = queue.shift();
    if (neededPredicates.has(predicateId)) continue;
    neededPredicates.add(predicateId);
    if (predicateSatisfied(predicateId, facts, blueprint)) continue;
    for (const loop of blueprint.loops.filter((item) => item.exit_predicate === predicateId)) {
      for (const loopEdgeId of loop.edges) {
        const loopEdge = edgeMap.get(loopEdgeId);
        candidateEdges.add(loopEdgeId);
        for (const dependency of [
          ...nodeMap.get(loopEdge.from).predicates,
          ...loopEdge.preconditions,
          ...invariantPredicates(loopEdge, blueprint, invariantMap),
        ]) {
          if (!neededPredicates.has(dependency)) queue.push(dependency);
        }
      }
    }
    const producers = [...edgeMap.values()].filter((edge) => edge.effects.includes(predicateId));
    if (producers.length === 0) {
      if (rootPredicates.has(predicateId)) {
        const classified = classifyMissing(predicateId, blueprint, facts, predicateMap);
        gaps.push({
          type: classified.type === "unsatisfied-precondition" ? "unproduced-goal" : classified.type,
          at_edge: null,
          missing: predicateId,
          caused_by: `${classified.caused_by}; no initial fact or producing edge`,
          repair_scope: `predicate:${predicateId}`,
          category: "structural",
        });
      }
      continue;
    }
    for (const edge of producers) {
      candidateEdges.add(edge.id);
      const source = nodeMap.get(edge.from);
      for (const dependency of [
        ...source.predicates,
        ...edge.preconditions,
        ...invariantPredicates(edge, blueprint, invariantMap),
      ]) {
        if (!neededPredicates.has(dependency)) queue.push(dependency);
      }
    }
  }
  return { neededPredicates, candidateEdges, gaps };
}

function pathExists(from, to, adjacency, seen = new Set()) {
  if (from === to) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  return (adjacency.get(from) ?? []).some((next) => pathExists(next, to, adjacency, seen));
}

function structuralGaps(blueprint, closure, predicateMap, edgeMap, invariantMap) {
  const gaps = [...closure.gaps];
  const nodeMap = new Map(blueprint.nodes.map((node) => [node.id, node]));
  const add = (gap) => {
    const key = `${gap.type}|${gap.at_edge ?? ""}|${gap.missing ?? ""}|${gap.caused_by ?? ""}`;
    if (!gaps.some((entry) => `${entry.type}|${entry.at_edge ?? ""}|${entry.missing ?? ""}|${entry.caused_by ?? ""}` === key)) gaps.push(gap);
  };

  for (const edge of edgeMap.values()) {
    const requiredContracts = edge.evidence_contract.filter((contract) => contract.required);
    const coveredEffects = new Set(requiredContracts.flatMap((contract) => contract.proves));
    const missing = edge.effects.filter((predicateId) => !coveredEffects.has(predicateId));
    if (requiredContracts.length === 0 || missing.length > 0) {
      add({
        type: "missing-evidence-contract",
        at_edge: edge.id,
        missing: missing.length > 0 ? missing.join(",") : "required contract",
        caused_by: "edge effects are not covered by required evidence",
        repair_scope: `edge:${edge.id}`,
        category: "structural",
      });
    }

    const availableAfter = new Set([
      ...nodeMap.get(edge.from).predicates,
      ...edge.preconditions,
      ...invariantPredicates(edge, blueprint, invariantMap),
    ]);
    const overwrittenFacts = new Set(edge.effects.map((predicateId) => predicateMap.get(predicateId).fact));
    for (const predicateId of [...availableAfter]) {
      if (overwrittenFacts.has(predicateMap.get(predicateId).fact)) availableAfter.delete(predicateId);
    }
    for (const effectId of edge.effects) availableAfter.add(effectId);
    const missingTarget = nodeMap.get(edge.to).predicates
      .filter((predicateId) => !availableAfter.has(predicateId));
    if (missingTarget.length > 0) {
      add({
        type: "insufficient-edge-effect",
        at_edge: edge.id,
        missing: missingTarget.join(","),
        caused_by: "edge contract does not establish every predicate of its target state",
        repair_scope: `edge:${edge.id}`,
        category: "structural",
      });
    }
  }

  const bySource = new Map();
  for (const edge of edgeMap.values()) {
    if (!bySource.has(edge.from)) bySource.set(edge.from, []);
    bySource.get(edge.from).push(edge);
  }
  for (const siblings of bySource.values()) {
    for (const producer of siblings) {
      for (const consumer of siblings) {
        if (producer.id === consumer.id) continue;
        const consumerRequirements = new Set([
          ...consumer.preconditions,
          ...invariantPredicates(consumer, blueprint, invariantMap),
        ]);
        const sharedSourcePredicates = new Set(nodeMap.get(consumer.from).predicates);
        const hidden = producer.effects.filter((predicateId) => (
          consumerRequirements.has(predicateId) && !sharedSourcePredicates.has(predicateId)
        ));
        if (hidden.length > 0) {
          add({
            type: "hidden-edge-coupling",
            at_edge: consumer.id,
            missing: hidden.join(","),
            caused_by: `sibling edge ${producer.id} produces a required precondition or invariant`,
            repair_scope: `between:${producer.id}:${consumer.id}`,
            category: "structural",
          });
        }
      }
    }
  }

  for (const edge of edgeMap.values()) {
    const applicableInvariants = new Set(edge.invariants);
    for (const invariantId of blueprint.destination.invariants) {
      if (invariantMap.get(invariantId).applies_to.includes(edge.id)) applicableInvariants.add(invariantId);
    }
    for (const invariantId of applicableInvariants) {
      const invariant = invariantMap.get(invariantId);
      for (const requiredId of invariant.requires) {
        const required = predicateMap.get(requiredId);
        const conflicting = edge.effects.find((effectId) => {
          const effect = predicateMap.get(effectId);
          return effect.fact === required.fact && effect.equals !== required.equals;
        });
        if (conflicting) {
          add({
            type: "invariant-conflict",
            at_edge: edge.id,
            missing: requiredId,
            caused_by: `effect ${conflicting} contradicts invariant ${invariantId}`,
            repair_scope: `edge:${edge.id}`,
            category: "structural",
          });
        }
      }
    }
  }

  const adjacency = new Map();
  for (const edge of edgeMap.values()) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    adjacency.get(edge.from).push(edge.to);
  }
  const contractedEdges = new Set(blueprint.loops.flatMap((loop) => loop.edges));
  for (const edge of edgeMap.values()) {
    if (pathExists(edge.to, edge.from, adjacency) && !contractedEdges.has(edge.id)) {
      add({
        type: "loop-without-progress-contract",
        at_edge: edge.id,
        missing: "progress predicate, exit predicate, and budget",
        caused_by: "edge participates in a cycle not covered by loops",
        repair_scope: `cycle:${edge.from}:${edge.to}`,
        category: "structural",
      });
    }
  }
  const loopMembership = new Map();
  for (const loop of blueprint.loops) {
    const loopNodes = new Set(loop.edges.flatMap((edgeId) => {
      const edge = edgeMap.get(edgeId);
      return [edge.from, edge.to];
    }));
    const exitProduced = [...edgeMap.values()].some((edge) => (
      loopNodes.has(edge.from) && edge.effects.includes(loop.exit_predicate)
    ));
    if (!exitProduced) {
      add({
        type: "loop-exit-not-produced",
        at_edge: null,
        missing: loop.exit_predicate,
        caused_by: `loop ${loop.id} has no exit edge from the loop that produces its exit predicate`,
        repair_scope: `cycle:${edgeMap.get(loop.edges[0]).from}:${edgeMap.get(loop.edges[0]).to}`,
        category: "structural",
      });
    }
    for (const edgeId of loop.edges) {
      if (!loopMembership.has(edgeId)) loopMembership.set(edgeId, []);
      loopMembership.get(edgeId).push(loop.id);
      const edge = edgeMap.get(edgeId);
      if (!pathExists(edge.to, edge.from, adjacency)) {
        add({
          type: "loop-contract-includes-acyclic-edge",
          at_edge: edgeId,
          missing: "cyclic route",
          caused_by: `edge ${edgeId} does not participate in a cycle`,
          repair_scope: `edge:${edgeId}`,
          category: "structural",
        });
      }
      if (!edge.effects.includes(loop.progress_predicate)) {
        add({
          type: "loop-progress-not-produced",
          at_edge: edgeId,
          missing: loop.progress_predicate,
          caused_by: `each execution in loop ${loop.id} must produce observable progress`,
          repair_scope: `edge:${edgeId}`,
          category: "structural",
        });
      }
    }
  }
  for (const [edgeId, loopIds] of loopMembership) {
    if (loopIds.length > 1) {
      add({
        type: "overlapping-loop-contracts",
        at_edge: edgeId,
        missing: "one loop budget owner",
        caused_by: `edge belongs to multiple loops: ${loopIds.join(",")}`,
        repair_scope: `edge:${edgeId}`,
        category: "structural",
      });
    }
  }

  return gaps;
}

function classifyMissing(predicateId, blueprint, facts, predicateMap) {
  const predicate = predicateMap.get(predicateId);
  const value = factValue(facts, predicate.fact);
  const unverified = blueprint.assumptions.find((item) => item.predicate === predicateId && item.status === "unverified");
  if (unverified) return { type: "unsupported-assumption", caused_by: `assumption ${unverified.id} is unverified` };
  if (predicate.kind === "authorization") return { type: "missing-authorization", caused_by: `${predicate.fact}=${value ?? "missing"}` };
  if (value === "unknown") return { type: "blocking-fog", caused_by: `${predicate.fact}=unknown` };
  if (value === "conflict") return { type: "conflicting-fact", caused_by: `${predicate.fact}=conflict` };
  return { type: "unsatisfied-precondition", caused_by: `${predicate.fact}=${value ?? "missing"}` };
}

function addMinimalLogicalGaps(gaps, blueprint, worlds, predicateMap, nodeMap, edgeMap, invariantMap) {
  const keys = new Set(gaps.map((gap) => `${gap.type}|${gap.missing ?? ""}`));
  const add = (gap) => {
    const key = `${gap.type}|${gap.missing ?? ""}`;
    if (!keys.has(key)) {
      keys.add(key);
      gaps.push(gap);
    }
  };
  const goalPredicates = [...new Set([
    ...blueprint.destination.requires,
    ...blueprint.destination.invariants.flatMap((invariantId) => invariantMap.get(invariantId).requires),
  ])];
  const scoreWorld = (world) => goalPredicates.filter((predicateId) => predicateSatisfied(predicateId, world.facts, blueprint)).length;
  const bestWorld = worlds.reduce((best, world) => scoreWorld(world) > scoreWorld(best) ? world : best, worlds[0]);
  const reachableSomewhere = new Set(blueprint.predicates
    .filter((predicate) => worlds.some((world) => predicateSatisfied(predicate.id, world.facts, blueprint)))
    .map((predicate) => predicate.id));
  const loopsByEdge = new Map();
  for (const loop of blueprint.loops) {
    for (const edgeId of loop.edges) {
      if (!loopsByEdge.has(edgeId)) loopsByEdge.set(edgeId, []);
      loopsByEdge.get(edgeId).push(loop);
    }
  }

  for (const goalId of goalPredicates) {
    if (predicateSatisfied(goalId, bestWorld.facts, blueprint)) continue;
    if (reachableSomewhere.has(goalId)) {
      add({
        type: "incompatible-world-state",
        at_edge: null,
        missing: goalId,
        caused_by: "predicate is reachable only in a different fact world from the other destination requirements",
        repair_scope: `predicate:${goalId}`,
        category: "logical",
      });
      return;
    }

    const producers = [...edgeMap.values()].filter((edge) => edge.effects.includes(goalId));
    if (producers.length === 0) {
      const classified = classifyMissing(goalId, blueprint, bestWorld.facts, predicateMap);
      add({
        type: classified.type === "unsatisfied-precondition" ? "unproduced-goal" : classified.type,
        at_edge: null,
        missing: goalId,
        caused_by: `${classified.caused_by}; no fact world or producing edge establishes it`,
        repair_scope: `predicate:${goalId}`,
        category: "logical",
      });
      return;
    }

    const options = producers.map((edge) => {
      const requirements = [
        ...nodeMap.get(edge.from).predicates.map((predicate) => ({ kind: "source", predicate })),
        ...edge.preconditions.map((predicate) => ({ kind: "precondition", predicate })),
        ...invariantPredicates(edge, blueprint, invariantMap).map((predicate) => ({ kind: "invariant", predicate })),
      ].filter((candidate, index, values) => values.findIndex((item) => item.predicate === candidate.predicate) === index);
      const best = worlds.reduce((current, world) => {
        const missing = requirements.filter((candidate) => !predicateSatisfied(candidate.predicate, world.facts, blueprint));
        return missing.length < current.missing.length ? { world, missing } : current;
      }, { world: worlds[0], missing: requirements });
      return { edge, ...best };
    }).sort((left, right) => left.missing.length - right.missing.length || left.edge.id.localeCompare(right.edge.id));
    const selected = options[0];
    if (selected.missing.length === 0) {
      const exhausted = (loopsByEdge.get(selected.edge.id) ?? []).find((loop) => (
        (selected.world.loopIterations?.[loop.id] ?? 0) >= loop.max_iterations
        && !predicateSatisfied(loop.exit_predicate, selected.world.facts, blueprint)
      ));
      add(exhausted ? {
        type: "loop-budget-exhausted",
        at_edge: selected.edge.id,
        missing: exhausted.exit_predicate,
        caused_by: `loop ${exhausted.id} reached max_iterations=${exhausted.max_iterations} without its exit predicate`,
        repair_scope: `cycle:${selected.edge.from}:${selected.edge.to}`,
        category: "logical",
      } : {
        type: "incompatible-world-state",
        at_edge: selected.edge.id,
        missing: goalId,
        caused_by: "the producing edge is locally applicable but cannot coexist with the other destination requirements",
        repair_scope: `subgraph:${selected.edge.from}:${selected.edge.to}`,
        category: "logical",
      });
      return;
    }
    const priority = new Map([
      ["loop-budget-exhausted", 0], ["missing-authorization", 1], ["conflicting-fact", 2],
      ["blocking-fog", 3], ["unsupported-assumption", 4], ["invariant-conflict", 5],
      ["unsatisfied-precondition", 6],
    ]);
    const candidate = selected.missing.map((item) => {
      const exhaustedLoop = blueprint.loops.find((loop) => (
        (loop.progress_predicate === item.predicate || loop.exit_predicate === item.predicate)
        && (selected.world.loopIterations?.[loop.id] ?? 0) >= loop.max_iterations
        && !predicateSatisfied(loop.exit_predicate, selected.world.facts, blueprint)
      ));
      if (exhaustedLoop) {
        return {
          ...item,
          type: "loop-budget-exhausted",
          caused_by: `loop ${exhaustedLoop.id} reached max_iterations=${exhaustedLoop.max_iterations} without its exit predicate`,
        };
      }
      const base = classifyMissing(item.predicate, blueprint, selected.world.facts, predicateMap);
      const classified = item.kind === "invariant" && base.type === "unsatisfied-precondition"
        ? { type: "invariant-conflict", caused_by: base.caused_by }
        : base;
      return { ...item, ...classified };
    }).sort((left, right) => (priority.get(left.type) ?? 99) - (priority.get(right.type) ?? 99))[0];
    add({
      type: candidate.type,
      at_edge: selected.edge.id,
      missing: candidate.predicate,
      caused_by: candidate.caused_by,
      repair_scope: candidate.type === "loop-budget-exhausted"
        ? `cycle:${selected.edge.from}:${selected.edge.to}`
        : `subgraph:${selected.edge.from}:${selected.edge.to}`,
      category: "logical",
    });
    return;
  }
}

export function proveBlueprint(blueprint, observedFacts = initialFacts(blueprint), { loopIterations = {} } = {}) {
  validateBlueprint(blueprint);
  const { predicates: predicateMap, nodes: nodeMap, edges: edgeMap, invariants: invariantMap } = maps(blueprint);
  const destinationPredicates = [...new Set([
    ...blueprint.destination.requires,
    ...blueprint.destination.invariants.flatMap((invariantId) => invariantMap.get(invariantId).requires),
  ])];
  const seeded = acceptedAssumptionFacts(blueprint, observedFacts, predicateMap);
  const closure = backwardClosure(blueprint, seeded.facts, predicateMap, nodeMap, edgeMap, invariantMap);
  const gaps = structuralGaps(blueprint, closure, predicateMap, edgeMap, invariantMap);
  const factIds = [...new Set(blueprint.predicates.map((predicate) => predicate.fact))].sort();
  const loopsByEdge = new Map();
  for (const loop of blueprint.loops) {
    for (const edgeId of loop.edges) {
      if (!loopsByEdge.has(edgeId)) loopsByEdge.set(edgeId, []);
      loopsByEdge.get(edgeId).push(loop);
    }
  }
  const worldKey = (world) => JSON.stringify([
    factIds.map((factId) => factValue(world.facts, factId) ?? null),
    [...world.conditionalFacts].sort(),
    blueprint.loops.map((loop) => world.loopIterations[loop.id] ?? 0),
  ]);
  const predicatesFor = (world) => new Set(blueprint.predicates
    .filter((predicate) => predicateSatisfied(predicate.id, world.facts, blueprint))
    .map((predicate) => predicate.id));
  const nodesFor = (predicateIds) => new Set(blueprint.nodes
    .filter((node) => node.predicates.every((predicateId) => predicateIds.has(predicateId)))
    .map((node) => node.id));

  const initialWorld = {
    facts: structuredClone(seeded.facts),
    conditionalFacts: new Set(seeded.conditionalFacts),
    loopIterations: Object.fromEntries(blueprint.loops.map((loop) => [loop.id, loopIterations[loop.id] ?? 0])),
  };
  const queue = [initialWorld];
  const worlds = [];
  const initialWorldKey = worldKey(initialWorld);
  const visited = new Set([initialWorldKey]);
  const parents = new Map();
  const appliedEdges = new Set();
  const reachedNodes = new Set();
  while (queue.length > 0) {
    const world = queue.shift();
    const currentKey = worldKey(world);
    worlds.push(world);
    const reachablePredicates = predicatesFor(world);
    const satisfiedNodes = nodesFor(reachablePredicates);
    for (const nodeId of satisfiedNodes) reachedNodes.add(nodeId);
    for (const edgeId of closure.candidateEdges) {
      const edge = edgeMap.get(edgeId);
      if (!satisfiedNodes.has(edge.from)) continue;
      const requirements = [...edge.preconditions, ...invariantPredicates(edge, blueprint, invariantMap)];
      if (!requirements.every((predicateId) => reachablePredicates.has(predicateId))) continue;
      const edgeLoops = loopsByEdge.get(edgeId) ?? [];
      if (edgeLoops.some((loop) => predicateSatisfied(loop.exit_predicate, world.facts, blueprint))) continue;
      if (edgeLoops.some((loop) => world.loopIterations[loop.id] >= loop.max_iterations)) continue;
      const conditional = edge.certainty === "conditional" || [
        ...nodeMap.get(edge.from).predicates,
        ...requirements,
      ].some((predicateId) => world.conditionalFacts.has(predicateMap.get(predicateId).fact));
      const next = {
        facts: structuredClone(world.facts),
        conditionalFacts: new Set(world.conditionalFacts),
        loopIterations: { ...world.loopIterations },
      };
      for (const effectId of edge.effects) {
        const effect = predicateMap.get(effectId);
        next.facts[effect.fact] = { value: effect.equals, evidence: [] };
        if (conditional) next.conditionalFacts.add(effect.fact);
        else next.conditionalFacts.delete(effect.fact);
      }
      for (const loop of edgeLoops) next.loopIterations[loop.id] += 1;
      appliedEdges.add(edgeId);
      const key = worldKey(next);
      if (key !== currentKey) {
        if (!parents.has(key)) parents.set(key, []);
        const links = parents.get(key);
        if (!links.some((link) => link.parent === currentKey && link.edge === edgeId)) {
          links.push({ parent: currentKey, edge: edgeId });
        }
      }
      if (!visited.has(key)) {
        visited.add(key);
        queue.push(next);
      }
    }
  }

  const destinationWorlds = worlds.filter((world) => destinationPredicates.every((predicateId) => (
    predicateSatisfied(predicateId, world.facts, blueprint)
  )));
  const destinationReached = destinationWorlds.length > 0;
  const provenEdges = new Set();
  const provenWorlds = new Set(destinationWorlds.map((world) => worldKey(world)));
  const reverseQueue = [...provenWorlds];
  while (reverseQueue.length > 0) {
    const child = reverseQueue.shift();
    for (const link of parents.get(child) ?? []) {
      provenEdges.add(link.edge);
      if (!provenWorlds.has(link.parent)) {
        provenWorlds.add(link.parent);
        reverseQueue.push(link.parent);
      }
    }
  }
  if (!destinationReached) {
    addMinimalLogicalGaps(gaps, blueprint, worlds, predicateMap, nodeMap, edgeMap, invariantMap);
  }
  const structuralComplete = !gaps.some((gap) => gap.category === "structural");
  const unconditionalDestination = destinationWorlds.some((world) => destinationPredicates.every((predicateId) => (
    !world.conditionalFacts.has(predicateMap.get(predicateId).fact)
  )));
  return {
    structural: structuralComplete ? "complete" : "incomplete",
    reachability: destinationReached ? (unconditionalDestination ? "logical" : "conditional") : "unreachable",
    destination_reachable: destinationReached,
    required_predicates: [...closure.neededPredicates],
    candidate_edges: [...closure.candidateEdges],
    proven_edges: [...provenEdges],
    reachable_nodes: [...reachedNodes],
    applied_edges: [...appliedEdges],
    assumptions_used: seeded.usedAssumptions,
    proof_gaps: gaps,
  };
}
