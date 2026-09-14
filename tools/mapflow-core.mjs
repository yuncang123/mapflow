import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { load as loadYaml } from "./vendor/js-yaml/js-yaml.mjs";
import { derivationTrace, normalizeCausalContract } from "./mapflow-proof.mjs";

export const BLUEPRINT_SCHEMA_VERSION = 3;
export const LEGACY_BLUEPRINT_SCHEMA_VERSION = 2;
export const STATE_SCHEMA_VERSION = 2;
export const TRUTH_VALUES = new Set(["true", "false", "unknown", "conflict"]);

const ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const NODE_KINDS = new Set(["state", "decision", "fog", "join", "destination"]);
const PREDICATE_KINDS = new Set(["state", "authorization", "resource", "progress"]);
const CERTAINTIES = new Set(["expected", "conditional"]);
const FAILURE_ACTIONS = new Set(["replan", "branch", "stop"]);
const EVIDENCE_KINDS = new Set(["git", "document", "command", "receipt", "meeting", "note", "observation", "external"]);
const EVIDENCE_STRENGTHS = new Set(["asserted", "observed", "corroborated"]);
const INTENT_STATES = new Set(["draft", "shaped"]);
const PARENT_CLOSE_POLICIES = new Set(["preserve", "cancel", "invalidate"]);

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
  allowedKeys(ref, ["kind", "ref", "observed_at", "strength", "source_event"], label);
  string(ref.kind, `${label}.kind`);
  if (!EVIDENCE_KINDS.has(ref.kind)) fail(`${label}.kind is invalid: ${ref.kind}`);
  string(ref.ref, `${label}.ref`);
  if (ref.observed_at !== undefined) string(ref.observed_at, `${label}.observed_at`);
  if (ref.strength !== undefined && !EVIDENCE_STRENGTHS.has(ref.strength)) {
    fail(`${label}.strength is invalid: ${ref.strength}`);
  }
  if (ref.source_event !== undefined) id(ref.source_event, `${label}.source_event`);
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
    "schema_version", "map_id", "intent", "destination", "predicates", "initial_state", "assumptions",
    "invariants", "boundaries", "nodes", "edges", "loops", "submaps", "workflow", "extensions",
  ], "blueprint");
  if (![LEGACY_BLUEPRINT_SCHEMA_VERSION, BLUEPRINT_SCHEMA_VERSION].includes(blueprint.schema_version)) {
    fail(`unsupported blueprint schema: ${blueprint.schema_version}`);
  }
  id(blueprint.map_id, "map_id");

  if (blueprint.schema_version >= 3 && blueprint.workflow !== undefined) {
    fail("workflow profiles are not part of Mapflow schema 3; keep domain lifecycles under extensions.x-* or in the target project");
  }
  if (blueprint.schema_version === LEGACY_BLUEPRINT_SCHEMA_VERSION && blueprint.workflow !== undefined) {
    object(blueprint.workflow, "legacy workflow");
  }

  if (blueprint.intent === undefined) {
    blueprint.intent = {
      statement: blueprint.destination?.statement ?? "Legacy Mapflow intent",
      status: "shaped",
      open_questions: [],
      legacy_inferred: true,
    };
  }
  const intent = object(blueprint.intent, "intent");
  allowedKeys(intent, ["statement", "status", "open_questions", "legacy_inferred"], "intent");
  string(intent.statement, "intent.statement");
  if (!INTENT_STATES.has(intent.status)) fail(`intent.status is invalid: ${intent.status}`);
  meaningfulStrings(intent.open_questions, "intent.open_questions", { nonEmpty: false });
  if (intent.legacy_inferred !== undefined && intent.legacy_inferred !== true) fail("intent.legacy_inferred must be true when present");

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
      "certainty", "evidence_contract", "causal_contract", "on_failure", "sdlc_stage",
    ], `edge ${edge.id}`);
    if (blueprint.schema_version >= 3 && edge.sdlc_stage !== undefined) {
      fail(`edge ${edge.id}.sdlc_stage is not part of Mapflow schema 3; express project-specific stages in extensions.x-*`);
    }
    if (edge.sdlc_stage !== undefined) {
      string(edge.sdlc_stage, `legacy edge ${edge.id}.sdlc_stage`);
    }
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
    if (blueprint.schema_version >= 3 && edge.causal_contract === undefined) {
      fail(`edge ${edge.id}.causal_contract is required by blueprint schema ${blueprint.schema_version}`);
    }
    try {
      normalizeCausalContract(blueprint, edge);
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
    const onFailure = object(edge.on_failure, `edge ${edge.id}.on_failure`);
    allowedKeys(onFailure, ["action", "to"], `edge ${edge.id}.on_failure`);
    if (!FAILURE_ACTIONS.has(onFailure.action)) fail(`edge ${edge.id}.on_failure.action is invalid: ${onFailure.action}`);
    if (onFailure.action === "branch") {
      id(onFailure.to, `edge ${edge.id}.on_failure.to`);
    } else if (onFailure.to !== undefined) {
      fail(`edge ${edge.id}.on_failure.to is only valid for branch`);
    }
  }
  for (const invariant of invariantMap.values()) {
    requireReferences(invariant.applies_to, edgeMap, `invariant ${invariant.id}.applies_to`);
  }
  for (const edge of edgeMap.values()) {
    if (edge.on_failure.action === "branch") {
      requireReferences([edge.on_failure.to], edgeMap, `edge ${edge.id}.on_failure.to`);
      if (edge.on_failure.to === edge.id) fail(`edge ${edge.id}.on_failure.to cannot branch to itself`);
    }
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
        ...causalPredicates(edge, blueprint),
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

  if (blueprint.submaps === undefined) blueprint.submaps = [];
  const submaps = array(blueprint.submaps, "submaps");
  const submapMap = collectionMap(submaps, "submaps");
  const boundEdges = new Set();
  for (const binding of submapMap.values()) {
    allowedKeys(binding, [
      "id", "parent_edge", "map_ref", "state_ref", "expected_map_id", "expected_map_digest",
      "await", "on_parent_close", "exports",
    ], `submap ${binding.id}`);
    id(binding.parent_edge, `submap ${binding.id}.parent_edge`);
    requireReferences([binding.parent_edge], edgeMap, `submap ${binding.id}.parent_edge`);
    if (boundEdges.has(binding.parent_edge)) fail(`edge ${binding.parent_edge} has more than one submap binding`);
    boundEdges.add(binding.parent_edge);
    for (const field of ["map_ref", "state_ref", "expected_map_id", "expected_map_digest"]) {
      string(binding[field], `submap ${binding.id}.${field}`);
    }
    if (path.isAbsolute(binding.map_ref) || path.isAbsolute(binding.state_ref)) {
      fail(`submap ${binding.id} map_ref and state_ref must be relative to the parent blueprint`);
    }
    id(binding.expected_map_id, `submap ${binding.id}.expected_map_id`);
    if (!/^[a-f0-9]{64}$/.test(binding.expected_map_digest)) fail(`submap ${binding.id}.expected_map_digest must be a sha256 hex digest`);
    if (binding.await !== "arrival") fail(`submap ${binding.id}.await must be arrival`);
    if (!PARENT_CLOSE_POLICIES.has(binding.on_parent_close)) {
      fail(`submap ${binding.id}.on_parent_close is invalid: ${binding.on_parent_close}`);
    }
    const exports = array(binding.exports, `submap ${binding.id}.exports`, { nonEmpty: true });
    const exportMap = collectionMap(exports, `submap ${binding.id}.exports`);
    const parentEdge = edgeMap.get(binding.parent_edge);
    const exportedParentPredicates = new Set();
    for (const item of exportMap.values()) {
      allowedKeys(item, ["id", "child_acceptance", "child_predicates", "proves_parent"], `submap ${binding.id} export ${item.id}`);
      id(item.child_acceptance, `submap ${binding.id} export ${item.id}.child_acceptance`);
      ids(item.child_predicates, `submap ${binding.id} export ${item.id}.child_predicates`, { nonEmpty: true });
      ids(item.proves_parent, `submap ${binding.id} export ${item.id}.proves_parent`, { nonEmpty: true });
      const outside = item.proves_parent.filter((predicateId) => !parentEdge.effects.includes(predicateId));
      if (outside.length > 0) fail(`submap ${binding.id} exports predicates outside parent edge effects: ${outside.join(", ")}`);
      item.proves_parent.forEach((predicateId) => exportedParentPredicates.add(predicateId));
    }
    const uncoveredEffects = parentEdge.effects.filter((predicateId) => !exportedParentPredicates.has(predicateId));
    if (uncoveredEffects.length > 0) fail(`submap ${binding.id} does not export parent edge effects: ${uncoveredEffects.join(", ")}`);
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
    allowedKeys(contract, ["scope", "authorization", "evidence", "verification", "failure", "handoff", "context"], `Task Brief ${edge.brief_ref} contract`);
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
    if (contract.handoff !== undefined) {
      const handoff = object(contract.handoff, `Task Brief ${edge.brief_ref} contract.handoff`);
      allowedKeys(handoff, ["from_roles", "to_roles", "inputs", "outputs", "decision_rights"], `Task Brief ${edge.brief_ref} contract.handoff`);
      for (const field of ["from_roles", "to_roles", "inputs", "outputs", "decision_rights"]) {
        meaningfulStrings(handoff[field], `Task Brief ${edge.brief_ref} contract.handoff.${field}`);
      }
    }
    if (contract.context !== undefined) {
      const context = object(contract.context, `Task Brief ${edge.brief_ref} contract.context`);
      allowedKeys(context, ["focus", "load_first", "load_on_demand", "budget"], `Task Brief ${edge.brief_ref} contract.context`);
      string(context.focus, `Task Brief ${edge.brief_ref} contract.context.focus`);
      const loadFirst = meaningfulStrings(context.load_first, `Task Brief ${edge.brief_ref} contract.context.load_first`);
      if (loadFirst.length > 5) fail(`Task Brief ${edge.brief_ref} context.load_first must contain at most 5 focused references`);
      const loadOnDemand = array(context.load_on_demand, `Task Brief ${edge.brief_ref} contract.context.load_on_demand`, { nonEmpty: false });
      for (let index = 0; index < loadOnDemand.length; index += 1) {
        const disclosure = object(loadOnDemand[index], `Task Brief ${edge.brief_ref} context.load_on_demand[${index}]`);
        allowedKeys(disclosure, ["when", "refs"], `Task Brief ${edge.brief_ref} context.load_on_demand[${index}]`);
        string(disclosure.when, `Task Brief ${edge.brief_ref} context.load_on_demand[${index}].when`);
        meaningfulStrings(disclosure.refs, `Task Brief ${edge.brief_ref} context.load_on_demand[${index}].refs`);
      }
      const budget = object(context.budget, `Task Brief ${edge.brief_ref} contract.context.budget`);
      allowedKeys(budget, ["max_files", "max_chars"], `Task Brief ${edge.brief_ref} contract.context.budget`);
      if (!Number.isInteger(budget.max_files) || budget.max_files < 1 || budget.max_files > 20) {
        fail(`Task Brief ${edge.brief_ref} context.budget.max_files must be an integer from 1 to 20`);
      }
      if (loadFirst.length > budget.max_files) {
        fail(`Task Brief ${edge.brief_ref} context.load_first exceeds context.budget.max_files`);
      }
      if (!Number.isInteger(budget.max_chars) || budget.max_chars < 1000 || budget.max_chars > 200000) {
        fail(`Task Brief ${edge.brief_ref} context.budget.max_chars must be an integer from 1000 to 200000`);
      }
    }
    let commandMap = new Map();
    if (contract.verification !== undefined) {
      const verification = object(contract.verification, `Task Brief ${edge.brief_ref} contract.verification`);
      allowedKeys(verification, ["commands"], `Task Brief ${edge.brief_ref} contract.verification`);
      const commands = array(verification.commands, `Task Brief ${edge.brief_ref} contract.verification.commands`, { nonEmpty: true });
      commandMap = collectionMap(commands, `Task Brief ${edge.brief_ref} verification.commands`);
      for (const command of commandMap.values()) {
        allowedKeys(command, ["id", "program", "args", "cwd", "timeout_seconds", "success_exit_codes", "proves"], `Task Brief ${edge.brief_ref} verifier ${command.id}`);
        string(command.program, `Task Brief ${edge.brief_ref} verifier ${command.id}.program`);
        meaningfulStrings(command.args, `Task Brief ${edge.brief_ref} verifier ${command.id}.args`, { nonEmpty: false });
        if (!new Set(["workspace", "map"]).has(command.cwd)) fail(`Task Brief ${edge.brief_ref} verifier ${command.id}.cwd must be workspace or map`);
        if (!Number.isInteger(command.timeout_seconds) || command.timeout_seconds < 1 || command.timeout_seconds > 600) {
          fail(`Task Brief ${edge.brief_ref} verifier ${command.id}.timeout_seconds must be between 1 and 600`);
        }
        const successCodes = array(command.success_exit_codes, `Task Brief ${edge.brief_ref} verifier ${command.id}.success_exit_codes`, { nonEmpty: true });
        if (successCodes.some((code) => !Number.isInteger(code) || code < 0 || code > 255) || new Set(successCodes).size !== successCodes.length) {
          fail(`Task Brief ${edge.brief_ref} verifier ${command.id}.success_exit_codes must contain unique integers from 0 to 255`);
        }
        const verifierProves = ids(command.proves, `Task Brief ${edge.brief_ref} verifier ${command.id}.proves`, { nonEmpty: true });
        requireReferences(verifierProves, new Map(edge.effects.map((predicateId) => [predicateId, true])), `Task Brief ${edge.brief_ref} verifier ${command.id}.proves`);
      }
    }
    const causal = normalizeCausalContract(blueprint, edge);
    if (causal.rule_basis?.kind === "verifier") {
      const verifier = commandMap.get(causal.rule_basis.ref);
      if (!verifier) {
        fail(`edge ${edge.id}.causal_contract.rule_basis.ref does not name a Task Brief verifier: ${causal.rule_basis.ref}`);
      }
      const missingConclusions = causal.conclusions.filter((predicateId) => !verifier.proves.includes(predicateId));
      if (missingConclusions.length > 0) {
        fail(`Task Brief verifier ${causal.rule_basis.ref} does not cover causal conclusions: ${missingConclusions.join(", ")}`);
      }
    }
    if (causal.rule_basis?.kind === "submap") {
      const binding = blueprint.submaps.find((item) => item.parent_edge === edge.id && item.id === causal.rule_basis.ref);
      if (!binding) fail(`edge ${edge.id}.causal_contract.rule_basis.ref does not name its submap binding: ${causal.rule_basis.ref}`);
    }
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

export function validateSubmapTree(filePath) {
  const rootPath = path.resolve(filePath);
  const seenMapIds = new Map();
  let bindings = 0;
  function visit(currentPath, ancestors = []) {
    const identityPath = process.platform === "win32" ? currentPath.toLowerCase() : currentPath;
    if (ancestors.includes(identityPath)) fail(`submap cycle detected at: ${currentPath}`);
    const loaded = readBlueprint(currentPath);
    const previousPath = seenMapIds.get(loaded.blueprint.map_id);
    if (previousPath) fail(`duplicate submap map_id ${loaded.blueprint.map_id}: ${previousPath}, ${currentPath}`);
    seenMapIds.set(loaded.blueprint.map_id, identityPath);
    const directory = path.dirname(currentPath);
    for (const binding of loaded.blueprint.submaps) {
      bindings += 1;
      const childPath = path.resolve(directory, binding.map_ref.replaceAll("/", path.sep));
      const childIdentityPath = process.platform === "win32" ? childPath.toLowerCase() : childPath;
      if ([...ancestors, identityPath].includes(childIdentityPath)) fail(`submap cycle detected at: ${childPath}`);
      const child = readBlueprint(childPath);
      if (child.blueprint.map_id !== binding.expected_map_id) {
        fail(`submap ${binding.id} expected map_id ${binding.expected_map_id}, found ${child.blueprint.map_id}`);
      }
      if (child.digest !== binding.expected_map_digest) {
        fail(`submap ${binding.id} expected digest ${binding.expected_map_digest}, found ${child.digest}; restore the pinned child version or initialize a successor parent map`);
      }
      const acceptanceMap = new Map(child.blueprint.destination.acceptance.map((item) => [item.id, item]));
      const predicateIds = new Set(child.blueprint.predicates.map((item) => item.id));
      for (const exported of binding.exports) {
        const acceptance = acceptanceMap.get(exported.child_acceptance);
        if (!acceptance) fail(`submap ${binding.id} export ${exported.id} references unknown child acceptance: ${exported.child_acceptance}`);
        const unknownPredicates = exported.child_predicates.filter((predicateId) => !predicateIds.has(predicateId));
        if (unknownPredicates.length > 0) fail(`submap ${binding.id} export ${exported.id} references unknown child predicates: ${unknownPredicates.join(", ")}`);
        const notCovered = exported.child_predicates.filter((predicateId) => !acceptance.proves.includes(predicateId));
        if (notCovered.length > 0) fail(`submap ${binding.id} export ${exported.id} predicates lack acceptance coverage: ${notCovered.join(", ")}`);
      }
      visit(childPath, [...ancestors, identityPath]);
    }
    return loaded;
  }
  const loaded = visit(rootPath);
  return { ...loaded, maps: seenMapIds.size, bindings };
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

function causalPredicates(edge, blueprint) {
  return normalizeCausalContract(blueprint, edge).premises;
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
  const known = new Set(missing.map((entry) => entry.predicate));
  for (const predicateId of causalPredicates(edge, blueprint)) {
    if (!predicateSatisfied(predicateId, facts, blueprint) && !known.has(predicateId)) missing.push({ kind: "causal-premise", predicate: predicateId });
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
          ...causalPredicates(loopEdge, blueprint),
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
        ...causalPredicates(edge, blueprint),
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
  const availableAfterEdge = (edge) => {
    const available = new Set([
      ...nodeMap.get(edge.from).predicates,
      ...edge.preconditions,
      ...invariantPredicates(edge, blueprint, invariantMap),
      ...causalPredicates(edge, blueprint),
    ]);
    const overwrittenFacts = new Set(edge.effects.map((predicateId) => predicateMap.get(predicateId).fact));
    for (const predicateId of [...available]) {
      if (overwrittenFacts.has(predicateMap.get(predicateId).fact)) available.delete(predicateId);
    }
    for (const effectId of edge.effects) available.add(effectId);
    return available;
  };
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

    const target = nodeMap.get(edge.to);
    // A Join is an AND state: independent incoming edges may each establish a
    // different part of it. Requiring every incoming edge to establish the
    // entire state would collapse genuine parallel work back into one edge.
    if (target.kind === "join") continue;
    const availableAfter = availableAfterEdge(edge);
    const missingTarget = target.predicates
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

  for (const node of nodeMap.values()) {
    if (node.kind !== "join") continue;
    const incoming = [...edgeMap.values()].filter((edge) => edge.to === node.id);
    const collectiveCoverage = new Set(incoming.flatMap((edge) => [...availableAfterEdge(edge)]));
    const missing = node.predicates.filter((predicateId) => !collectiveCoverage.has(predicateId));
    if (missing.length > 0) {
      add({
        type: "insufficient-join-coverage",
        at_edge: null,
        missing: missing.join(","),
        caused_by: "incoming edge contracts do not collectively establish every predicate of the join state",
        repair_scope: `node:${node.id}`,
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
        ...causalPredicates(edge, blueprint).map((predicate) => ({ kind: "causal-premise", predicate })),
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

function proofId(prefix, value) {
  return `${prefix}-${crypto.createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}

function causalFrontierGaps(blueprint, closure, worlds, appliedEdges, nodeMap) {
  const gaps = [];
  for (const edgeId of closure.candidateEdges) {
    if (appliedEdges.has(edgeId)) continue;
    const edge = blueprint.edges.find((item) => item.id === edgeId);
    const frontier = worlds
      .filter((world) => nodeMap.get(edge.from).predicates.every((predicateId) => predicateSatisfied(predicateId, world.facts, blueprint)))
      .map((world) => derivationTrace(blueprint, edge, world.facts))
      .filter((trace) => !trace.valid)
      .map((trace) => ({
        trace,
        missing: trace.premises.filter((item) => !item.satisfied).map((item) => item.predicate),
        stale: trace.premises.filter((item) => item.stale).map((item) => item.predicate),
      }))
      .sort((left, right) => (
        left.missing.length + left.stale.length - right.missing.length - right.stale.length
      ));
    if (frontier.length === 0) continue;
    const best = frontier[0];
    if (best.missing.length > 0) {
      gaps.push({
        type: "causal-premise-not-established",
        at_edge: edge.id,
        missing: best.missing.join(","),
        caused_by: `causal rule ${best.trace.rule} has no reachable world containing every premise`,
        repair_scope: `edge:${edge.id}`,
        category: "causal",
      });
    }
    if (best.stale.length > 0) {
      gaps.push({
        type: "causal-premise-stale",
        at_edge: edge.id,
        missing: best.stale.join(","),
        caused_by: `causal rule ${best.trace.rule} has stale premise evidence at the reachable frontier`,
        repair_scope: `edge:${edge.id}`,
        category: "causal",
      });
    }
  }
  return gaps;
}

function buildDerivationGraph({ blueprint, worlds, worldKey, initialWorldKey, applications, parents, destinationWorlds, destinationPredicates, provenApplicationIds }) {
  const worldIds = new Map(worlds.map((world) => {
    const key = worldKey(world);
    return [key, proofId("world", key)];
  }));
  const predicateSets = new Map(worlds.map((world) => {
    const key = worldKey(world);
    return [key, new Set(blueprint.predicates
      .filter((predicate) => predicateSatisfied(predicate.id, world.facts, blueprint))
      .map((predicate) => predicate.id))];
  }));
  const initialWorld = worlds.find((world) => worldKey(world) === initialWorldKey);
  const assumptionIds = new Map();
  for (const assumption of blueprint.assumptions.filter((item) => item.status === "accepted")) {
    if (!assumptionIds.has(assumption.predicate)) assumptionIds.set(assumption.predicate, []);
    assumptionIds.get(assumption.predicate).push(assumption.id);
  }
  const axioms = [...predicateSets.get(initialWorldKey)].map((predicateId) => {
    const predicate = blueprint.predicates.find((item) => item.id === predicateId);
    const conditional = initialWorld.conditionalFacts.has(predicate.fact);
    return {
      id: `axiom-${predicateId}`,
      predicate: predicateId,
      fact: predicate.fact,
      value: predicate.equals,
      source: conditional ? "accepted-assumption" : "initial-fact",
      assumptions: conditional ? [...(assumptionIds.get(predicateId) ?? [])] : [],
      evidence: structuredClone(initialWorld.facts[predicate.fact]?.evidence ?? []),
    };
  });
  const applicationById = new Map(applications.map((application) => [application.id, application]));
  const incoming = new Map();
  for (const application of applications) {
    if (!incoming.has(application.to_key)) incoming.set(application.to_key, []);
    incoming.get(application.to_key).push(application);
  }
  const supports = [];
  for (const world of worlds) {
    const key = worldKey(world);
    const worldId = worldIds.get(key);
    for (const predicateId of predicateSets.get(key)) {
      const alternatives = [];
      if (key === initialWorldKey) {
        alternatives.push({ kind: "axiom", ref: `axiom-${predicateId}` });
      }
      for (const application of incoming.get(key) ?? []) {
        if (application.trace.conclusions.some((item) => item.predicate === predicateId)) {
          alternatives.push({ kind: "rule", ref: application.id });
        } else if (predicateSets.get(application.from_key)?.has(predicateId)) {
          alternatives.push({
            kind: "carry",
            ref: `support-${worldIds.get(application.from_key)}-${predicateId}`,
            through: application.id,
          });
        }
      }
      const uniqueAlternatives = alternatives.filter((item, index, values) => (
        values.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(item)) === index
      ));
      supports.push({
        id: `support-${worldId}-${predicateId}`,
        world: worldId,
        predicate: predicateId,
        alternatives: uniqueAlternatives,
      });
    }
  }
  const routeCountMemo = new Map([[initialWorldKey, 1n]]);
  const routeCount = (key) => {
    if (routeCountMemo.has(key)) return routeCountMemo.get(key);
    const count = (parents.get(key) ?? []).reduce((sum, link) => sum + routeCount(link.parent), 0n);
    routeCountMemo.set(key, count);
    return count;
  };
  const primaryRoute = (key) => {
    if (key === initialWorldKey) return [];
    const candidates = [...(parents.get(key) ?? [])].sort((left, right) => (
      left.edge.localeCompare(right.edge) || left.parent.localeCompare(right.parent)
    ));
    if (candidates.length === 0) return [];
    return [...primaryRoute(candidates[0].parent), candidates[0].application];
  };
  const destinations = destinationWorlds.map((world) => {
    const key = worldKey(world);
    const worldId = worldIds.get(key);
    const route = primaryRoute(key);
    return {
      world: worldId,
      route_count: routeCount(key).toString(),
      primary_route: route,
      predicates: destinationPredicates.map((predicateId) => ({
        predicate: predicateId,
        support: `support-${worldId}-${predicateId}`,
      })),
    };
  }).sort((left, right) => {
    const leftConditional = worlds.find((world) => worldIds.get(worldKey(world)) === left.world).conditionalFacts.size;
    const rightConditional = worlds.find((world) => worldIds.get(worldKey(world)) === right.world).conditionalFacts.size;
    return leftConditional - rightConditional || left.primary_route.length - right.primary_route.length || left.world.localeCompare(right.world);
  });
  const serializedApplications = applications.map((application) => ({
    id: application.id,
    edge: application.edge,
    rule: application.trace.rule,
    proof_mode: application.trace.proof_mode,
    rule_basis: application.trace.rule_basis,
    from_world: worldIds.get(application.from_key),
    to_world: worldIds.get(application.to_key),
    premises: application.trace.premises.map((premise) => ({
      ...premise,
      support: `support-${worldIds.get(application.from_key)}-${premise.predicate}`,
    })),
    conclusions: application.trace.conclusions.map((conclusion) => ({
      ...conclusion,
      support: `support-${worldIds.get(application.to_key)}-${conclusion.predicate}`,
    })),
    conditional: application.conditional,
    on_destination_route: provenApplicationIds.has(application.id),
  }));
  const primary = destinations[0] ?? null;
  const totalRoutes = destinations.reduce((sum, destination) => sum + BigInt(destination.route_count), 0n);
  const graph = {
    schema: "mapflow.derivation-graph/v1",
    complete: true,
    initial_world: worldIds.get(initialWorldKey),
    axioms,
    worlds: worlds.map((world) => {
      const key = worldKey(world);
      return {
        id: worldIds.get(key),
        facts: Object.fromEntries(Object.entries(world.facts).map(([factId, fact]) => [factId, factValue(world.facts, factId)])),
        conditional_facts: [...world.conditionalFacts].sort(),
        applied_edges: [...world.appliedEdges].sort(),
        loop_iterations: { ...world.loopIterations },
      };
    }),
    applications: serializedApplications,
    predicate_supports: supports,
    destinations,
    route_count: totalRoutes.toString(),
    primary_proof: primary === null ? null : {
      destination_world: primary.world,
      applications: [...primary.primary_route],
      edges: primary.primary_route.map((id) => applicationById.get(id).edge),
      predicate_supports: structuredClone(primary.predicates),
    },
  };
  return {
    ...graph,
    digest: crypto.createHash("sha256").update(JSON.stringify(graph)).digest("hex"),
  };
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
    [...world.appliedEdges].sort(),
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
    appliedEdges: new Set(),
  };
  const queue = [initialWorld];
  const worlds = [];
  const initialWorldKey = worldKey(initialWorld);
  const visited = new Set([initialWorldKey]);
  const parents = new Map();
  const applications = [];
  const applicationKeys = new Set();
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
      const edgeLoops = loopsByEdge.get(edgeId) ?? [];
      if (edgeLoops.length === 0 && world.appliedEdges.has(edgeId)) continue;
      if (edgeLoops.some((loop) => predicateSatisfied(loop.exit_predicate, world.facts, blueprint))) continue;
      if (edgeLoops.some((loop) => world.loopIterations[loop.id] >= loop.max_iterations)) continue;
      const trace = derivationTrace(blueprint, edge, world.facts);
      if (!trace.valid) continue;
      const requirements = trace.premises.map((item) => item.predicate);
      const conditional = edge.certainty === "conditional" || [
        ...nodeMap.get(edge.from).predicates,
        ...requirements,
      ].some((predicateId) => world.conditionalFacts.has(predicateMap.get(predicateId).fact));
      const next = {
        facts: structuredClone(world.facts),
        conditionalFacts: new Set(world.conditionalFacts),
        loopIterations: { ...world.loopIterations },
        appliedEdges: new Set(world.appliedEdges),
      };
      for (const effectId of edge.effects) {
        const effect = predicateMap.get(effectId);
        next.facts[effect.fact] = { value: effect.equals, evidence: [] };
        if (conditional) next.conditionalFacts.add(effect.fact);
        else next.conditionalFacts.delete(effect.fact);
      }
      next.appliedEdges.add(edgeId);
      for (const loop of edgeLoops) next.loopIterations[loop.id] += 1;
      appliedEdges.add(edgeId);
      const key = worldKey(next);
      if (key !== currentKey) {
        const applicationKey = `${currentKey}\0${edgeId}\0${key}`;
        const applicationId = proofId("apply", applicationKey);
        if (!applicationKeys.has(applicationKey)) {
          applicationKeys.add(applicationKey);
          applications.push({
            id: applicationId,
            edge: edgeId,
            from_key: currentKey,
            to_key: key,
            trace,
            conditional,
          });
        }
        if (!parents.has(key)) parents.set(key, []);
        const links = parents.get(key);
        if (!links.some((link) => link.parent === currentKey && link.edge === edgeId)) {
          links.push({ parent: currentKey, edge: edgeId, application: applicationId });
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
  const provenApplicationIds = new Set();
  const provenWorlds = new Set(destinationWorlds.map((world) => worldKey(world)));
  const reverseQueue = [...provenWorlds];
  while (reverseQueue.length > 0) {
    const child = reverseQueue.shift();
    for (const link of parents.get(child) ?? []) {
      provenEdges.add(link.edge);
      provenApplicationIds.add(link.application);
      if (!provenWorlds.has(link.parent)) {
        provenWorlds.add(link.parent);
        reverseQueue.push(link.parent);
      }
    }
  }
  if (!destinationReached) {
    addMinimalLogicalGaps(gaps, blueprint, worlds, predicateMap, nodeMap, edgeMap, invariantMap);
  }
  const frontierCausalGaps = causalFrontierGaps(blueprint, closure, worlds, appliedEdges, nodeMap);
  if (!destinationReached) gaps.push(...frontierCausalGaps.filter((gap) => !gaps.some((item) => item.type === gap.type && item.at_edge === gap.at_edge && item.missing === gap.missing)));
  const structuralComplete = !gaps.some((gap) => gap.category === "structural");
  const unconditionalDestination = destinationWorlds.some((world) => destinationPredicates.every((predicateId) => (
    !world.conditionalFacts.has(predicateMap.get(predicateId).fact)
  )));
  const proofGraph = buildDerivationGraph({
    blueprint,
    worlds,
    worldKey,
    initialWorldKey,
    applications,
    parents,
    destinationWorlds,
    destinationPredicates,
    provenApplicationIds,
  });
  const derivations = Object.fromEntries(blueprint.edges.map((edge) => {
    const edgeApplications = applications.filter((application) => application.edge === edge.id);
    return [edge.id, {
      rule: normalizeCausalContract(blueprint, edge).rule_id,
      status: edgeApplications.some((application) => provenApplicationIds.has(application.id))
        ? "destination-proof"
        : edgeApplications.length > 0 ? "reachable" : "not-applied",
      applications: edgeApplications.map((application) => application.id),
    }];
  }));
  const causalSoundness = (closure.candidateEdges.size > 0 || blueprint.schema_version >= 3)
    && [...closure.candidateEdges].every((edgeId) => edgeMap.get(edgeId).causal_contract !== undefined)
    ? "explicit"
    : "legacy-inferred";
  const reachability = destinationReached ? (unconditionalDestination ? "logical" : "conditional") : "unreachable";
  const readyProvenEdges = [...provenEdges].filter((edgeId) => edgeReadiness(blueprint, seeded.facts, edgeId).ready);
  return {
    structural: structuralComplete ? "complete" : "incomplete",
    reachability,
    proof_level: "model",
    causal_soundness: causalSoundness,
    evidence_levels: {
      structural_soundness: {
        status: structuralComplete ? "established" : "failed",
        basis: "schema, reference, topology, evidence-contract, and causal-contract validation",
      },
      declared_model_derivability: {
        status: reachability,
        basis: "forward search over isolated fact worlds using declared causal rules",
        derivation_graph_digest: proofGraph.digest,
      },
      runtime_readiness: {
        status: readyProvenEdges.length > 0 ? "ready" : destinationReached ? "not-ready" : "blocked",
        ready_edges: readyProvenEdges,
        basis: "current observed facts satisfy a destination-reaching edge frontier",
      },
      executed_derivation: {
        status: "not-observed",
        basis: "requires executed verifier, external readback, or submap receipt evidence",
      },
      audited_arrival: {
        status: "not-observed",
        basis: "requires observed destination acceptance and a separately consumed audit request",
      },
    },
    destination_reachable: destinationReached,
    required_predicates: [...closure.neededPredicates],
    candidate_edges: [...closure.candidateEdges],
    proven_edges: [...provenEdges],
    reachable_nodes: [...reachedNodes],
    applied_edges: [...appliedEdges],
    assumptions_used: seeded.usedAssumptions,
    proof_gaps: gaps,
    causal_gaps: destinationReached ? [] : frontierCausalGaps,
    rejected_alternatives: destinationReached ? frontierCausalGaps : [],
    derivations,
    derivation_graph: proofGraph,
  };
}

// Goal regression is a projection of the route-design reasoning. It deliberately
// keeps hypothetical suffix proofs separate from observed runtime facts.
export function buildGoalRegression(blueprint, observedFacts = initialFacts(blueprint), { proof = null, destinationStatus = "draft", loopIterations = {} } = {}) {
  validateBlueprint(blueprint);
  const { predicates: predicateMap, nodes: nodeMap, edges: edgeMap, invariants: invariantMap } = maps(blueprint);
  const facts = structuredClone(observedFacts);
  const forwardProof = proof ?? proveBlueprint(blueprint, facts);
  const observedNodeIds = new Set();
  for (const node of blueprint.nodes) {
    const settled = node.predicates.every((predicateId) => {
      const predicate = predicateMap.get(predicateId);
      const value = factValue(facts, predicate.fact);
      return value === predicate.equals && !["unknown", "conflict"].includes(value);
    });
    if (settled) observedNodeIds.add(node.id);
  }
  const modelReachableNodeIds = new Set(forwardProof.reachable_nodes ?? []);
  const destinationNode = blueprint.nodes.find((node) => node.kind === "destination")
    ?? blueprint.nodes.find((node) => node.id === blueprint.map_id)
    ?? null;
  const destinationPredicateIds = [...new Set([
    ...blueprint.destination.requires,
    ...blueprint.destination.invariants.flatMap((invariantId) => invariantMap.get(invariantId).requires),
  ])];
  const invariantRequirements = (edge) => causalPredicates(edge, blueprint);

  const targetPredicatesFor = (nodeId, root = false) => {
    const node = nodeMap.get(nodeId);
    return [...new Set(root ? destinationPredicateIds : (node?.predicates ?? []))];
  };
  const statusForNode = (nodeId) => {
    const node = nodeMap.get(nodeId);
    if (!node) return "unreachable";
    if (node.predicates.some((predicateId) => ["unknown", "conflict"].includes(factValue(facts, predicateMap.get(predicateId).fact)))) {
      return "fog";
    }
    if (observedNodeIds.has(nodeId)) return "observed";
    if (modelReachableNodeIds.has(nodeId)) {
      return forwardProof.reachability === "conditional" ? "conditional" : "logical";
    }
    return "unreachable";
  };
  const suffixForNode = (nodeId, root = false) => {
    const node = nodeMap.get(nodeId);
    const seeded = structuredClone(facts);
    const seededPredicates = targetPredicatesFor(nodeId, root);
    for (const predicateId of seededPredicates) {
      const predicate = predicateMap.get(predicateId);
      seeded[predicate.fact] = { value: predicate.equals, evidence: [] };
    }
    const suffixProof = proveBlueprint(blueprint, seeded, { loopIterations });
    return {
      status: suffixProof.destination_reachable
        ? suffixProof.reachability
        : "unreachable",
      structural: suffixProof.structural,
      destination_reachable: suffixProof.destination_reachable,
      proven_edges: [...(suffixProof.proven_edges ?? [])],
      proof_gaps: (suffixProof.proof_gaps ?? []).filter((gap) => (
        !gap.at_edge || suffixProof.candidate_edges?.includes(gap.at_edge)
      )),
      seeded_predicates: seededPredicates,
      target_node: node?.id ?? nodeId,
    };
  };

  const stepMap = new Map();
  const queue = [];
  if (destinationNode) queue.push({ nodeId: destinationNode.id, depth: 0, root: true });
  else queue.push({ nodeId: "<destination>", depth: 0, root: true });
  const queuedDepth = new Map();
  while (queue.length > 0) {
    const current = queue.shift();
    const existingDepth = queuedDepth.get(current.nodeId);
    if (existingDepth !== undefined && existingDepth <= current.depth) continue;
    queuedDepth.set(current.nodeId, current.depth);
    const targetNode = nodeMap.get(current.nodeId) ?? {
      id: current.nodeId,
      label: blueprint.destination.statement,
      kind: "destination",
      predicates: destinationPredicateIds,
    };
    const targetPredicates = targetPredicatesFor(current.nodeId, current.root);
    const declaredIncoming = [...edgeMap.values()].filter((edge) => edge.to === targetNode.id);
    const producers = declaredIncoming.length > 0
      ? declaredIncoming
      : [...edgeMap.values()].filter((edge) => (
        edge.effects.some((effectId) => targetPredicates.includes(effectId))
        || (current.root && destinationPredicateIds.some((predicateId) => edge.effects.includes(predicateId)))
      ));
    const suffix = suffixForNode(current.nodeId, current.root);
    const prefixStatus = statusForNode(current.nodeId);
    const step = {
      depth: current.depth,
      target_node: targetNode.id,
      target_label: targetNode.label,
      target_kind: targetNode.kind,
      required_predicates: targetPredicates,
      prefix_reachability: {
        status: prefixStatus,
        observed: observedNodeIds.has(current.nodeId),
        modeled: modelReachableNodeIds.has(current.nodeId),
      },
      suffix_proof: suffix,
      bridge_status: suffix.status === "unreachable"
        ? "suffix-unproven"
        : observedNodeIds.has(current.nodeId)
          ? "connected"
          : modelReachableNodeIds.has(current.nodeId)
            ? "model-only"
            : "awaiting-prefix",
      confirmed: true,
      human_confirmed: true,
      formal: true,
      confirmation_source: "formal-blueprint",
      incoming_edges: producers.map((edge) => {
        const requirements = [...new Set([
          ...nodeMap.get(edge.from).predicates,
          ...edge.preconditions,
          ...invariantRequirements(edge),
        ])];
        return {
          edge_id: edge.id,
          from: edge.from,
          to: edge.to,
          required_predicates: requirements,
          effects: [...edge.effects],
          brief_ref: edge.brief_ref,
          certainty: edge.certainty,
          acceptance_contract: cloneContracts(edge.evidence_contract),
          non_goals: [],
          suffix_proven: suffix.proven_edges.includes(edge.id),
          confirmed: true,
          human_confirmed: true,
          formal: true,
          confirmation_source: "formal-blueprint",
        };
      }),
    };
    stepMap.set(current.nodeId, step);
    for (const edge of producers) {
      if (nodeMap.has(edge.from)) queue.push({ nodeId: edge.from, depth: current.depth + 1, root: false });
    }
  }

  const steps = [...stepMap.values()].sort((left, right) => left.depth - right.depth || left.target_node.localeCompare(right.target_node));
  const edges = [...new Set(steps.flatMap((step) => step.incoming_edges.map((edge) => edge.edge_id)))];
  const originNode = blueprint.nodes.find((node) => node.kind === "fog")
    ?? blueprint.nodes.find((node) => node.predicates.some((predicateId) => (
      predicateSatisfied(predicateId, facts, blueprint)
    )))
    ?? null;
  const terminalSteps = steps.filter((step) => step.incoming_edges.length === 0);
  const completeChain = terminalSteps.length > 0 && terminalSteps.every((step) => {
    const node = nodeMap.get(step.target_node);
    return node?.kind === "fog" || observedNodeIds.has(step.target_node);
  });
  return {
    roots: destinationNode ? [destinationNode.id] : [],
    origin_nodes: originNode ? [originNode.id] : [],
    destination: destinationNode ? {
      node_id: destinationNode.id,
      label: destinationNode.label,
      status: blueprint.intent.status === "draft" || destinationStatus === "draft" ? "fog" : "defined",
    } : {
      node_id: null,
      label: blueprint.destination.statement,
      status: "fog",
    },
    steps,
    edge_ids: edges,
    complete_chain: completeChain,
    generated_from: "destination-backward-regression",
  };
}

function cloneContracts(contracts) {
  return (contracts ?? []).map((contract) => structuredClone(contract));
}
