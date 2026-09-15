import crypto from "node:crypto";
import path from "node:path";

import { createBoardSnapshotReader } from "./mapflow-board-core.mjs";
import { acquireWorkspaceWriteLock, readWorkspaceHead } from "./mapflow-head.mjs";
import { installedRuntimeIdentity, runtimeIdentity, runtimeIdentityMatches } from "./mapflow-runtime.mjs";

export const WORKSPACE_SNAPSHOT_SCHEMA = "mapflow.workspace-snapshot/v1";

export class WorkspaceSnapshotError extends Error {}

function fail(message) {
  throw new WorkspaceSnapshotError(message);
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function currentQuestion(model) {
  return (model.questions ?? []).find((question) => (
    question.id === model.wayfinding?.current_question_id
    && (question.status ?? "pending") === "pending"
  )) ?? (model.questions ?? []).find((question) => (question.status ?? "pending") === "pending") ?? null;
}

function nextAction(model, question) {
  if (question) {
    return {
      id: "answer-wayfinding-question",
      command: "wayfinding-answer",
      question_id: question.id,
      target: structuredClone(question.target),
      reason: question.prompt,
    };
  }
  if (model.projection?.mode === "wayfinding") {
    return {
      id: "continue-wayfinding",
      command: "wayfinding-write",
      reason: "shape the destination and regress the route before initializing runtime",
    };
  }
  if (model.summary?.active_edge) {
    return {
      id: "continue-active-edge",
      edge: model.summary.active_edge,
      reason: "finish the active Edge Run and record trusted evidence",
    };
  }
  if (model.map?.phase === "arrived") {
    return {
      id: "begin-successor",
      command: "continue",
      reason: "bind a human-confirmed successor Destination to the latest Arrival Checkpoint",
    };
  }
  if ((model.summary?.ready_edges ?? []).length > 0) {
    return {
      id: "choose-ready-edge",
      command: "next-actions",
      edges: [...model.summary.ready_edges],
      reason: "inspect all currently allowed moves before selecting work",
    };
  }
  return {
    id: "inspect-next-actions",
    command: "next-actions",
    reason: "derive the complete set of currently allowed moves from the current Head",
  };
}

function workspaceView(workspace, statePath) {
  return {
    id: workspace?.workspace_id ?? null,
    root: workspace?.workspace_root ?? null,
    kind: workspace?.workspace_kind ?? null,
    sidecar: workspace?.directory ?? path.dirname(path.dirname(path.resolve(statePath))),
  };
}

export function createWorkspaceSnapshotReader({
  workspace = null,
  statePath,
  mapPath = null,
  identity = null,
  installedIdentity = null,
  lock = true,
} = {}) {
  if (!statePath) fail("workspace snapshot requires a state path");
  const readBoard = createBoardSnapshotReader({ mapPath, statePath });

  function readSnapshot() {
    const lease = lock ? acquireWorkspaceWriteLock(statePath) : null;
    try {
      const currentRuntime = identity ?? runtimeIdentity();
      const headInfo = readWorkspaceHead(statePath, { identity: currentRuntime });
      const board = readBoard();
      if (board.model.projection?.source_status === "stale") {
        fail(board.model.projection.source_error ?? "Board projection is stale against Workspace Head");
      }
      const installed = installedIdentity ?? installedRuntimeIdentity();
      const question = currentQuestion(board.model);
      const originalProjectionRevision = board.model.projection.revision;
      const model = structuredClone(board.model);
      model.projection.source_revision = originalProjectionRevision;
      model.projection.revision = headInfo.head.revision;
      model.projection.workspace_head = {
        schema: headInfo.head.schema,
        workspace_id: headInfo.head.workspace_id,
        revision: headInfo.head.revision,
        phase: headInfo.head.phase,
        updated_at: headInfo.head.updated_at,
      };
      model.projection.runtime = {
        current: currentRuntime,
        head: headInfo.head.runtime,
        compatible: headInfo.runtime_compatible,
      };
      if (!headInfo.runtime_compatible) {
        model.projection.source_status = "stale";
        model.projection.source_error = `运行时 ${currentRuntime.version}/${currentRuntime.build_digest.slice(0, 12)} 与 Workspace Head ${headInfo.head.runtime.version}/${headInfo.head.runtime.build_digest.slice(0, 12)} 不一致`;
      }
      const snapshot = {
        schema: WORKSPACE_SNAPSHOT_SCHEMA,
        workspace: workspaceView(workspace, statePath),
        head: {
          schema: headInfo.head.schema,
          revision: headInfo.head.revision,
          phase: headInfo.head.phase,
          updated_at: headInfo.head.updated_at,
          path: headInfo.path,
          source: structuredClone(headInfo.head.source),
        },
        runtime: {
          current: currentRuntime,
          head: structuredClone(headInfo.head.runtime),
          compatible_with_head: headInfo.runtime_compatible,
          installed,
          current_matches_installed: Boolean(
            installed.identity && runtimeIdentityMatches(currentRuntime, installed.identity),
          ),
        },
        focus: {
          phase: model.map?.phase ?? headInfo.head.phase,
          map_id: model.map?.id ?? null,
          destination: model.map?.destination?.statement ?? model.map?.intent?.statement ?? null,
          current_edge: model.summary?.active_edge ?? null,
          current_question: question ? {
            id: question.id,
            prompt: question.prompt,
            target: structuredClone(question.target),
            requested_by: question.requested_by ?? null,
          } : null,
          next_action: nextAction(model, question),
        },
        paths: workspace ? {
          manifest: workspace.manifestPath,
          map: workspace.mapPath,
          wayfinding: workspace.wayfindingPath,
          briefs: workspace.briefsPath,
          state: workspace.statePath,
          events: workspace.eventsPath,
          wayfinding_events: workspace.wayfindingEventsPath,
          head: workspace.headPath,
        } : {
          state: statePath,
          head: headInfo.path,
        },
        projection: {
          source_status: model.projection.source_status,
          source_revision: originalProjectionRevision,
          nodes: model.summary?.nodes ?? 0,
          edges: model.summary?.edges ?? 0,
          draft_nodes: model.summary?.draft_nodes ?? 0,
          draft_edges: model.summary?.draft_edges ?? 0,
        },
      };
      const etag = `"${hash([
        headInfo.head.revision,
        headInfo.head.runtime.version,
        headInfo.head.runtime.build_digest,
        currentRuntime.version,
        currentRuntime.build_digest,
        originalProjectionRevision,
      ].join("\n"))}"`;
      return { model, snapshot, etag };
    } catch (error) {
      if (error instanceof WorkspaceSnapshotError) throw error;
      fail(error instanceof Error ? error.message : String(error));
    } finally {
      lease?.release();
    }
  }

  for (const method of [
    "readEvolutionCatalog",
    "readEvolutionFrame",
    "readSubmap",
    "readSubmapEvolutionCatalog",
    "readSubmapEvolutionFrame",
  ]) {
    readSnapshot[method] = (...args) => readBoard[method](...args);
  }
  return readSnapshot;
}
