#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

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

function edge(id, from, to, label, preconditions, effects, acceptanceId) {
  return {
    id,
    from,
    to,
    label,
    purpose: `建立里程碑“${label}”并留下可回读出口`,
    status: "pending",
    brief_ref: `briefs/${id}.md`,
    preconditions,
    effects,
    invariants: ["scope-preserved"],
    evidence_contract: [{ id: `${id}-record`, proves: effects, required: true, proof: "检查和结果可回读" }],
    acceptance: acceptanceId ? [{ id: acceptanceId, proves: effects, proof: "阶段出口可回读" }] : [],
    non_goals: ["不扩大到已声明非目标"],
    certainty: "expected",
    on_failure: { action: "replan", scope: `edge:${id}` },
    proof: { status: "logical", summary: "在当前显式条件下目标后缀可达", missing: [], evidence_refs: [] },
  };
}

function main() {
  const args = new Set(process.argv.slice(2));
  const noServe = args.has("--no-serve");
  const portIndex = process.argv.indexOf("--port");
  const port = portIndex >= 0 ? process.argv[portIndex + 1] : "4196";
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-library-demo-"));
  const mapflowHome = fs.mkdtempSync(path.join(os.tmpdir(), "mapflow-library-sidecar-"));
  fs.writeFileSync(path.join(workspace, "README.md"), "# Empty library system demo workspace\n", "utf8");
  const git = spawnSync("git", ["init", "--quiet", workspace], { encoding: "utf8", windowsHide: true });
  if (git.status !== 0) throw new Error(git.stderr || "git init failed");

  const enabled = JSON.parse(run(workspace, "enable", "--root", workspace, "--mapflow-home", mapflowHome, "--json"));
  const stateArgs = ["--state", enabled.paths.state];
  const command = (...commandArgs) => run(workspace, ...stateArgs, ...commandArgs);
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
    draft.destination.requires = ["mvp-built", "tests-pass", "demo-accepted"];
    draft.destination.invariants = [];
    draft.destination.acceptance = [
      { id: "library-tests-pass", proves: ["mvp-built", "tests-pass"], proof: "自动检查覆盖新增、搜索、借出和归还" },
      { id: "library-demo-accepted", proves: ["demo-accepted"], proof: "Owner 按核心旅程完成回读" },
    ];
    draft.boundaries = {
      in_scope: ["本地单用户的新增、搜索、借出、归还"],
      out_of_scope: ["多用户权限", "云同步", "推荐算法", "生产部署"],
      authorization: ["每条工作边单独获得 Owner 授权"],
    };
    draft.intent.open_questions = ["是否确认这份目的地合同？"];
    draft.questions.push({
      id: "confirm-library-destination",
      prompt: "是否明确确认这份目的地 Predicate、验收和非目标合同？",
      target: { kind: "destination", id: draft.destination.id, label: draft.destination.label, purpose: "由人确认目的地，允许开始反向目标回归" },
      status: "pending",
      answer_updates: ["wayfinding.intent.status", "wayfinding.destination.status"],
    });
  });

  answer("confirm-library-destination", "我确认并批准这份图书管理 MVP 目的地合同");
  revise("从目的地反推最近的可验收里程碑", (draft) => {
    draft.phase = "regression";
    draft.intent.status = "shaped";
    draft.intent.open_questions = [];
    draft.destination.kind = "destination";
    draft.destination.status = "confirmed";
    draft.destination.label = "MVP 已通过核心旅程验收";
    draft.nodes.push({ id: "mvp-implemented", kind: "state", label: "MVP 已实现并通过自动检查", purpose: "固定人工演示之前的实现出口", status: "pending" });
    draft.questions.push({
      id: "confirm-mvp-implemented-node",
      prompt: "是否确认“MVP 已实现并通过自动检查”是目的地之前独立可验收的里程碑？",
      target: { kind: "node", id: "mvp-implemented", label: "MVP 已实现并通过自动检查", purpose: "确认最近的反向里程碑" },
      status: "pending",
      answer_updates: ["wayfinding.nodes.mvp-implemented.status"],
    });
  });

  answer("confirm-mvp-implemented-node", "我确认这个里程碑独立、必要且可验收");
  revise("确认里程碑后，提出通往目的地的独立验收边", (draft) => {
    draft.nodes.find((item) => item.id === "mvp-implemented").status = "confirmed";
    draft.edges.push(edge("accept-library-mvp", "mvp-implemented", draft.destination.id, "按核心旅程演示并验收", ["mvp-built", "tests-pass"], ["demo-accepted"], "library-demo-accepted"));
    draft.questions.push({
      id: "confirm-accept-library-edge",
      prompt: "是否确认这条演示验收边的范围、非目标和证据合同？",
      target: { kind: "edge", id: "accept-library-mvp", label: "按核心旅程演示并验收", purpose: "确认到达目的地的最后一条独立工作边" },
      status: "pending",
      answer_updates: ["wayfinding.edges.accept-library-mvp.status"],
    });
  });

  answer("confirm-accept-library-edge", "我确认这条边独立、边界明确且可回读验收");
  revise("继续向前反推实现前的阶段性节点", (draft) => {
    draft.edges.find((item) => item.id === "accept-library-mvp").status = "confirmed";
    draft.nodes.push({ id: "core-journey-confirmed", kind: "state", label: "核心用户旅程已确认", purpose: "防止实现范围漂移", status: "pending" });
    draft.questions.push({
      id: "confirm-core-journey-node",
      prompt: "是否确认“核心用户旅程已确认”是实施前必要的阶段性节点？",
      target: { kind: "node", id: "core-journey-confirmed", label: "核心用户旅程已确认", purpose: "确认实施的输入里程碑" },
      status: "pending",
      answer_updates: ["wayfinding.nodes.core-journey-confirmed.status"],
    });
  });

  answer("confirm-core-journey-node", "我确认这个里程碑能够约束实施范围");
  revise("提出从已确认旅程到可验收 MVP 的实施边", (draft) => {
    draft.nodes.find((item) => item.id === "core-journey-confirmed").status = "confirmed";
    draft.edges.push(edge("implement-library-mvp", "core-journey-confirmed", "mvp-implemented", "实现并自动验证图书管理 MVP", ["repository-present", "core-journey-known"], ["mvp-built", "tests-pass"], "library-tests-pass"));
    draft.questions.push({
      id: "confirm-implement-library-edge",
      prompt: "是否确认实施边只覆盖核心旅程，且测试是它自己的出口证据？",
      target: { kind: "edge", id: "implement-library-mvp", label: "实现并自动验证图书管理 MVP", purpose: "确认实施边与验收边没有隐藏耦合" },
      status: "pending",
      answer_updates: ["wayfinding.edges.implement-library-mvp.status"],
    });
  });

  answer("confirm-implement-library-edge", "我确认实施边有独立出口，不承担人工演示验收");
  revise("补齐从起始事实到第一里程碑的最后一条边", (draft) => {
    draft.edges.find((item) => item.id === "implement-library-mvp").status = "confirmed";
    draft.edges.push(edge("confirm-core-journey", draft.origin.id, "core-journey-confirmed", "确认核心用户旅程", ["repository-present", "core-journey-unknown"], ["core-journey-known"], "core-journey-decision-accepted"));
    draft.questions.push({
      id: "confirm-core-journey-edge",
      prompt: "是否确认这条边只产生旅程决定，不偷偷包含实现工作？",
      target: { kind: "edge", id: "confirm-core-journey", label: "确认核心用户旅程", purpose: "闭合从始发地到目的地的候选链" },
      status: "pending",
      answer_updates: ["wayfinding.edges.confirm-core-journey.status"],
    });
  });

  answer("confirm-core-journey-edge", "我确认这条边只产生旅程决定，候选链可以闭合");
  revise("闭合并冻结全部人类确认过的候选链", (draft) => {
    draft.edges.find((item) => item.id === "confirm-core-journey").status = "confirmed";
  });

  fs.copyFileSync(path.join(EXAMPLE, "blueprint.yaml"), enabled.paths.map);
  fs.cpSync(path.join(EXAMPLE, "briefs"), enabled.paths.briefs, { recursive: true, force: true });
  command("validate", "--map", enabled.paths.map);
  command("init", "--map", enabled.paths.map);

  const route = JSON.parse(command(
    "request-route-approval", "--question", "是否批准这条已证明的完整路线？",
    "--requester", "agent:demo", "--decision-owner", "human:demo", "--json",
  ));
  command("approve", "--request", route.request_id, "--answer", "确认并批准完整路线", "--actor", "human:demo");

  const runtimeEdges = [
    ["confirm-core-journey", "core-journey-known", ""],
    ["implement-library-mvp", "mvp-built,tests-pass", "library-tests-pass"],
    ["accept-library-mvp", "demo-accepted", "library-demo-accepted"],
  ];
  for (const [edgeId, proves, acceptance] of runtimeEdges) {
    const authorization = JSON.parse(command(
      "request-authorization", "--edge", edgeId, "--question", `是否授权执行 ${edgeId}？`,
      "--requester", "agent:demo", "--decision-owner", "human:demo", "--json",
    ));
    command("authorize", "--request", authorization.request_id, "--answer", `批准执行 ${edgeId}`, "--actor", "human:demo");
    const verifyArgs = [
      "verify", "--edge", edgeId, "--evidence", `${edgeId} fixture evidence`,
      "--command", `demo-check ${edgeId}`, "--observed", `${edgeId} exit conditions observed`,
      "--result", "pass", "--proves", proves, "--executor", "tool:evolution-demo",
      "--outcome-ref", `command:demo-check-${edgeId}`,
    ];
    if (acceptance) verifyArgs.push("--acceptance", acceptance);
    command(...verifyArgs);
  }

  const audit = JSON.parse(command(
    "request-arrival-audit", "--question", "目的地、验收、非目标和风险是否完成独立审计？",
    "--requester", "agent:demo", "--decision-owner", "human:demo", "--json",
  ));
  command(
    "arrive", "--request", audit.request_id,
    "--answer", "确认 fixture 的目的地证据、非目标和风险记录完整",
    "--actor", "human:demo", "--non-goals", "多用户权限,云同步,推荐算法,生产部署",
    "--risks", "fixture 只证明工作流链路",
  );

  process.stdout.write(`${JSON.stringify({
    workspace,
    sidecar: enabled.sidecar,
    state: enabled.paths.state,
    wayfinding_events: enabled.paths.wayfinding_events,
    runtime_events: enabled.paths.events,
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
