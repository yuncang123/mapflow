import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { readBlueprint } from "../tools/mapflow-core.mjs";
import { resolveWorkspace } from "../tools/mapflow-workspace.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const BENCHMARK = path.join(ROOT, "tools", "benchmark.mjs");
const MAPFLOW = path.join(ROOT, "tools", "mapflow.mjs");

function runNode(script, args, { cwd = ROOT, mapflowHome, benchmarkHome, env = {} } = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd,
    env: {
      ...process.env,
      ...(mapflowHome ? { MAPFLOW_HOME: mapflowHome } : {}),
      ...(benchmarkHome ? { MAPFLOW_BENCHMARK_HOME: benchmarkHome } : {}),
      ...env,
    },
    encoding: "utf8",
    timeout: 60000,
    windowsHide: true,
  });
}

function json(result) {
  let detail = result.stderr || result.stdout;
  if (result.status !== 0 && result.stdout.trim()) {
    try {
      const output = JSON.parse(result.stdout);
      const stderrPath = output.artifacts?.stderr;
      if (stderrPath && fs.existsSync(stderrPath)) detail = fs.readFileSync(stderrPath, "utf8") || detail;
    } catch {
      // Keep the original process output when the failed command did not emit JSON.
    }
  }
  assert.equal(result.status, 0, detail);
  return JSON.parse(result.stdout);
}

function jsonFromAnyExit(result) {
  assert.notEqual(result.stdout.trim(), "", result.stderr);
  return JSON.parse(result.stdout);
}

test("benchmark doctor discovers a complete seven-case matrix", () => {
  const result = runNode(BENCHMARK, ["doctor", "--json"]);
  const output = json(result);
  assert.equal(output.passed, true);
  assert.equal(output.cases.length, 7);
  assert.equal(output.scope.kind, "case-package-validation");
  assert.deepEqual(output.scope.not_run, ["runtime tests", "Agent segments", "complete journeys", "release matrix"]);
  assert.match(output.boundary, /package contracts only/i);
  assert.deepEqual(output.cases.map((entry) => entry.case_id), [
    "community-workshop-noncode",
    "cross-session-resume",
    "library-reservation-brownfield",
    "library-system-greenfield",
    "library-system-submaps",
    "order-timeout-diagnosis",
    "scope-change-control",
  ]);
  assert.ok(output.cases.every((entry) => /^[a-f0-9]{64}$/.test(entry.fixture_digest)));
  assert.equal(output.impact.passed, true);
  const greenfield = output.cases.find((entry) => entry.case_id === "library-system-greenfield");
  assert.deepEqual(greenfield.problems, []);
  const human = runNode(BENCHMARK, ["doctor"]);
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /^SCOPE case-package validation only; tests executed: none/m);
  assert.match(human.stdout, /^PASS case-package library-system-greenfield@/m);
  assert.match(human.stdout, /^NOT RUN runtime tests, Agent segments, complete journeys, release matrix/m);
});

