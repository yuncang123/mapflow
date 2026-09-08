import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { dump as dumpYaml, load as loadYaml } from "./vendor/js-yaml/js-yaml.mjs";

export const WAYFINDING_SCHEMA_VERSION = 1;

export class WayfindingError extends Error {}

export function initialWayfindingDraft() {
  const startingQuestion = "当前工作区已经成立、尚未确认或相互冲突的事实分别是什么？";
  return {
    schema_version: WAYFINDING_SCHEMA_VERSION,
    phase: "survey",
    intent: {
      statement: "尚未收敛工作意图",
      status: "draft",
      open_questions: [startingQuestion],
    },
    origin: {
      id: "workspace-origin-fog",
      kind: "fog",
      label: "始发地仍在迷雾中",
      facts: [
        {
          id: "workspace-starting-state-known",
          value: "unknown",
          evidence: [],
        },
      ],
    },
    destination: {
      id: "workspace-destination-fog",
      kind: "fog",
      label: "目的地仍在迷雾中",
      statement: "尚未收敛为可验收结果",
      status: "pending",
      requires: [],
      invariants: [],
      acceptance: [],
    },
    boundaries: {
      in_scope: [],
      out_of_scope: [],
      authorization: [],
    },
    nodes: [],
    edges: [],
    questions: [
      {
        id: "establish-starting-state",
        prompt: startingQuestion,
        target: {
          kind: "node",
          id: "workspace-origin-fog",
          label: "始发地仍在迷雾中",
          purpose: "以四值事实和来源证据固定当前起始状态",
        },
        status: "pending",
        answer_updates: ["wayfinding.intent.open_questions"],
      },
    ],
  };
}

const ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const TRUTH_VALUES = new Set(["true", "false", "unknown", "conflict"]);
const NODE_KINDS = new Set(["fog", "state", "decision", "join", "destination"]);
const ITEM_STATUS = new Set(["pending", "answered", "confirmed", "rejected", "deferred"]);
const QUESTION_TARGETS = new Set(["node", "edge", "predicate", "destination"]);

function fail(message) {
  throw new WayfindingError(message);
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return value;
}

function array(value, label) {
  if (!Array.isArray(value)) fail(`${label} must be a list`);
  return value;
}

function string(value, label, { nonEmpty = true } = {}) {
  if (typeof value !== "string" || (nonEmpty && value.trim() === "")) fail(`${label} must be a ${nonEmpty ? "non-empty " : ""}string`);
  return value;
}

function id(value, label) {
  string(value, label);
  if (!ID_PATTERN.test(value)) fail(`${label} is not a semantic id: ${value}`);
  return value;
}

function ids(value, label) {
  return array(value, label).map((item) => id(item, `${label} item`));
}

function strings(value, label) {
  return array(value, label).map((item, index) => string(item, `${label}[${index}]`));
}

function allowedKeys(value, keys, label) {
  const allowed = new Set(keys);
  const invalid = Object.keys(value).filter((key) => !allowed.has(key));
  if (invalid.length) fail(`${label} has unsupported fields: ${invalid.join(", ")}`);
}

function evidenceRefs(value, label) {
  return array(value, label).map((entry, index) => {
    const ref = object(entry, `${label}[${index}]`);
    allowedKeys(ref, ["kind", "ref", "strength"], `${label}[${index}]`);
    string(ref.kind, `${label}[${index}].kind`);
    string(ref.ref, `${label}[${index}].ref`);
    if (ref.strength !== undefined) string(ref.strength, `${label}[${index}].strength`);
    return ref;
  });
}

function validateFacts(value, label) {
  return array(value, label).map((fact, index) => {
    const entry = object(fact, `${label}[${index}]`);
    allowedKeys(entry, ["id", "value", "evidence"], `${label}[${index}]`);
    id(entry.id, `${label}[${index}].id`);
    if (!TRUTH_VALUES.has(entry.value)) fail(`${label}[${index}].value is invalid: ${entry.value}`);
    evidenceRefs(entry.evidence ?? [], `${label}[${index}].evidence`);
    return entry;
  });
}

