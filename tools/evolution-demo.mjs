#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { readBlueprint } from "./mapflow-core.mjs";
import { readWayfinding } from "./mapflow-wayfinding.mjs";
import { startBoardServer } from "./mapflow-board.mjs";

const TOOL_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(TOOL_DIRECTORY, "..");
const CLI = path.join(TOOL_DIRECTORY, "mapflow.mjs");
const EXAMPLE = path.join(PACKAGE_ROOT, "examples", "library-system-evolution");

function run(cwd, ...args) {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `command failed: ${args.join(" ")}`);
  return result.stdout.trim();
}

function main() {
  const args = new Set(process.argv.slice(2));
  const noServe = args.has("--no-serve");
  const pendingArrival = args.has("--pending-arrival");
  const portIndex = process.argv.indexOf("--port");
  const port = portIndex >= 0 ? process.argv[portIndex + 1] : "4196";
  const workspaceIndex = process.argv.indexOf("--workspace");
  const mapflowHomeIndex = process.argv.indexOf("--mapflow-home");
  const workspace = workspaceIndex >= 0
    ? path.resolve(process.argv[workspaceIndex + 1])
    : fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-library-demo-"));
  const mapflowHome = mapflowHomeIndex >= 0
    ? path.resolve(process.argv[mapflowHomeIndex + 1])
    : fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-library-sidecar-"));
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(mapflowHome, { recursive: true });
  const readmePath = path.join(workspace, "README.md");
  if (!fs.existsSync(readmePath)) fs.writeFileSync(readmePath, "# Empty library system demo workspace\n", "utf8");
  const git = spawnSync("git", ["init", "--quiet", workspace], { encoding: "utf8", windowsHide: true });
  if (git.status !== 0) throw new Error(git.stderr || "git init failed");

  const planned = readBlueprint(path.join(EXAMPLE, "blueprint.yaml"));
  const blueprint = planned.blueprint;
  const nodeById = new Map(blueprint.nodes.map((node) => [node.id, node]));
  const destinationNode = blueprint.nodes.find((node) => node.kind === "destination");
  const enabled = JSON.parse(run(workspace, "enable", "--root", workspace, "--mapflow-home", mapflowHome, "--json"));
  const stateArgs = ["--state", enabled.paths.state];
  const revisionBound = new Set([
    "wayfinding-write", "wayfinding-answer", "init", "prove", "assign-decision-owner", "start",
    "request-authorization", "authorize", "decline-authorization", "issue-action", "wait", "block",
    "resume", "cancel", "propose", "confirm", "reject", "verify", "verify-executed", "verify-submap",
    "replan", "continue", "request-arrival-audit", "arrive", "rebuild", "status", "context", "gate", "next-actions",
  ]);
  const command = (...commandArgs) => {
    const snapshot = JSON.parse(run(
      workspace, "snapshot", "--root", workspace, "--mapflow-home", mapflowHome, "--json",
    ));
    const guarded = revisionBound.has(commandArgs[0])
      ? [...commandArgs, "--expected-revision", snapshot.head.revision]
      : commandArgs;
    return run(workspace, ...stateArgs, ...guarded);
  };
  const answer = (question, value) => command(
    "wayfinding-answer", "--question", question, "--answer", value,
    "--evidence-ref", `note:demo-${question}`, "--actor", "human:demo",
  );
  const candidatePath = path.join(mapflowHome, "candidate-wayfinding.json");
  const revise = (reason, change) => {
    const draft = readWayfinding(enabled.paths.wayfinding).draft;
    change(draft);
    fs.writeFileSync(candidatePath, `${JSON.stringify(draft, null, 2)}\n`, "utf8");
    command("wayfinding-write", "--draft-file", candidatePath, "--reason", reason, "--actor", "agent:demo");
  };
  const projectNode = (id) => {
    const node = nodeById.get(id);
    return {
      id: node.id,
      kind: node.kind,
      label: node.label,
      purpose: `固定 Predicate：${node.predicates.join("、")}`,
      status: "confirmed",
    };
  };
  const projectEdge = (id) => {
    const edge = blueprint.edges.find((item) => item.id === id);
    const brief = planned.briefs[id];
    const destinationAcceptance = blueprint.destination.acceptance.filter((item) => item.proves.some((predicate) => edge.effects.includes(predicate)));
    return {
      id: edge.id,
      from: edge.from,
      to: edge.to,
      label: brief.metadata.title ?? edge.id,
      purpose: `从 ${nodeById.get(edge.from).label} 推导到 ${nodeById.get(edge.to).label}`,
      status: "confirmed",
      brief_ref: edge.brief_ref,
      preconditions: structuredClone(edge.preconditions),
      effects: structuredClone(edge.effects),
      invariants: structuredClone(edge.invariants),
      evidence_contract: structuredClone(edge.evidence_contract),
      causal_contract: structuredClone(edge.causal_contract),
      acceptance: structuredClone(destinationAcceptance.length > 0 ? destinationAcceptance : [{
        id: `${edge.id}-exit`,
        proves: edge.effects,
        proof: brief.metadata.contract.evidence.exit_conditions.join("；"),
      }]),
      non_goals: structuredClone(brief.metadata.contract.scope.out),
      certainty: edge.certainty,
      on_failure: structuredClone(edge.on_failure),
      proof: { status: "logical", summary: "该后缀在声明的因果合同下可达", missing: [], evidence_refs: [] },
    };
  };

  answer("establish-starting-state", "已勘探：仓库存在，但没有实现、测试或已确认的核心用户旅程");
  revise("用四值事实固定现场，并把唯一问题转向目的地", (draft) => {
    draft.phase = "shaping";
    draft.intent.statement = "为个人藏书开发一个可验收的本地管理系统";
    draft.intent.open_questions = ["第一版必须完成哪条用户旅程？"];
    draft.origin.label = "仓库存在，核心旅程和实现仍在迷雾中";
    draft.origin.facts = [
      { id: "repository-present", value: "true", evidence: [{ kind: "git", ref: "empty demo repository" }] },
      { id: "core-journey-known", value: "unknown", evidence: [] },
      { id: "implementation-present", value: "false", evidence: [{ kind: "observation", ref: "workspace contains README only" }] },
    ];
    draft.destination.label = "图书管理 MVP 目的地尚未定形";
    draft.destination.statement = "个人能够管理自己的藏书";
    draft.questions.push({
      id: "shape-library-destination",
      prompt: "第一版必须完成哪些可观察结果，明确排除什么？",
      target: { kind: "destination", id: draft.destination.id, label: draft.destination.label, purpose: "收敛目标 Predicate、验收、非目标和授权边界" },
      status: "pending",
      answer_updates: ["wayfinding.destination", "wayfinding.boundaries"],
    });
  });

  answer("shape-library-destination", "必须完成新增、搜索、借出、归还并通过自动检查和人工演示；排除多用户、云同步、推荐和部署");
  revise("形成完整目的地合同，但仍等待独立人工确认", (draft) => {
    draft.destination.requires = structuredClone(blueprint.destination.requires);
    draft.destination.invariants = structuredClone(blueprint.destination.invariants);
    draft.destination.acceptance = structuredClone(blueprint.destination.acceptance);
    draft.boundaries = structuredClone(blueprint.boundaries);
    draft.intent.open_questions = ["是否确认这份目的地合同？"];
    draft.questions.push({
      id: "confirm-library-destination",
      prompt: "是否明确确认这份目的地 Predicate、验收和非目标合同？",
      target: { kind: "destination", id: draft.destination.id, label: draft.destination.label, purpose: "由人确认目的地，允许开始反向目标回归" },
      status: "pending",
      answer_updates: ["wayfinding.intent.status", "wayfinding.destination.status"],
    });
  });

  answer("confirm-library-destination", "我确认这份图书管理 MVP 目的地合同");
  revise("从目的地反推验收与集成后缀", (draft) => {
    draft.phase = "regression";
    draft.intent.status = "shaped";
    draft.intent.open_questions = [];
    draft.destination.kind = "destination";
    draft.destination.status = "confirmed";
    draft.destination.label = destinationNode.label;
    draft.nodes.push(projectNode("mvp-integrated"));
    draft.edges.push(projectEdge("accept-library-mvp"));
  });
  revise("继续反推并行实现与设计合同网络", (draft) => {
    draft.nodes.push(
      projectNode("core-journey-confirmed"),
      projectNode("engineering-design-ready"),
      projectNode("engineering-design-reviewed"),
      projectNode("independent-slices-ready"),
    );
    draft.edges.push(
      projectEdge("design-domain-model"),
      projectEdge("design-api-contract"),
      projectEdge("review-engineering-design"),
      projectEdge("build-catalog-slice"),
      projectEdge("build-circulation-slice"),
      projectEdge("integrate-library-slices"),
    );
  });
  revise("以核心旅程边闭合到有证据的始发状态，并完成候选链整体审阅", (draft) => {
    draft.edges.push(projectEdge("confirm-core-journey"));
  });

  fs.copyFileSync(path.join(EXAMPLE, "blueprint.yaml"), enabled.paths.map);
  fs.cpSync(path.join(EXAMPLE, "briefs"), enabled.paths.briefs, { recursive: true, force: true });
  command("validate", "--map", enabled.paths.map);
  command("init", "--map", enabled.paths.map);

  const runtimeEdges = [
    ["confirm-core-journey", ""],
    ["design-domain-model", ""],
    ["design-api-contract", ""],
    ["review-engineering-design", "engineering-design-accepted"],
    ["build-catalog-slice", "catalog-slice-accepted"],
    ["build-circulation-slice", "circulation-slice-accepted"],
    ["integrate-library-slices", "library-integration-accepted"],
    ["accept-library-mvp", "library-demo-accepted"],
  ];
  for (const [edgeId, acceptance] of runtimeEdges) {
    const required = planned.briefs[edgeId].metadata.contract.authorization.required;
    if (required.length > 0) {
      const authorization = JSON.parse(command(
        "request-authorization", "--edge", edgeId, "--question", `是否满足 ${edgeId} 的声明授权？`,
        "--requester", "agent:demo", "--decision-owner", "human:demo", "--json",
      ));
      command("authorize", "--request", authorization.request_id, "--answer", `确认 ${edgeId} 的声明授权`, "--actor", "human:demo");
    } else {
      command("start", "--edge", edgeId, "--reason", "当前 proven/ready 且 Brief 不要求额外授权", "--actor", "agent:demo");
    }
    command("gate");
    const marker = path.join(workspace, ".mapflow-demo", `${edgeId}.ok`);
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(marker, `${edgeId} fixture exit observed\n`, "utf8");
    const verifier = `${edgeId}-check`;
    const capability = JSON.parse(command("issue-action", "--edge", edgeId, "--verifier", verifier, "--json"));
    const verifyArgs = [
      "verify-executed", "--edge", edgeId, "--evidence", `${edgeId} fixture evidence`,
      "--verifier", verifier, "--capability", capability.token, "--executor", "tool:evolution-demo",
      "--outcome-ref", `command:demo-check-${edgeId}`,
    ];
    if (acceptance) verifyArgs.push("--acceptance", acceptance);
    command(...verifyArgs);
  }

  const auditArgs = [
    "request-arrival-audit", "--question", "目的地、验收、非目标和风险是否完成独立审计？",
    "--requester", "agent:demo",
  ];
  if (!pendingArrival) auditArgs.push("--decision-owner", "human:demo");
  auditArgs.push("--json");
  const audit = JSON.parse(command(...auditArgs));
  if (!pendingArrival) {
    command(
      "arrive", "--request", audit.request_id,
      "--answer", "确认 fixture 的目的地证据、非目标和风险记录完整",
      "--actor", "human:demo", "--non-goals", "多用户权限,云同步,推荐算法,生产部署",
      "--risks", "fixture 只证明工作流链路",
    );
  }

  process.stdout.write(`${JSON.stringify({
    workspace,
    sidecar: enabled.sidecar,
    state: enabled.paths.state,
    wayfinding_events: enabled.paths.wayfinding_events,
    runtime_events: enabled.paths.events,
    arrival_audit_request: audit.request_id,
    arrival_status: pendingArrival ? "pending" : "audited",
    board: noServe ? null : `http://127.0.0.1:${port}`,
    evidence_boundary: "deterministic fixture; not real project delivery or human acceptance",
  }, null, 2)}\n`);
  if (!noServe) return startBoardServer({ statePath: enabled.paths.state, port });
  return null;
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