test("benchmark doctor rejects segments without an event contract or a valid checkpoint event head", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "mf-doctor-event-test-"));
  const copiedRoot = path.join(parent, "mapflow");
  try {
    fs.mkdirSync(copiedRoot, { recursive: true });
    fs.cpSync(path.join(ROOT, "tools"), path.join(copiedRoot, "tools"), { recursive: true });
    fs.cpSync(path.join(ROOT, "benchmarks"), path.join(copiedRoot, "benchmarks"), { recursive: true });
    const copiedBenchmark = path.join(copiedRoot, "tools", "benchmark.mjs");
    const casePath = path.join(copiedRoot, "benchmarks", "cases", "library-system-greenfield", "case.json");
    const checkpointPath = path.join(copiedRoot, "benchmarks", "cases", "library-system-greenfield", "checkpoints", "implementation-verified", "checkpoint.json");

    const caseManifest = JSON.parse(fs.readFileSync(casePath, "utf8"));
    caseManifest.segments[0].expected_event_types = [];
    fs.writeFileSync(casePath, `${JSON.stringify(caseManifest, null, 2)}\n`, "utf8");
    const missingContract = jsonFromAnyExit(runNode(copiedBenchmark, ["doctor", "--json"]));
    assert.equal(missingContract.passed, false);
    assert.match(
      missingContract.cases.find((entry) => entry.case_id === "library-system-greenfield").problems.join("\n"),
      /expected_event_types is missing or invalid/,
    );

    caseManifest.segments[0].expected_event_types = ["mapflow.arrival.audited.v1"];
    fs.writeFileSync(casePath, `${JSON.stringify(caseManifest, null, 2)}\n`, "utf8");
    const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, "utf8"));
    checkpoint.event_stream.last_seq = 0;
    fs.writeFileSync(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
    const invalidEventHead = jsonFromAnyExit(runNode(copiedBenchmark, ["doctor", "--json"]));
    assert.equal(invalidEventHead.passed, false);
    assert.match(
      invalidEventHead.cases.find((entry) => entry.case_id === "library-system-greenfield").problems.join("\n"),
      /event_stream last_seq is invalid/,
    );

    const impactPath = path.join(copiedRoot, "benchmarks", "impact-map.json");
    const impact = JSON.parse(fs.readFileSync(impactPath, "utf8"));
    impact.rules[0].layers = ["release"];
    fs.writeFileSync(impactPath, `${JSON.stringify(impact, null, 2)}\n`, "utf8");
    const automaticRelease = json(runNode(copiedBenchmark, ["regression-plan", "--paths", "tools/benchmark.mjs", "--json"]));
    assert.deepEqual(automaticRelease.layers, ["oracle"]);
    assert.equal(automaticRelease.status, "plan-generated-not-executed");
    const invalidImpactDoctor = jsonFromAnyExit(runNode(copiedBenchmark, ["doctor", "--json"]));
    assert.equal(invalidImpactDoctor.passed, false);
    assert.match(invalidImpactDoctor.impact.problems.join("\n"), /rule layers are invalid: benchmark-harness: release/);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("a frozen checkpoint restores an isolated segment and cannot become full-journey evidence", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "mf-segment-test-"));
  const target = path.join(parent, "workspace");
  const mapflowHome = path.join(parent, "state");
  const benchmarkHome = path.join(parent, "evaluator");
  const fakeCodex = path.join(parent, "fake-segment-codex.mjs");
  const invocationLog = path.join(parent, "segment-invocation.json");
  try {
    const prepared = json(runNode(BENCHMARK, [
      "segment-prepare", "--case", "library-system-greenfield", "--segment", "arrival-audit", "--target", target,
    ], { mapflowHome, benchmarkHome }));
    assert.equal(prepared.run_mode, "segment");
    assert.equal(prepared.from_checkpoint, "implementation-verified");
    assert.equal(prepared.to_checkpoint, "arrived");
    const runManifest = JSON.parse(fs.readFileSync(path.join(prepared.run_directory, "run.json"), "utf8"));
    const sourceCheckpointManifest = JSON.parse(fs.readFileSync(path.join(ROOT, "benchmarks", "cases", "library-system-greenfield", "checkpoints", "implementation-verified", "checkpoint.json"), "utf8"));
    assert.equal(runManifest.run_mode, "segment");
    assert.equal(runManifest.segment.id, "arrival-audit");
    assert.equal(runManifest.segment.source_event_revision, sourceCheckpointManifest.event_stream.last_seq);
    assert.equal(fs.existsSync(path.join(prepared.run_directory, "segment-attempt.json")), false);
    assert.equal(fs.existsSync(path.join(target, ".mapflow")), false);
    assert.equal(spawnSync("git", ["rev-list", "--count", "HEAD"], { cwd: target, encoding: "utf8", windowsHide: true }).stdout.trim(), "1");
    assert.notEqual(spawnSync("git", ["status", "--short"], { cwd: target, encoding: "utf8", windowsHide: true }).stdout.trim(), "");
    const workspace = resolveWorkspace({ root: target, mapflowHome, create: false });
    assert.equal(workspace.exists, true);
    assert.equal(path.relative(target, workspace.directory).startsWith(".."), true);

    const restored = json(runNode(BENCHMARK, [
      "check", "--run", prepared.run_id, "--checkpoint", "implementation-verified", "--json",
    ], { mapflowHome, benchmarkHome }));
    assert.equal(restored.passed, true);

    const savedCheckpoint = path.join(parent, "saved-checkpoint");
    const saved = json(runNode(BENCHMARK, [
      "checkpoint-save", "--run", prepared.run_id, "--checkpoint", "implementation-verified", "--output", savedCheckpoint,
    ], { mapflowHome, benchmarkHome }));
    assert.equal(saved.manifest.schema, "mapflow.benchmark-checkpoint/v1");
    assert.ok(Object.values(saved.manifest.digests).every((digest) => /^[a-f0-9]{64}$/.test(digest)));
    assert.deepEqual(saved.manifest.event_stream, sourceCheckpointManifest.event_stream);

    const infrastructure = json(runNode(BENCHMARK, [
      "segment-report", "--run", prepared.run_id,
      "--outcome", "infrastructure-failed", "--outcome-evidence", "Codex sandbox could not start tools", "--no-fail",
    ], { mapflowHome, benchmarkHome }));
    assert.equal(infrastructure.gate, "segment-infrastructure-failed");
    assert.equal(infrastructure.outcome, "infrastructure-failed");

    const fullReport = runNode(BENCHMARK, ["report", "--run", prepared.run_id], { mapflowHome, benchmarkHome });
    assert.notEqual(fullReport.status, 0);
    assert.match(fullReport.stderr, /cannot produce a full-journey report/);
    const suiteReport = runNode(BENCHMARK, ["suite-report", "--runs", prepared.run_id], { mapflowHome, benchmarkHome });
    assert.notEqual(suiteReport.status, 0);
    assert.match(suiteReport.stderr, /rejects segment runs/);

    fs.writeFileSync(fakeCodex, `import { spawnSync } from "node:child_process";
import fs from "node:fs";
const args = process.argv.slice(2);
const input = fs.readFileSync(0, "utf8");
const runtime = process.env.FAKE_MAPFLOW_RUNTIME;
const statusResult = spawnSync(process.execPath, [runtime, "status", "--root", process.cwd(), "--json"], { encoding: "utf8", env: process.env });
if (statusResult.status !== 0) throw new Error(statusResult.stderr);
const state = JSON.parse(statusResult.stdout);
const request = state.arrival_audit_requests.find((entry) => entry.status === "pending");
const actor = request.decision_owner ?? "human:segment-user";
if (!request.decision_owner) {
  const assigned = spawnSync(process.execPath, [runtime, "assign-decision-owner", "--root", process.cwd(), "--request", request.id, "--decision-owner", actor, "--actor", "agent:codex"], { encoding: "utf8", env: process.env });
  if (assigned.status !== 0) throw new Error(assigned.stderr);
}
const arrived = spawnSync(process.execPath, [runtime, "arrive", "--root", process.cwd(), "--request", request.id, "--answer", input, "--actor", actor, "--non-goals", "未授权外部发布", "--risks", "真实长期使用仍未验证"], { encoding: "utf8", env: process.env });
if (arrived.status !== 0) throw new Error(arrived.stderr);
const outputIndex = args.indexOf("--output-last-message");
if (outputIndex >= 0) fs.writeFileSync(args[outputIndex + 1], "已按当前请求完成到达审计。", "utf8");
fs.writeFileSync(process.env.FAKE_INVOCATION_LOG, JSON.stringify({ args, input, cwd: process.cwd(), benchmarkHome: process.env.MAPFLOW_BENCHMARK_HOME ?? null }), "utf8");
process.stdout.write(JSON.stringify({ type: "thread.started", thread_id: "22222222-2222-4222-8222-222222222222" }) + "\\n");
process.stdout.write(JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: "mapflow arrive" } }) + "\\n");
`, "utf8");
    const segmentTurn = json(runNode(BENCHMARK, [
      "segment-turn", "--run", prepared.run_id, "--sandbox", "danger-full-access",
    ], {
      mapflowHome,
      benchmarkHome,
      env: {
        MAPFLOW_CODEX_BIN: process.execPath,
        MAPFLOW_CODEX_PREFIX: fakeCodex,
        FAKE_MAPFLOW_RUNTIME: MAPFLOW,
        FAKE_INVOCATION_LOG: invocationLog,
      },
    }));
    assert.equal(segmentTurn.mode, "start");
    assert.equal(fs.existsSync(path.join(prepared.run_directory, "segment-attempt.json")), true);
    const invocation = JSON.parse(fs.readFileSync(invocationLog, "utf8"));
    assert.equal(invocation.cwd, fs.realpathSync.native(target));
    assert.equal(invocation.benchmarkHome, null);
    assert.match(invocation.input, /^启用 mapflow，继续当前地图。/);

    const arrived = json(runNode(BENCHMARK, [
      "check", "--run", prepared.run_id, "--checkpoint", "arrived", "--json",
    ], { mapflowHome, benchmarkHome }));
    assert.equal(arrived.passed, true);
    const report = json(runNode(BENCHMARK, ["segment-report", "--run", prepared.run_id], { mapflowHome, benchmarkHome }));
    assert.equal(report.gate, "segment-passed");
    assert.equal(report.agent_turn_observed, true);
    assert.deepEqual(report.event_sequence, {
      source_revision: sourceCheckpointManifest.event_stream.last_seq,
      expected: ["mapflow.arrival.audited.v1"],
      actual: ["mapflow.arrival.audited.v1"],
      passed: true,
    });
    assert.match(report.boundary, /not a complete journey/i);

    fs.appendFileSync(workspace.eventsPath, `${JSON.stringify({ seq: sourceCheckpointManifest.event_stream.last_seq + 1, type: "mapflow.unexpected.v1" })}\n`, "utf8");
    const unexpectedEvent = json(runNode(BENCHMARK, [
      "segment-report", "--run", prepared.run_id, "--no-fail",
    ], { mapflowHome, benchmarkHome }));
    assert.equal(unexpectedEvent.gate, "segment-repair-and-retest");
    assert.deepEqual(unexpectedEvent.event_sequence.actual, ["mapflow.arrival.audited.v1", "mapflow.unexpected.v1"]);
    assert.equal(unexpectedEvent.event_sequence.passed, false);
    const invalidInfrastructureOverride = runNode(BENCHMARK, [
      "segment-report", "--run", prepared.run_id,
      "--outcome", "infrastructure-failed", "--outcome-evidence", "late attribution", "--no-fail",
    ], { mapflowHome, benchmarkHome });
    assert.notEqual(invalidInfrastructureOverride.status, 0);
    assert.match(invalidInfrastructureOverride.stderr, /cannot override evidence-derived segment outcome/);

    const duplicate = runNode(BENCHMARK, ["segment-turn", "--run", prepared.run_id], { mapflowHome, benchmarkHome });
    assert.notEqual(duplicate.status, 0);
    assert.match(duplicate.stderr, /already been started/);
    assert.match(duplicate.stderr, /segment-prepare with a new target/);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("recorded checkpoint observations replay consistently and impact planning stays below release", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "mf-replay-test-"));
  const target = path.join(parent, "workspace");
  const mapflowHome = path.join(parent, "state");
  const benchmarkHome = path.join(parent, "evaluator");
  try {
    const prepared = json(runNode(BENCHMARK, ["prepare", "--case", "library-system-greenfield", "--target", target], { mapflowHome, benchmarkHome }));
    json(runNode(BENCHMARK, ["check", "--run", prepared.run_id, "--checkpoint", "prepared", "--json"], { mapflowHome, benchmarkHome }));
    const replay = json(runNode(BENCHMARK, ["replay", "--run", prepared.run_id, "--current-case"], { mapflowHome, benchmarkHome }));
    assert.equal(replay.passed, true);
    assert.equal(replay.observations, 1);
    assert.match(replay.boundary, /does not rerun/i);

    const plan = json(runNode(BENCHMARK, ["regression-plan", "--paths", "tools/mapflow.mjs", "--json"], { mapflowHome, benchmarkHome }));
    assert.equal(plan.status, "plan-generated-not-executed");
    assert.deepEqual(plan.layers, ["oracle", "runtime", "agent"]);
    assert.deepEqual(plan.segments, ["library-system-greenfield:arrival-audit"]);
    assert.equal(plan.agent_coverage.kind, "targeted-stage-coverage");
    assert.deepEqual(plan.agent_coverage.covers, ["arrival-audit", "fresh-session-resume", "actual-arrival-boundary"]);
    assert.equal(plan.agent_coverage.complete_journey_covered, false);
    assert.equal(plan.layers.includes("release"), false);
    assert.match(plan.boundary, /never starts or claims a release-level/i);

    const explicitRelease = json(runNode(BENCHMARK, ["regression-plan", "--paths", "tools/benchmark.mjs", "--level", "release", "--json"], { mapflowHome, benchmarkHome }));
    assert.deepEqual(explicitRelease.layers, ["oracle", "runtime", "agent", "release"]);
    assert.equal(explicitRelease.commands.filter((entry) => / prepare --case /.test(entry)).length, 7);
    assert.match(explicitRelease.commands.at(-1), /suite-report --runs/);
    const workflowPlan = json(runNode(BENCHMARK, ["regression-plan", "--paths", "docs/workflow.md", "--json"], { mapflowHome, benchmarkHome }));
    assert.deepEqual(workflowPlan.layers, ["oracle", "runtime", "agent"]);
    assert.deepEqual(workflowPlan.segments, ["library-system-greenfield:arrival-audit"]);
    assert.deepEqual(workflowPlan.commands.slice(0, 1), ["npm run test:regression"]);
    const humanPlan = runNode(BENCHMARK, ["regression-plan", "--paths", "tools/benchmark.mjs"], { mapflowHome, benchmarkHome });
    assert.match(humanPlan.stdout, /^status: PLAN ONLY; tests executed: none/m);
    assert.match(humanPlan.stdout, /^matched rules: benchmark-harness matched \[tools\/benchmark\.mjs\], selects layers \[oracle\]/m);
    assert.match(humanPlan.stdout, /^estimated minutes:/m);
    assert.match(humanPlan.stdout, /^boundary:/m);
    const workflowHumanPlan = runNode(BENCHMARK, ["regression-plan", "--paths", "docs/workflow.md"], { mapflowHome, benchmarkHome });
    assert.match(workflowHumanPlan.stdout, /^agent coverage: TARGETED ONLY/m);
    assert.match(workflowHumanPlan.stdout, /^recovery: segment-turn interrupted\/nonzero -> new empty target/m);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("prepare copies only fixture contents, creates a Git baseline, and keeps Sidecar empty", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "mf-eval-test-"));
  const target = path.join(parent, "workspace");
  const mapflowHome = path.join(parent, "state");
  const benchmarkHome = path.join(parent, "evaluator");
  try {
    const prepared = json(runNode(BENCHMARK, ["prepare", "--case", "library-system-greenfield", "--target", target], { mapflowHome, benchmarkHome }));
    assert.equal(prepared.target_root, fs.realpathSync.native(target));
    assert.ok(fs.existsSync(path.join(target, "README.md")));
    assert.equal(fs.existsSync(path.join(target, "fixture")), false);
    assert.equal(fs.existsSync(path.join(target, "operator")), false);
    assert.equal(fs.existsSync(path.join(target, "oracle")), false);
    assert.equal(fs.existsSync(path.join(target, ".mapflow")), false);
    assert.equal(fs.existsSync(path.join(mapflowHome, "workspaces")), false);

    const runManifest = JSON.parse(fs.readFileSync(path.join(prepared.run_directory, "run.json"), "utf8"));
    assert.equal(runManifest.case_id, "library-system-greenfield");
    assert.equal(runManifest.baseline_commit, prepared.baseline_commit);
    assert.match(runManifest.fixture_digest, /^[a-f0-9]{64}$/);
    assert.equal(runManifest.target_root, prepared.target_root);
    assert.equal(runManifest.environment.mapflow_home, path.resolve(mapflowHome));
    assert.equal(runManifest.environment.benchmark_home, path.resolve(benchmarkHome));
    assert.equal(path.relative(mapflowHome, prepared.run_directory).startsWith(".."), true);
    assert.equal(path.relative(benchmarkHome, prepared.run_directory).startsWith(".."), false);
    assert.match(runManifest.case_digest, /^[a-f0-9]{64}$/);
    assert.equal(path.relative(prepared.run_directory, runManifest.operator_mainline).startsWith(".."), false);
    assert.equal(path.relative(prepared.run_directory, runManifest.oracle).startsWith(".."), false);
    assert.equal(fs.existsSync(path.join(prepared.run_directory, "case", "case.json")), true);
    assert.equal(fs.existsSync(path.join(prepared.run_directory, "case", "operator", "mainline.md")), true);
    assert.equal(fs.existsSync(path.join(prepared.run_directory, "case", "oracle", "checkpoints.json")), true);
    assert.deepEqual(runManifest.isolation.required_codex_flags, ["--disable memories", "--disable multi_agent"]);
    assert.deepEqual(runManifest.isolation.forbidden_codex_flags, ["--ephemeral"]);
    assert.match(runManifest.isolation.session_policy, /fresh persisted session/);
    assert.deepEqual(runManifest.isolation.child_environment, ["MAPFLOW_HOME"]);
    assert.deepEqual(runManifest.isolation.forbidden_child_environment, ["MAPFLOW_BENCHMARK_HOME"]);

    const gitStatus = spawnSync("git", ["status", "--short"], { cwd: target, encoding: "utf8", windowsHide: true });
    assert.equal(gitStatus.status, 0, gitStatus.stderr);
    assert.equal(gitStatus.stdout, "");
    const commitCount = spawnSync("git", ["rev-list", "--count", "HEAD"], { cwd: target, encoding: "utf8", windowsHide: true });
    assert.equal(commitCount.stdout.trim(), "1");
    const commitIdentity = spawnSync("git", ["log", "-1", "--format=%an%n%ae%n%s"], { cwd: target, encoding: "utf8", windowsHide: true });
    assert.equal(commitIdentity.status, 0, commitIdentity.stderr);
    assert.equal(commitIdentity.stdout.trim(), "Local Developer\nlocal-developer@example.invalid\nInitial project state");
    assert.doesNotMatch(commitIdentity.stdout, /mapflow|benchmark|fixture|oracle|operator|gold/i);

    const wrongMapflowHome = path.join(parent, "wrong-state");
    const checked = json(runNode(BENCHMARK, ["check", "--run", prepared.run_id, "--checkpoint", "prepared", "--json"], { mapflowHome: wrongMapflowHome, benchmarkHome }));
    assert.equal(checked.passed, true);
    assert.equal(checked.observation.workspace.sidecar_exists, false);
    const concise = runNode(BENCHMARK, ["check", "--run", prepared.run_id, "--checkpoint", "prepared"], { mapflowHome: wrongMapflowHome, benchmarkHome });
    assert.equal(concise.status, 0, concise.stderr);
    assert.match(concise.stdout, /^PASS prepared/m);
    assert.ok(concise.stdout.trim().split(/\r?\n/).length <= 4);

    const enabled = json(runNode(MAPFLOW, ["enable", "--root", target, "--json"], { mapflowHome }));
    assert.equal(enabled.created, true);
    assert.equal(path.relative(target, enabled.sidecar).startsWith(".."), true);
    const enabledCheck = json(runNode(BENCHMARK, ["check", "--run", prepared.run_id, "--checkpoint", "enabled-empty", "--json"], { mapflowHome: wrongMapflowHome, benchmarkHome }));
    assert.equal(enabledCheck.passed, true);
    assert.equal(fs.existsSync(path.join(target, ".mapflow")), false);
    const smokeResult = runNode(BENCHMARK, ["smoke-report", "--run", prepared.run_id], { mapflowHome: wrongMapflowHome, benchmarkHome });
    assert.equal(smokeResult.status, 1, smokeResult.stderr);
    const smoke = jsonFromAnyExit(smokeResult);
    assert.equal(smoke.gate, "smoke-incomplete");
    assert.deepEqual(smoke.missing_checkpoints, ["destination-shaped"]);
    assert.deepEqual(smoke.recovery_commands, [
      `node tools/benchmark.mjs check --run ${prepared.run_id} --checkpoint destination-shaped`,
    ]);
    const smokeNoFail = json(runNode(BENCHMARK, ["smoke-report", "--run", prepared.run_id, "--no-fail"], { mapflowHome: wrongMapflowHome, benchmarkHome }));
    assert.equal(smokeNoFail.gate, "smoke-incomplete");

    const hiddenFailure = runNode(BENCHMARK, ["check", "--run", prepared.run_id, "--checkpoint", "arrived", "--json"], { mapflowHome: wrongMapflowHome, benchmarkHome });
    assert.equal(hiddenFailure.status, 1);
    const hiddenRecord = JSON.parse(hiddenFailure.stdout);
    assert.equal(hiddenRecord.verifier.passed, false);
    assert.match(hiddenRecord.next_action, /record a finding/);
    assert.doesNotMatch(hiddenRecord.next_action, /follow the current checkpoint deviation branch/);
    assert.doesNotMatch(hiddenFailure.stdout, /package\.json is missing|oracle[\\/]verify\.mjs/);
    assert.ok(fs.existsSync(hiddenRecord.verifier.detail_path));

    fs.writeFileSync(path.join(target, "untracked-product-file.txt"), "new product state\n", "utf8");
    const untrackedResult = runNode(BENCHMARK, ["check", "--run", prepared.run_id, "--checkpoint", "enabled-empty", "--json"], { mapflowHome: wrongMapflowHome, benchmarkHome });
    assert.equal(untrackedResult.status, 1);
    const untrackedRecord = jsonFromAnyExit(untrackedResult);
    assert.ok(untrackedRecord.observation.repo.changed_paths.includes("untracked-product-file.txt"));
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("prepare rejects evaluation storage overlap and benchmark-revealing product paths", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "mf-isolation-test-"));
  try {
    const overlappingState = path.join(parent, "state");
    const overlap = runNode(BENCHMARK, [
      "prepare", "--case", "library-system-greenfield", "--target", path.join(parent, "workspace-a"),
    ], { mapflowHome: overlappingState, benchmarkHome: path.join(overlappingState, "evaluator") });
    assert.equal(overlap.status, 1);
    assert.match(overlap.stderr, /separate, non-overlapping directories/);

    const revealing = runNode(BENCHMARK, [
      "prepare", "--case", "library-system-greenfield", "--target", path.join(parent, "blind-suite-target"),
    ], { mapflowHome: path.join(parent, "state-b"), benchmarkHome: path.join(parent, "evaluator-b") });
    assert.equal(revealing.status, 1);
    assert.match(revealing.stderr, /must not reveal benchmark, blind, Oracle, operator, or gold context/);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("agent-turn starts and resumes Codex only from the run target with a sanitized environment", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "mf-agent-turn-test-"));
  const target = path.join(parent, "workspace");
  const mapflowHome = path.join(parent, "state");
  const benchmarkHome = path.join(parent, "evaluator");
  const fakeCodex = path.join(parent, "fake-codex.mjs");
  const invocationLog = path.join(parent, "codex-invocations.jsonl");
  try {
    fs.writeFileSync(fakeCodex, `import fs from "node:fs";
const args = process.argv.slice(2);
const input = fs.readFileSync(0, "utf8");
const outputIndex = args.indexOf("--output-last-message");
const output = outputIndex >= 0 ? args[outputIndex + 1] : null;
const resumed = args[0] === "exec" && args[1] === "resume";
const sessionId = resumed ? args[args.indexOf("resume") + 1] : "11111111-1111-4111-8111-111111111111";
await new Promise((resolve) => setTimeout(resolve, Number(process.env.FAKE_CODEX_DELAY_MS ?? 0)));
fs.appendFileSync(process.env.FAKE_CODEX_INVOCATIONS, JSON.stringify({ args, input, cwd: process.cwd(), mapflowHome: process.env.MAPFLOW_HOME ?? null, benchmarkHome: process.env.MAPFLOW_BENCHMARK_HOME ?? null }) + "\\n");
if (output) fs.writeFileSync(output, resumed ? "resumed response" : "opening response", "utf8");
process.stdout.write(JSON.stringify({ type: "thread.started", thread_id: sessionId }) + "\\n");
process.stdout.write(JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: "private command" } }) + "\\n");
`, "utf8");
    const prepared = json(runNode(BENCHMARK, ["prepare", "--case", "library-system-greenfield", "--target", target], { mapflowHome, benchmarkHome }));
    const childEnv = {
      MAPFLOW_CODEX_BIN: process.execPath,
      MAPFLOW_CODEX_PREFIX: fakeCodex,
      MAPFLOW_AGENT_HEARTBEAT_MS: "10",
      FAKE_CODEX_DELAY_MS: "35",
      FAKE_CODEX_INVOCATIONS: invocationLog,
    };

    const openingResult = runNode(BENCHMARK, [
      "agent-turn", "--run", prepared.run_id, "--turn", "opening",
      "--input", "启用 mapflow。我想开发一个图书系统。",
      "--sandbox", "danger-full-access",
    ], { mapflowHome, benchmarkHome, env: childEnv });
    const opening = json(openingResult);
    assert.match(openingResult.stderr, /agent-turn opening is still running/);
    assert.match(openingResult.stderr, /progress: \d+ tool steps/);
    assert.doesNotMatch(openingResult.stderr, /图书系统/);
    assert.doesNotMatch(openingResult.stderr, /private command/);
    assert.ok(opening.heartbeat_count >= 1);
    assert.equal(opening.progress.tool_steps, 1);
    assert.equal(opening.session_id, "11111111-1111-4111-8111-111111111111");
    assert.equal(opening.cwd, fs.realpathSync.native(target));
    assert.equal(opening.response, "opening response");

    const resumed = json(runNode(BENCHMARK, [
      "agent-turn", "--run", prepared.run_id, "--turn", "destination",
      "--session", opening.session_id, "--input", "这是下一轮业务回答。",
      "--sandbox", "danger-full-access",
    ], { mapflowHome, benchmarkHome, env: childEnv }));
    assert.equal(resumed.session_id, opening.session_id);
    assert.equal(resumed.cwd, fs.realpathSync.native(target));
    assert.equal(resumed.response, "resumed response");

    const invocations = fs.readFileSync(invocationLog, "utf8").trim().split(/\r?\n/).map((line) => JSON.parse(line));
    assert.equal(invocations.length, 2);
    assert.ok(invocations.every((entry) => entry.cwd === fs.realpathSync.native(target)));
    assert.ok(invocations.every((entry) => entry.mapflowHome === path.resolve(mapflowHome)));
    assert.ok(invocations.every((entry) => entry.benchmarkHome === null));
    assert.ok(invocations[0].args.includes("--cd"));
    assert.ok(invocations[0].args.includes(fs.realpathSync.native(target)));
    assert.equal(invocations[1].args[1], "resume");
    assert.deepEqual(invocations[1].args.slice(3, 5), ["-c", 'sandbox_mode="danger-full-access"']);
    assert.ok(invocations.every((entry) => entry.args.includes("memories") && entry.args.includes("multi_agent")));
    assert.deepEqual(invocations.map((entry) => entry.input), [
      "启用 mapflow。我想开发一个图书系统。",
      "这是下一轮业务回答。",
    ]);

    const agentTurns = fs.readFileSync(path.join(prepared.run_directory, "agent-turns.jsonl"), "utf8").trim().split(/\r?\n/).map((line) => JSON.parse(line));
    assert.deepEqual(agentTurns.map((entry) => entry.cwd), [prepared.target_root, prepared.target_root]);
    assert.deepEqual(agentTurns.map((entry) => entry.sandbox), ["danger-full-access", "danger-full-access"]);
    assert.ok(agentTurns.every((entry) => entry.heartbeat_count >= 1));
    assert.ok(agentTurns.every((entry) => entry.progress.tool_steps === 1));
    const recordedTurns = fs.readFileSync(path.join(prepared.run_directory, "turns.jsonl"), "utf8").trim().split(/\r?\n/).map((line) => JSON.parse(line));
    assert.deepEqual(recordedTurns.map((entry) => entry.response), ["opening response", "resumed response"]);
    assert.ok(recordedTurns.every((entry) => entry.task_ref === opening.session_id));

    const firstValue = json(runNode(BENCHMARK, [
      "mark-first-value", "--run", prepared.run_id, "--turn", "destination", "--note", "目标与下一步已清楚",
    ], { mapflowHome, benchmarkHome }));
    assert.equal(firstValue.turn, "destination");
    const interimReport = json(runNode(BENCHMARK, ["report", "--run", prepared.run_id, "--no-fail"], { mapflowHome, benchmarkHome }));
    assert.equal(interimReport.first_value.observed, true);
    assert.equal(interimReport.first_value.turn, "destination");
    const duplicateFirstValue = runNode(BENCHMARK, ["mark-first-value", "--run", prepared.run_id, "--turn", "opening"], { mapflowHome, benchmarkHome });
    assert.notEqual(duplicateFirstValue.status, 0);
    assert.match(duplicateFirstValue.stderr, /first value is already marked/);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("probe detects a transient regression checkpoint without writing check evidence", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "mf-probe-test-"));
  const target = path.join(parent, "workspace");
  const mapflowHome = path.join(parent, "state");
  const benchmarkHome = path.join(parent, "evaluator");
  try {
    const prepared = json(runNode(BENCHMARK, ["prepare", "--case", "library-system-greenfield", "--target", target], { mapflowHome, benchmarkHome }));
    const notReady = json(runNode(BENCHMARK, ["probe", "--run", prepared.run_id, "--checkpoint", "regression-proposed", "--json"], { mapflowHome, benchmarkHome }));
    assert.equal(notReady.ready, false);
    assert.equal(notReady.persisted, false);
    assert.equal(fs.existsSync(path.join(prepared.run_directory, "checks.jsonl")), false);

    const enabled = json(runNode(MAPFLOW, ["enable", "--root", target, "--json"], { mapflowHome, benchmarkHome }));
    const candidateEdge = (id, from, to, precondition, effect) => ({
      id,
      from,
      to,
      label: id,
      purpose: `produce ${effect}`,
      status: "confirmed",
      brief_ref: `briefs/${id}.md`,
      preconditions: [precondition],
      effects: [effect],
      invariants: ["local-only"],
      evidence_contract: [{ id: `${id}-evidence`, proves: [effect], required: true, proof: "readback exists" }],
      acceptance: [{ id: `${id}-accepted`, proves: [effect], proof: "result is observable" }],
      non_goals: ["external publication"],
      certainty: "logical",
      on_failure: { action: "replan", scope: `edge:${id}` },
      proof: { status: "logical", summary: "the suffix is reachable", missing: [], evidence_refs: [] },
    });
    fs.writeFileSync(enabled.paths.wayfinding, `${JSON.stringify({
      schema_version: 1,
      phase: "regression",
      intent: { statement: "deliver a local library system", status: "shaped", open_questions: [] },
      origin: {
        id: "origin-fog",
        kind: "fog",
        label: "empty repository",
        facts: [{ id: "repository-ready", value: "true", evidence: [{ kind: "observation", ref: "fixture" }] }],
      },
      destination: {
        id: "destination-fog",
        kind: "destination",
        label: "accepted local system",
        statement: "the agreed local workflow is usable",
        status: "confirmed",
        requires: ["system-observed"],
        invariants: ["local-only"],
        acceptance: [{ id: "system-accepted", proves: ["system-observed"], proof: "the local workflow is observable" }],
      },
      boundaries: { in_scope: ["local workflow"], out_of_scope: ["external publication"], authorization: [] },
      nodes: [{
        id: "foundation-ready",
        kind: "state",
        label: "foundation accepted",
        purpose: "an observable intermediate milestone",
        status: "confirmed",
        facts: [{ id: "foundation-observed", value: "true", evidence: [{ kind: "observation", ref: "fixture" }] }],
      }, {
        id: "design-docs-ready",
        kind: "join",
        label: "design documents ready",
        purpose: "two independent pre-code documents",
        status: "confirmed",
        facts: [
          { id: "domain-model-ready", value: "true", evidence: [{ kind: "document", ref: "domain" }] },
          { id: "api-contract-ready", value: "true", evidence: [{ kind: "document", ref: "api" }] },
        ],
      }, {
        id: "design-reviewed",
        kind: "state",
        label: "design reviewed",
        purpose: "freeze implementation inputs",
        status: "confirmed",
        facts: [
          { id: "domain-model-ready", value: "true", evidence: [{ kind: "document", ref: "domain" }] },
          { id: "api-contract-ready", value: "true", evidence: [{ kind: "document", ref: "api" }] },
          { id: "engineering-design-reviewed", value: "true", evidence: [{ kind: "meeting", ref: "review" }] },
        ],
      }],
      edges: [
        candidateEdge("establish-foundation", "origin-fog", "foundation-ready", "repository-ready", "foundation-observed"),
        candidateEdge("design-domain-model", "foundation-ready", "design-docs-ready", "foundation-observed", "domain-model-ready"),
        candidateEdge("design-api-contract", "foundation-ready", "design-docs-ready", "foundation-observed", "api-contract-ready"),
        candidateEdge("review-engineering-design", "design-docs-ready", "design-reviewed", "domain-model-ready", "engineering-design-reviewed"),
        candidateEdge("build-workflow", "design-reviewed", "destination-fog", "engineering-design-reviewed", "system-observed"),
      ],
      questions: [],
    }, null, 2)}\n`, "utf8");
    json(runNode(BENCHMARK, ["record", "--run", prepared.run_id, "--turn", "opening", "--input", "启用 mapflow", "--response", "展示目的地候选"], { mapflowHome, benchmarkHome }));
    json(runNode(BENCHMARK, ["record", "--run", prepared.run_id, "--turn", "destination-confirmation", "--input", "我确认目的地候选", "--response", "进入反向回归"], { mapflowHome, benchmarkHome }));

    const ready = json(runNode(BENCHMARK, ["probe", "--run", prepared.run_id, "--checkpoint", "regression-proposed", "--json"], { mapflowHome, benchmarkHome }));
    assert.equal(ready.ready, true);
    assert.equal(ready.persisted, false);
    assert.equal(fs.existsSync(path.join(prepared.run_directory, "checks.jsonl")), false);

    const checked = json(runNode(BENCHMARK, ["check", "--run", prepared.run_id, "--checkpoint", "regression-proposed", "--json"], { mapflowHome, benchmarkHome }));
    assert.equal(checked.passed, true);
    assert.equal(fs.readFileSync(path.join(prepared.run_directory, "checks.jsonl"), "utf8").trim().split(/\r?\n/).length, 1);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("diagnosis map checkpoint requires a clean proven map with a probe before repair", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "mf-diagnosis-route-test-"));
  const target = path.join(parent, "workspace");
  const mapflowHome = path.join(parent, "state");
  const benchmarkHome = path.join(parent, "evaluator");
  try {
    const prepared = json(runNode(BENCHMARK, ["prepare", "--case", "order-timeout-diagnosis", "--target", target], { mapflowHome, benchmarkHome }));
    const enabled = json(runNode(MAPFLOW, ["enable", "--root", target, "--json"], { mapflowHome, benchmarkHome }));
    const source = path.join(ROOT, "examples", "order-query-timeout");
    fs.cpSync(path.join(source, "briefs"), enabled.paths.briefs, { recursive: true });
    const blueprint = structuredClone(readBlueprint(path.join(source, "blueprint.yaml")).blueprint);
    blueprint.boundaries.out_of_scope = ["Do not add a cache", "Do not change caller interfaces"];
    fs.writeFileSync(enabled.paths.map, `${JSON.stringify(blueprint, null, 2)}\n`, "utf8");
    assert.equal(runNode(MAPFLOW, ["init", "--root", target], { mapflowHome, benchmarkHome }).status, 0);
    json(runNode(BENCHMARK, ["record", "--run", prepared.run_id, "--turn", "opening", "--input", "启用 mapflow", "--response", "已启用并开始勘探"], { mapflowHome, benchmarkHome }));
    json(runNode(BENCHMARK, ["record", "--run", prepared.run_id, "--turn", "destination-confirmation", "--input", "我确认之前展示的目的地合同", "--response", "完整候选链已整体审阅，正式地图已证明"], { mapflowHome, benchmarkHome }));

    const checked = json(runNode(BENCHMARK, ["check", "--run", prepared.run_id, "--checkpoint", "map-proven", "--json"], { mapflowHome, benchmarkHome }));
    assert.equal(checked.passed, true);
    assert.equal(checked.observation.runtime.active_edge, null);
    assert.equal(checked.observation.runtime.edge_runs_count, 0);
    assert.equal(checked.observation.repo.dirty_paths.length, 0);
    assert.ok(checked.observation.diagnosis.probe_edges >= 1);
    assert.ok(checked.observation.diagnosis.repair_edges_after_probe >= 1);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("greenfield map-proven checkpoint accepts a reviewed proof without route approval", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "mf-route-proof-gate-test-"));
  const target = path.join(parent, "workspace");
  const mapflowHome = path.join(parent, "state");
  const benchmarkHome = path.join(parent, "evaluator");
  try {
    const prepared = json(runNode(BENCHMARK, ["prepare", "--case", "library-system-greenfield", "--target", target], { mapflowHome, benchmarkHome }));
    const enabled = json(runNode(MAPFLOW, ["enable", "--root", target, "--json"], { mapflowHome, benchmarkHome }));
    const example = path.join(ROOT, "examples", "library-system-evolution");
    for (const entry of fs.readdirSync(path.join(example, "briefs"))) {
      fs.copyFileSync(path.join(example, "briefs", entry), path.join(enabled.paths.briefs, entry));
    }
    fs.copyFileSync(path.join(example, "blueprint.yaml"), enabled.paths.map);
    assert.equal(runNode(MAPFLOW, ["init", "--root", target], { mapflowHome, benchmarkHome }).status, 0);
    json(runNode(BENCHMARK, ["record", "--run", prepared.run_id, "--turn", "opening", "--input", "启用 mapflow", "--response", "已展示目的地候选"], { mapflowHome, benchmarkHome }));
    json(runNode(BENCHMARK, ["record", "--run", prepared.run_id, "--turn", "destination-confirmation", "--input", "我确认刚才展示的目的地合同", "--response", "候选链已整体审阅并登记证明"], { mapflowHome, benchmarkHome }));

    const checked = json(runNode(BENCHMARK, ["check", "--run", prepared.run_id, "--checkpoint", "map-proven", "--json"], { mapflowHome, benchmarkHome }));
    assert.equal(checked.passed, true);
    assert.equal(checked.observation.proof.causal_soundness, "explicit");
    assert.deepEqual(checked.observation.topology.ready_edges, ["confirm-core-journey"]);
    assert.equal(checked.observation.runtime.pending_authorizations, 0);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("greenfield implementation checkpoint preserves the separate arrival audit gate", () => {
  const oracle = JSON.parse(fs.readFileSync(path.join(ROOT, "benchmarks", "cases", "library-system-greenfield", "oracle", "checkpoints.json"), "utf8"));
  const checkpoint = oracle.checkpoints.find((entry) => entry.id === "implementation-verified");
  assert.ok(checkpoint);
  assert.ok(checkpoint.assertions.some((entry) => entry.path === "runtime.phase" && entry.equals === "implementation"));
  assert.ok(checkpoint.assertions.some((entry) => entry.path === "runtime.actual_arrival" && entry.equals === "not-audited"));
  assert.ok(checkpoint.assertions.some((entry) => entry.path === "runtime.pending_arrival_audits" && entry.equals === 1));
});

test("turn, score, finding, and report preserve trajectory and gate evidence", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "mf-report-test-"));
  const target = path.join(parent, "target");
  const mapflowHome = path.join(parent, "state");
  try {
    const prepared = json(runNode(BENCHMARK, ["prepare", "--case", "community-workshop-noncode", "--target", target], { mapflowHome }));
    json(runNode(BENCHMARK, ["record", "--run", prepared.run_id, "--turn", "opening", "--input", "启用 mapflow", "--response", "地图尚未建立", "--duration-seconds", "9", "--repeated-questions", "1", "--first-value"], { mapflowHome }));
    json(runNode(BENCHMARK, ["score", "--run", prepared.run_id, "--turn", "opening", "--verdict", "hesitate", "--clarity", "2", "--accuracy", "3", "--fluency", "2", "--control", "3", "--usefulness", "2", "--note", "入口可用但有一次重复"], { mapflowHome }));
    json(runNode(BENCHMARK, ["finding", "--run", prepared.run_id, "--checkpoint", "prepared", "--severity", "P1", "--observed", "没有说明当前确认对象", "--inference", "用户可能停止"], { mapflowHome }));
    const reportResult = runNode(BENCHMARK, ["report", "--run", prepared.run_id], { mapflowHome });
    assert.equal(reportResult.status, 1, reportResult.stderr);
    const report = jsonFromAnyExit(reportResult);
    assert.equal(report.gate, "repair-and-retest");
    assert.equal(report.outcome, "mapflow-failed");
    assert.equal(report.experience.observations, 1);
    assert.equal(report.trajectory.turns, 1);
    assert.equal(report.trajectory.duration_seconds, 9);
    assert.equal(report.trajectory.repeated_questions, 1);
    assert.deepEqual(report.first_value, {
      expected: "用户能在地图中看见预算、场地、内容和授权分别缺什么",
      observed: true,
      turn: "opening",
      seconds: 9,
    });
    assert.deepEqual(report.budget.exceeded, []);
    assert.equal(report.severe_findings.length, 1);
    assert.ok(fs.existsSync(path.join(prepared.run_directory, "report.json")));
    const reportNoFail = json(runNode(BENCHMARK, ["report", "--run", prepared.run_id, "--no-fail"], { mapflowHome }));
    assert.equal(reportNoFail.gate, "repair-and-retest");
    const suiteResult = runNode(BENCHMARK, ["suite-report", "--runs", prepared.run_id], { mapflowHome });
    assert.equal(suiteResult.status, 1, suiteResult.stderr);
    const suite = jsonFromAnyExit(suiteResult);
    assert.equal(suite.gate, "repair-and-retest");
    assert.equal(suite.cases.length, 1);
    assert.ok(suite.missing_core.includes("library-system-greenfield"));
    const suiteNoFail = json(runNode(BENCHMARK, ["suite-report", "--runs", prepared.run_id, "--no-fail"], { mapflowHome }));
    assert.equal(suiteNoFail.gate, "repair-and-retest");
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("a complete opening request cannot stand in for later human destination confirmation", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "mf-confirmation-gate-test-"));
  const target = path.join(parent, "target");
  const mapflowHome = path.join(parent, "state");
  const benchmarkHome = path.join(parent, "evaluator");
  try {
    const prepared = json(runNode(BENCHMARK, ["prepare", "--case", "library-system-greenfield", "--target", target], { mapflowHome, benchmarkHome }));
    const enabled = json(runNode(MAPFLOW, ["enable", "--root", target, "--json"], { mapflowHome, benchmarkHome }));
    fs.writeFileSync(enabled.paths.wayfinding, `schema_version: 1
phase: shaping
intent:
  statement: 开发图书管理系统
  status: shaped
  open_questions: []
origin:
  id: origin-fog
  kind: fog
  label: 空仓库
  facts: []
destination:
  id: destination-fog
  kind: destination
  label: 图书系统目的地
  statement: 核心借阅流程可用
  status: confirmed
  requires: [loan-lifecycle-usable]
  invariants: []
  acceptance:
    - id: loan-lifecycle-accepted
      proves: [loan-lifecycle-usable]
      proof: 借阅主链可回读
boundaries:
  in_scope: [图书登记、读者登记、借书和归还]
  out_of_scope: [收费、推荐和外部发布]
  authorization: []
nodes: []
edges: []
questions:
  - id: confirm-destination
    prompt: 是否确认目的地候选？
    target:
      kind: destination
      id: destination-fog
      label: 图书系统目的地
      purpose: 确认结果、验收和边界
    status: answered
    answer: 信息已经足够
    evidence_refs:
      - kind: note
        ref: opening-request
    answer_updates: [wayfinding.intent.status]
`, "utf8");
    json(runNode(BENCHMARK, [
      "record", "--run", prepared.run_id, "--turn", "opening",
      "--input", "启用 mapflow。我已经把功能、验收和非目标写完整。",
      "--response", "我把首轮直接视为确认。",
    ], { mapflowHome, benchmarkHome }));
    const premature = runNode(BENCHMARK, ["check", "--run", prepared.run_id, "--checkpoint", "destination-shaped", "--json"], { mapflowHome, benchmarkHome });
    assert.equal(premature.status, 1, premature.stderr);
    const prematureCheck = jsonFromAnyExit(premature);
    assert.equal(prematureCheck.hard_gates.find((gate) => gate.id === "destination-requires-later-human-confirmation")?.passed, false);

    json(runNode(BENCHMARK, [
      "record", "--run", prepared.run_id, "--turn", "destination-confirmation",
      "--input", "你刚才展示的目的地合同准确，我确认。",
      "--response", "已记录确认，目的地进入反向回归前状态。",
    ], { mapflowHome, benchmarkHome }));
    const confirmed = runNode(BENCHMARK, ["check", "--run", prepared.run_id, "--checkpoint", "destination-shaped", "--json"], { mapflowHome, benchmarkHome });
    assert.equal(confirmed.status, 0, confirmed.stderr);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("report enforces case budgets and keeps infrastructure attribution evidence-safe", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "mf-budget-test-"));
  const target = path.join(parent, "target");
  const mapflowHome = path.join(parent, "state");
  try {
    const prepared = json(runNode(BENCHMARK, ["prepare", "--case", "community-workshop-noncode", "--target", target], { mapflowHome }));
    const missingEvidence = runNode(BENCHMARK, ["report", "--run", prepared.run_id, "--outcome", "infrastructure-failed", "--no-fail"], { mapflowHome });
    assert.equal(missingEvidence.status, 1);
    assert.match(missingEvidence.stderr, /--outcome-evidence is required/);

    const infrastructure = json(runNode(BENCHMARK, ["report", "--run", prepared.run_id, "--outcome", "infrastructure-failed", "--outcome-evidence", "codex exec unavailable", "--no-fail"], { mapflowHome }));
    assert.equal(infrastructure.gate, "incomplete");
    assert.equal(infrastructure.outcome, "infrastructure-failed");
    assert.equal(infrastructure.outcome_evidence, "codex exec unavailable");

    const failedCheckpoint = runNode(BENCHMARK, ["check", "--run", prepared.run_id, "--checkpoint", "surveyed", "--json"], { mapflowHome });
    assert.equal(failedCheckpoint.status, 1);
    const attributed = json(runNode(BENCHMARK, ["report", "--run", prepared.run_id, "--outcome", "infrastructure-failed", "--outcome-evidence", "CreateProcessWithLogonW failed: 1385", "--no-fail"], { mapflowHome }));
    assert.equal(attributed.gate, "incomplete");
    assert.equal(attributed.outcome, "infrastructure-failed");
    assert.deepEqual(attributed.failed_checkpoints, ["surveyed"]);
    assert.equal(attributed.outcome_evidence, "CreateProcessWithLogonW failed: 1385");

    for (let index = 1; index <= 13; index += 1) {
      json(runNode(BENCHMARK, ["record", "--run", prepared.run_id, "--turn", `turn-${index}`, "--input", "继续", "--response", "等待确认"], { mapflowHome }));
    }
    const exhausted = json(runNode(BENCHMARK, ["report", "--run", prepared.run_id, "--no-fail"], { mapflowHome }));
    assert.equal(exhausted.gate, "budget-exhausted");
    assert.equal(exhausted.outcome, "budget-exhausted");
    assert.deepEqual(exhausted.budget.exceeded, ["turns"]);

    const invalidOverride = runNode(BENCHMARK, ["report", "--run", prepared.run_id, "--outcome", "infrastructure-failed", "--outcome-evidence", "late infrastructure claim", "--no-fail"], { mapflowHome });
    assert.equal(invalidOverride.status, 1);
    assert.match(invalidOverride.stderr, /cannot override evidence-derived outcome budget-exhausted/);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("brownfield and continuity fixtures pass their original tests while timeout fixture reproduces red", () => {
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  for (const caseId of ["library-reservation-brownfield", "cross-session-resume"]) {
    const fixture = path.join(ROOT, "benchmarks", "cases", caseId, "subject", "fixture");
    const result = spawnSync(process.execPath, ["--test"], {
      cwd: fixture,
      encoding: "utf8",
      env: childEnv,
      timeout: 30000,
      windowsHide: true,
    });
    assert.equal(result.status, 0, `${caseId}\n${result.stdout}\n${result.stderr}`);
  }

  const timeoutFixture = path.join(ROOT, "benchmarks", "cases", "order-timeout-diagnosis", "subject", "fixture");
  const red = spawnSync(process.execPath, ["--test"], {
    cwd: timeoutFixture,
    encoding: "utf8",
    env: childEnv,
    timeout: 30000,
    windowsHide: true,
  });
  assert.notEqual(red.status, 0, "timeout fixture must begin with a reproducible failing recovery contract");
  assert.match(`${red.stdout}\n${red.stderr}`, /retried once|safe fallback/);
});