function validateCandidateNode(value, label) {
  const node = object(value, label);
  allowedKeys(node, ["id", "kind", "label", "purpose", "status", "facts", "question_refs", "non_goals", "acceptance", "proof"], label);
  id(node.id, `${label}.id`);
  if (!NODE_KINDS.has(node.kind)) fail(`${label}.kind is invalid: ${node.kind}`);
  string(node.label, `${label}.label`);
  string(node.purpose, `${label}.purpose`);
  if (node.status !== undefined && !ITEM_STATUS.has(node.status)) fail(`${label}.status is invalid: ${node.status}`);
  if (node.facts !== undefined) validateFacts(node.facts, `${label}.facts`);
  if (node.question_refs !== undefined) ids(node.question_refs, `${label}.question_refs`);
  if (node.non_goals !== undefined) strings(node.non_goals, `${label}.non_goals`);
  if (node.acceptance !== undefined) validateAcceptance(node.acceptance, `${label}.acceptance`);
  if (node.proof !== undefined) validateProof(node.proof, `${label}.proof`);
  return node;
}

function validateCandidateEdge(value, label) {
  const edge = object(value, label);
  allowedKeys(edge, [
    "id", "from", "to", "label", "purpose", "status", "question_refs", "brief_ref", "preconditions",
    "effects", "invariants", "evidence_contract", "acceptance", "non_goals", "certainty", "on_failure", "proof",
  ], label);
  id(edge.id, `${label}.id`);
  id(edge.from, `${label}.from`);
  id(edge.to, `${label}.to`);
  string(edge.label, `${label}.label`);
  string(edge.purpose, `${label}.purpose`);
  if (edge.status !== undefined && !ITEM_STATUS.has(edge.status)) fail(`${label}.status is invalid: ${edge.status}`);
  if (edge.question_refs !== undefined) ids(edge.question_refs, `${label}.question_refs`);
  if (edge.brief_ref !== undefined) string(edge.brief_ref, `${label}.brief_ref`);
  for (const field of ["preconditions", "effects", "invariants"]) {
    if (edge[field] !== undefined) ids(edge[field], `${label}.${field}`);
  }
  if (edge.evidence_contract !== undefined) validateEvidenceContracts(edge.evidence_contract, `${label}.evidence_contract`);
  if (edge.acceptance !== undefined) validateAcceptance(edge.acceptance, `${label}.acceptance`);
  if (edge.non_goals !== undefined) strings(edge.non_goals, `${label}.non_goals`);
  if (edge.certainty !== undefined) string(edge.certainty, `${label}.certainty`);
  if (edge.on_failure !== undefined) validateFailure(edge.on_failure, `${label}.on_failure`);
  if (edge.proof !== undefined) validateProof(edge.proof, `${label}.proof`);
  return edge;
}

function validateEvidenceContracts(value, label) {
  array(value, label).forEach((entry, index) => {
    const contract = object(entry, `${label}[${index}]`);
    allowedKeys(contract, ["id", "proves", "required", "proof"], `${label}[${index}]`);
    id(contract.id, `${label}[${index}].id`);
    ids(contract.proves ?? [], `${label}[${index}].proves`);
    if (contract.required !== undefined && typeof contract.required !== "boolean") fail(`${label}[${index}].required must be boolean`);
    if (contract.proof !== undefined) string(contract.proof, `${label}[${index}].proof`);
  });
}

function validateAcceptance(value, label) {
  array(value, label).forEach((entry, index) => {
    const acceptance = object(entry, `${label}[${index}]`);
    allowedKeys(acceptance, ["id", "proves", "proof", "status"], `${label}[${index}]`);
    id(acceptance.id, `${label}[${index}].id`);
    ids(acceptance.proves ?? [], `${label}[${index}].proves`);
    string(acceptance.proof, `${label}[${index}].proof`);
    if (acceptance.status !== undefined && !ITEM_STATUS.has(acceptance.status)) fail(`${label}[${index}].status is invalid: ${acceptance.status}`);
  });
}

function validateBoundaries(value, label) {
  const boundaries = object(value, label);
  allowedKeys(boundaries, ["in_scope", "out_of_scope", "authorization"], label);
  for (const field of ["in_scope", "out_of_scope", "authorization"]) {
    strings(boundaries[field] ?? [], `${label}.${field}`);
  }
  return boundaries;
}

function validateProof(value, label) {
  const proof = object(value, label);
  allowedKeys(proof, ["status", "summary", "missing", "evidence_refs"], label);
  if (proof.status !== undefined) string(proof.status, `${label}.status`);
  if (proof.summary !== undefined) string(proof.summary, `${label}.summary`);
  if (proof.missing !== undefined) strings(proof.missing, `${label}.missing`);
  if (proof.evidence_refs !== undefined) evidenceRefs(proof.evidence_refs, `${label}.evidence_refs`);
}

function validateFailure(value, label) {
  if (typeof value === "string") {
    string(value, label);
    return;
  }
  const failure = object(value, label);
  allowedKeys(failure, ["action", "edge", "scope"], label);
  string(failure.action, `${label}.action`);
  if (failure.edge !== undefined) id(failure.edge, `${label}.edge`);
  if (failure.scope !== undefined) string(failure.scope, `${label}.scope`);
}

export function validateWayfinding(value) {
  const draft = object(value, "wayfinding");
  allowedKeys(draft, ["schema_version", "phase", "intent", "origin", "destination", "boundaries", "nodes", "edges", "questions", "updated_at"], "wayfinding");
  if (draft.schema_version !== WAYFINDING_SCHEMA_VERSION) fail(`unsupported wayfinding schema: ${draft.schema_version}`);
  if (!new Set(["survey", "shaping", "regression"]).has(draft.phase)) fail(`wayfinding.phase is invalid: ${draft.phase}`);

  const intent = object(draft.intent, "wayfinding.intent");
  allowedKeys(intent, ["statement", "status", "open_questions"], "wayfinding.intent");
  string(intent.statement, "wayfinding.intent.statement");
  if (!new Set(["draft", "shaped"]).has(intent.status)) fail(`wayfinding.intent.status is invalid: ${intent.status}`);
  array(intent.open_questions, "wayfinding.intent.open_questions").forEach((question, index) => string(question, `wayfinding.intent.open_questions[${index}]`));

  const origin = object(draft.origin, "wayfinding.origin");
  allowedKeys(origin, ["id", "kind", "label", "facts"], "wayfinding.origin");
  id(origin.id, "wayfinding.origin.id");
  if (!new Set(["fog", "state"]).has(origin.kind)) fail(`wayfinding.origin.kind is invalid: ${origin.kind}`);
  string(origin.label, "wayfinding.origin.label");
  validateFacts(origin.facts ?? [], "wayfinding.origin.facts");

  if (draft.destination !== undefined) {
    const destination = object(draft.destination, "wayfinding.destination");
    allowedKeys(destination, ["id", "kind", "label", "statement", "status", "requires", "invariants", "acceptance"], "wayfinding.destination");
    id(destination.id, "wayfinding.destination.id");
    if (!new Set(["fog", "destination"]).has(destination.kind)) fail(`wayfinding.destination.kind is invalid: ${destination.kind}`);
    string(destination.label, "wayfinding.destination.label");
    string(destination.statement, "wayfinding.destination.statement");
    if (destination.status !== undefined && !ITEM_STATUS.has(destination.status)) fail(`wayfinding.destination.status is invalid: ${destination.status}`);
    if (destination.requires !== undefined) ids(destination.requires, "wayfinding.destination.requires");
    if (destination.invariants !== undefined) ids(destination.invariants, "wayfinding.destination.invariants");
    if (destination.acceptance !== undefined) validateAcceptance(destination.acceptance, "wayfinding.destination.acceptance");
  }

  if (draft.boundaries !== undefined) validateBoundaries(draft.boundaries, "wayfinding.boundaries");

  if (draft.phase === "regression") {
    if (!draft.destination) fail("wayfinding.regression requires a destination candidate");
    if (draft.intent.status !== "shaped" || draft.intent.open_questions.length > 0) {
      fail("wayfinding.regression requires a shaped Intent with no open questions");
    }
    if (draft.destination.status !== "confirmed" && draft.destination.status !== "destination") {
      fail("wayfinding.regression requires a human-confirmed destination");
    }
    if (!Array.isArray(draft.destination.requires) || draft.destination.requires.length === 0) {
      fail("wayfinding.regression requires destination.requires");
    }
    if (!Array.isArray(draft.destination.invariants)) {
      fail("wayfinding.regression requires destination.invariants (use [] when none apply)");
    }
    if (!Array.isArray(draft.destination.acceptance) || draft.destination.acceptance.length === 0) {
      fail("wayfinding.regression requires destination.acceptance");
    }
    const acceptanceCoverage = new Set(draft.destination.acceptance.flatMap((item) => item.proves ?? []));
    const uncovered = draft.destination.requires.filter((predicateId) => !acceptanceCoverage.has(predicateId));
    if (uncovered.length > 0) {
      fail(`wayfinding.destination acceptance does not cover required predicates: ${uncovered.join(", ")}`);
    }
    if (!draft.boundaries) {
      fail("wayfinding.regression requires explicit boundaries");
    }
  }

  const draftNodes = array(draft.nodes ?? [], "wayfinding.nodes");
  draftNodes.forEach((node, index) => validateCandidateNode(node, `wayfinding.nodes[${index}]`));
  const knownNodeIds = new Set([origin.id, ...(draft.destination ? [draft.destination.id] : []), ...draftNodes.map((node) => node.id)]);
  const allNodeIds = [...knownNodeIds];
  if (allNodeIds.length !== 1 + (draft.destination ? 1 : 0) + draftNodes.length) fail("wayfinding node ids must be unique");
  const draftEdges = array(draft.edges ?? [], "wayfinding.edges");
  draftEdges.forEach((edge, index) => {
    validateCandidateEdge(edge, `wayfinding.edges[${index}]`);
    if (!knownNodeIds.has(edge.from) || !knownNodeIds.has(edge.to)) fail(`wayfinding.edges[${index}] references an unknown candidate node`);
    if (draft.phase !== "regression" && draft.destination && edge.from === origin.id && edge.to === draft.destination.id) {
      fail(`wayfinding.edges[${index}] cannot create an origin-to-destination placeholder before regression`);
    }
    if (draft.phase === "regression") {
      for (const field of ["preconditions", "effects", "invariants", "evidence_contract", "acceptance", "non_goals"]) {
        if (!Array.isArray(edge[field]) || edge[field].length === 0) {
          fail(`wayfinding.edges[${index}].${field} is required for regression candidates`);
        }
      }
      if (!edge.brief_ref) fail(`wayfinding.edges[${index}].brief_ref is required for regression candidates`);
      if (!edge.proof || !edge.proof.status || !edge.proof.summary) {
        fail(`wayfinding.edges[${index}].proof.status and proof.summary are required for regression candidates`);
      }
      if (edge.on_failure === undefined) fail(`wayfinding.edges[${index}].on_failure is required for regression candidates`);
    }
  });
  if (draft.phase !== "regression" && draftEdges.length > 0) {
    fail(`wayfinding.${draft.phase} cannot declare candidate edges before destination regression`);
  }
  const allEdgeIds = new Set(draftEdges.map((edge) => edge.id));
  if (allEdgeIds.size !== draftEdges.length) fail("wayfinding edge ids must be unique");
  const questions = array(draft.questions ?? [], "wayfinding.questions");
  questions.forEach((question, index) => {
    const entry = object(question, `wayfinding.questions[${index}]`);
    allowedKeys(entry, ["id", "prompt", "target", "status", "answer", "evidence_refs", "answer_updates"], `wayfinding.questions[${index}]`);
    id(entry.id, `wayfinding.questions[${index}].id`);
    string(entry.prompt, `wayfinding.questions[${index}].prompt`);
    const target = object(entry.target, `wayfinding.questions[${index}].target`);
    allowedKeys(target, ["kind", "id", "label", "purpose"], `wayfinding.questions[${index}].target`);
    if (!QUESTION_TARGETS.has(target.kind)) fail(`wayfinding.questions[${index}].target.kind is invalid: ${target.kind}`);
    id(target.id, `wayfinding.questions[${index}].target.id`);
    string(target.label, `wayfinding.questions[${index}].target.label`);
    string(target.purpose, `wayfinding.questions[${index}].target.purpose`);
    if (entry.status !== undefined && !ITEM_STATUS.has(entry.status)) fail(`wayfinding.questions[${index}].status is invalid: ${entry.status}`);
    if (entry.answer !== undefined) string(entry.answer, `wayfinding.questions[${index}].answer`);
    if (entry.evidence_refs !== undefined) evidenceRefs(entry.evidence_refs, `wayfinding.questions[${index}].evidence_refs`);
    if (entry.answer_updates !== undefined) strings(entry.answer_updates, `wayfinding.questions[${index}].answer_updates`);
    if (target.kind === "node" && !knownNodeIds.has(target.id)) fail(`wayfinding.questions[${index}] targets an unknown candidate node`);
    if (target.kind === "edge" && !allEdgeIds.has(target.id)) fail(`wayfinding.questions[${index}] targets an unknown candidate edge`);
    if (target.kind === "destination" && !draft.destination) fail(`wayfinding.questions[${index}] targets a destination that has not been declared`);
    if (target.kind === "destination" && draft.destination && target.id !== draft.destination.id) fail(`wayfinding.questions[${index}] targets the wrong destination`);
  });
  const pendingQuestions = questions.filter((question) => (question.status ?? "pending") === "pending");
  if (pendingQuestions.length > 1) {
    fail(`wayfinding.questions can contain at most one pending question; found: ${pendingQuestions.map((question) => question.id).join(", ")}`);
  }
  if (draft.updated_at !== undefined) string(draft.updated_at, "wayfinding.updated_at");
  return draft;
}

export function readWayfinding(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    fail(`cannot read wayfinding draft: ${filePath}: ${error.message}`);
  }
  let parsed;
  try {
    parsed = loadYaml(content);
  } catch (error) {
    fail(`invalid wayfinding YAML: ${filePath}: ${error.message}`);
  }
  return {
    draft: validateWayfinding(parsed),
    digest: crypto.createHash("sha256").update(content).digest("hex"),
    path: path.resolve(filePath),
  };
}

export function writeWayfinding(filePath, value) {
  const draft = structuredClone(value);
  draft.updated_at = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  validateWayfinding(draft);
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, dumpYaml(draft, { lineWidth: -1, noRefs: true }), "utf8");
  fs.renameSync(temporary, filePath);
  return readWayfinding(filePath);
}

export function importWayfinding(filePath, draftFilePath) {
  const loaded = readWayfinding(draftFilePath);
  return writeWayfinding(filePath, loaded.draft);
}

export function answerWayfindingQuestion(filePath, { questionId, answer, evidenceRefs: refs = [] }) {
  const loaded = readWayfinding(filePath);
  const draft = structuredClone(loaded.draft);
  const question = draft.questions.find((item) => item.id === questionId);
  if (!question) fail(`unknown wayfinding question: ${questionId}`);
  if ((question.status ?? "pending") !== "pending") fail(`wayfinding question is not pending: ${questionId}`);
  string(answer, "wayfinding answer");
  question.status = "answered";
  question.answer = answer;
  question.evidence_refs = evidenceRefs(refs, "wayfinding answer evidence_refs");
  const appliedUpdates = [];
  if (question.answer_updates?.includes("wayfinding.intent.open_questions")) {
    draft.intent.open_questions = draft.intent.open_questions.length === 1
      ? []
      : draft.intent.open_questions.filter((item) => item !== question.prompt && item !== question.id);
    appliedUpdates.push("wayfinding.intent.open_questions");
  }
  const pendingUpdates = (question.answer_updates ?? [])
    .filter((update) => !appliedUpdates.includes(update));
  writeWayfinding(filePath, draft);
  return {
    question: structuredClone(question),
    appliedUpdates,
    pendingUpdates,
    digest: readWayfinding(filePath).digest,
  };
}
