#!/usr/bin/env node

import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { BoardError, createBoardSnapshotReader } from "./mapflow-board-core.mjs";
import { workspaceHeadPathForState } from "./mapflow-head.mjs";
import { WorkspaceSnapshotError, createWorkspaceSnapshotReader } from "./mapflow-snapshot.mjs";

const TOOL_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ASSETS = path.resolve(TOOL_DIRECTORY, "board");
const HOST = "127.0.0.1";
const MAPFLOW_CLI = path.resolve(TOOL_DIRECTORY, "mapflow.mjs");
const MAX_ACTION_BODY_BYTES = 16 * 1024;

const STATIC_ROUTES = new Map([
  ["/", { file: "index.html", type: "text/html; charset=utf-8", cache: "no-store" }],
  ["/app.js", { file: "app.js", type: "text/javascript; charset=utf-8", cache: "no-store" }],
  ["/styles.css", { file: "styles.css", type: "text/css; charset=utf-8", cache: "no-store" }],
  ["/vendor/cytoscape.min.js", {
    file: path.resolve(TOOL_DIRECTORY, "vendor/cytoscape/cytoscape.min.js"),
    type: "text/javascript; charset=utf-8",
    cache: "public, max-age=31536000, immutable",
    absolute: true,
  }],
]);

function securityHeaders(contentType, cache = "no-store") {
  return {
    "Content-Type": contentType,
    "Cache-Control": cache,
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
}

function sendJson(response, status, value, headers = {}) {
  response.writeHead(status, {
    ...securityHeaders("application/json; charset=utf-8"),
    ...headers,
  });
  response.end(response.req?.method === "HEAD" ? undefined : JSON.stringify(value));
}

class BoardRequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let content = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > MAX_ACTION_BODY_BYTES) {
        reject(new BoardRequestError(413, "回答内容过长"));
        request.destroy();
        return;
      }
      content += chunk;
    });
    request.on("end", () => {
      try {
        resolve(content ? JSON.parse(content) : {});
      } catch {
        reject(new BoardRequestError(400, "回答必须是有效 JSON"));
      }
    });
    request.on("error", reject);
  });
}

function liveEtag(etag, interactionToken) {
  if (!interactionToken) return etag;
  return `"${crypto.createHash("sha256").update(`${etag}\n${interactionToken}`).digest("hex")}"`;
}

function currentDestinationQuestion(model) {
  if (model.projection?.mode !== "wayfinding" || model.wayfinding?.phase !== "shaping") return null;
  return (model.questions ?? []).find((question) => (
    question.id === model.wayfinding?.current_question_id
    && question.status === "pending"
    && question.target?.kind === "destination"
  )) ?? null;
}

function liveBoardModel(snapshot, interactionToken) {
  const question = currentDestinationQuestion(snapshot.model);
  const runtimeCompatible = snapshot.snapshot?.runtime?.compatible_with_head ?? true;
  return {
    ...snapshot.model,
    interaction: question && interactionToken && runtimeCompatible ? {
      mode: "destination-answer",
      endpoint: "/api/wayfinding/answer",
      token: interactionToken,
      question_id: question.id,
      revision: snapshot.model.projection.revision,
      choices: ["confirm", "adjust"],
    } : {
      mode: "view-only",
      ...(runtimeCompatible ? {} : { reason: "runtime-mismatch" }),
    },
  };
}

function runWayfindingAnswer({ statePath, questionId, answer, revision }) {
  const result = spawnSync(process.execPath, [
    MAPFLOW_CLI,
    "--state", statePath,
    "wayfinding-answer",
    "--question", questionId,
    "--answer", answer,
    "--evidence-ref", `observation:board-${revision.slice(0, 12)}`,
    "--actor", "human:owner",
    "--expected-revision", revision,
  ], {
    cwd: path.dirname(statePath),
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new BoardRequestError(409, (result.stderr || result.stdout || "回答未能写入").trim());
  }
}

function serveStatic(request, response, assetsRoot, route) {
  const definition = STATIC_ROUTES.get(route);
  if (!definition) return false;
  const filePath = definition.absolute ? definition.file : path.resolve(assetsRoot, definition.file);
  const relative = path.relative(definition.absolute ? path.dirname(filePath) : assetsRoot, filePath);
  if (!definition.absolute && (relative.startsWith("..") || path.isAbsolute(relative))) return false;
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    sendJson(response, 500, { error: `board asset is missing: ${route}` });
    return true;
  }
  response.writeHead(200, securityHeaders(definition.type, definition.cache));
  if (request.method === "HEAD") response.end();
  else fs.createReadStream(filePath).pipe(response);
  return true;
}

export function createBoardServer({ workspace = null, mapPath = null, statePath = null, assetsRoot = DEFAULT_ASSETS } = {}) {
  const headPath = statePath ? workspaceHeadPathForState(statePath) : null;
  const readSnapshot = headPath && fs.existsSync(headPath)
    ? createWorkspaceSnapshotReader({ workspace, mapPath, statePath })
    : createBoardSnapshotReader({ mapPath, statePath });
  const interactionToken = statePath ? crypto.randomBytes(24).toString("base64url") : null;
  const streamClients = new Set();
  const watchedFiles = [];
  let lastStreamEtag = null;
  let notificationTimer = null;

  function writeRevision(response, snapshot) {
    response.write(`id: ${snapshot.model.projection.revision}\n`);
    response.write("event: revision\n");
    response.write(`data: ${JSON.stringify({
      revision: snapshot.model.projection.revision,
      source_status: snapshot.model.projection.source_status,
      head_runtime: snapshot.snapshot?.runtime?.head ?? null,
    })}\n\n`);
  }

  function publishRevision({ force = false } = {}) {
    if (streamClients.size === 0 && !force) return;
    const snapshot = readSnapshot();
    if (!force && snapshot.etag === lastStreamEtag) return;
    lastStreamEtag = snapshot.etag;
    for (const client of [...streamClients]) {
      try {
        writeRevision(client, snapshot);
      } catch {
        streamClients.delete(client);
      }
    }
  }

  function scheduleRevisionReadback() {
    if (notificationTimer !== null) clearTimeout(notificationTimer);
    notificationTimer = setTimeout(() => {
      notificationTimer = null;
      try {
        publishRevision();
      } catch {
        // The snapshot reader retains last-known-good state; the periodic fallback retries.
      }
    }, 50);
    notificationTimer.unref?.();
  }

  const stateDirectory = statePath ? path.dirname(path.resolve(statePath)) : null;
  for (const filePath of new Set([
    mapPath,
    statePath,
    headPath,
    stateDirectory ? path.join(stateDirectory, "wayfinding.yaml") : null,
    stateDirectory ? path.join(stateDirectory, "wayfinding-events.jsonl") : null,
    stateDirectory ? path.join(stateDirectory, "events.jsonl") : null,
  ].filter(Boolean).map((candidate) => path.resolve(candidate)))) {
    fs.watchFile(filePath, { interval: 250, persistent: false }, scheduleRevisionReadback);
    watchedFiles.push(filePath);
  }
  const fallbackTimer = setInterval(() => {
    try {
      publishRevision();
    } catch {
      // A later filesystem notification or interval retries without mutating source state.
    }
  }, 15000);
  fallbackTimer.unref?.();

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${HOST}`);
      if (url.pathname === "/api/wayfinding/answer") {
        if (request.method !== "POST") {
          response.setHeader("Allow", "POST");
          sendJson(response, 405, { error: "这里只接收页面上的明确回答" });
          return;
        }
        if (!statePath || !interactionToken) throw new BoardRequestError(403, "当前面板没有回答权限");
        if (!String(request.headers["content-type"] ?? "").startsWith("application/json")) {
          throw new BoardRequestError(415, "回答必须使用 application/json");
        }
        if (request.headers["sec-fetch-site"] && request.headers["sec-fetch-site"] !== "same-origin") {
          throw new BoardRequestError(403, "只接受当前面板发起的回答");
        }
        if (request.headers["x-mapflow-action-token"] !== interactionToken) {
          throw new BoardRequestError(403, "回答令牌已失效，请刷新页面");
        }
        const body = await readJsonBody(request);
        const snapshot = readSnapshot();
        if (snapshot.snapshot && !snapshot.snapshot.runtime.compatible_with_head) {
          throw new BoardRequestError(409, "当前看板运行时与 Workspace Head 不一致，请先同步安装版本");
        }
        const question = currentDestinationQuestion(snapshot.model);
        if (!question) throw new BoardRequestError(409, "当前没有等待回答的目的地问题");
        if (body.revision !== snapshot.model.projection.revision) {
          throw new BoardRequestError(409, "目标已经更新，请刷新后重新确认");
        }
        if (body.question_id !== question.id) {
          throw new BoardRequestError(409, "当前问题已经变化，请刷新后重新确认");
        }
        let answer;
        if (body.choice === "confirm") {
          answer = "我确认当前展示的目的地、完成标准、范围和边界，就按这份合同继续。";
        } else if (body.choice === "adjust") {
          const adjustment = typeof body.adjustment === "string" ? body.adjustment.trim() : "";
          if (!adjustment) throw new BoardRequestError(400, "请写下你希望调整的内容");
          if (adjustment.length > 2000) throw new BoardRequestError(400, "调整内容不能超过 2000 字");
          answer = `需要调整当前目的地合同：${adjustment}`;
        } else {
          throw new BoardRequestError(400, "请选择确认目标或调整目标");
        }
        runWayfindingAnswer({
          statePath: path.resolve(statePath),
          questionId: question.id,
          answer,
          revision: snapshot.model.projection.revision,
        });
        const refreshed = readSnapshot();
        publishRevision({ force: true });
        sendJson(response, 200, {
          ok: true,
          choice: body.choice,
          message: body.choice === "confirm"
            ? "已记录，等待 Codex 处理"
            : "调整意见已记录，等待 Codex 处理",
          revision: refreshed.model.projection.revision,
          recorded_revision: refreshed.model.projection.revision,
          workspace_id: refreshed.model.projection.workspace_head?.workspace_id ?? null,
          application_status: "recorded",
        });
        return;
      }
      if (!new Set(["GET", "HEAD"]).has(request.method)) {
        response.setHeader("Allow", "GET, HEAD");
        sendJson(response, 405, { error: "地图和历史是只读投影" });
        return;
      }
      if (url.pathname === "/api/stream") {
        const headers = {
          ...securityHeaders("text/event-stream; charset=utf-8"),
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        };
        response.writeHead(200, headers);
        if (request.method === "HEAD") {
          response.end();
          return;
        }
        response.write("retry: 3000\n\n");
        streamClients.add(response);
        const snapshot = readSnapshot();
        lastStreamEtag = snapshot.etag;
        writeRevision(response, snapshot);
        request.once("close", () => streamClients.delete(response));
        return;
      }
      if (url.pathname === "/api/evolution") {
        const snapshot = readSnapshot.readEvolutionCatalog();
        if (request.headers["if-none-match"] === snapshot.etag) {
          response.writeHead(304, { ...securityHeaders("application/json; charset=utf-8"), ETag: snapshot.etag });
          response.end();
          return;
        }
        sendJson(response, 200, snapshot.model, { ETag: snapshot.etag });
        return;
      }
      const evolutionFrameMatch = url.pathname.match(/^\/api\/evolution\/frames\/(wayfinding|runtime):(\d+)$/);
      if (evolutionFrameMatch) {
        const snapshot = readSnapshot.readEvolutionFrame(`${evolutionFrameMatch[1]}:${evolutionFrameMatch[2]}`);
        if (request.headers["if-none-match"] === snapshot.etag) {
          response.writeHead(304, { ...securityHeaders("application/json; charset=utf-8"), ETag: snapshot.etag });
          response.end();
          return;
        }
        sendJson(response, 200, snapshot.model, { ETag: snapshot.etag });
        return;
      }
      if (url.pathname === "/api/board" || url.pathname === "/health") {
        const snapshot = readSnapshot();
        const etag = liveEtag(snapshot.etag, interactionToken);
        if (request.headers["if-none-match"] === etag) {
          response.writeHead(304, {
            ...securityHeaders("application/json; charset=utf-8"),
            ETag: etag,
          });
          response.end();
          return;
        }
        const body = url.pathname === "/health" ? {
          status: snapshot.model.projection.source_status,
          map_id: snapshot.model.map.id,
          revision: snapshot.model.projection.revision,
          projection_read_only: true,
          destination_answer: Boolean(
            currentDestinationQuestion(snapshot.model)
            && interactionToken
            && (snapshot.snapshot?.runtime?.compatible_with_head ?? true),
          ),
          workspace_head: snapshot.snapshot?.head ?? null,
          runtime: snapshot.snapshot?.runtime ?? null,
        } : liveBoardModel(snapshot, interactionToken);
        sendJson(response, 200, body, { ETag: etag });
        return;
      }
      const submapEvolutionFrameMatch = url.pathname.match(/^\/api\/submaps\/([a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\/[a-z][a-z0-9]*(?:-[a-z0-9]+)*)*)\/evolution\/frames\/(wayfinding|runtime):(\d+)$/);
      if (submapEvolutionFrameMatch) {
        const snapshot = readSnapshot.readSubmapEvolutionFrame(
          submapEvolutionFrameMatch[1],
          `${submapEvolutionFrameMatch[2]}:${submapEvolutionFrameMatch[3]}`,
        );
        if (request.headers["if-none-match"] === snapshot.etag) {
          response.writeHead(304, { ...securityHeaders("application/json; charset=utf-8"), ETag: snapshot.etag });
          response.end();
          return;
        }
        sendJson(response, 200, snapshot.model, { ETag: snapshot.etag });
        return;
      }
      const submapEvolutionMatch = url.pathname.match(/^\/api\/submaps\/([a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\/[a-z][a-z0-9]*(?:-[a-z0-9]+)*)*)\/evolution$/);
      if (submapEvolutionMatch) {
        const snapshot = readSnapshot.readSubmapEvolutionCatalog(submapEvolutionMatch[1]);
        if (request.headers["if-none-match"] === snapshot.etag) {
          response.writeHead(304, { ...securityHeaders("application/json; charset=utf-8"), ETag: snapshot.etag });
          response.end();
          return;
        }
        sendJson(response, 200, snapshot.model, { ETag: snapshot.etag });
        return;
      }
      const submapMatch = url.pathname.match(/^\/api\/submaps\/([a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\/[a-z][a-z0-9]*(?:-[a-z0-9]+)*)*)$/);
      if (submapMatch) {
        const snapshot = readSnapshot.readSubmap(submapMatch[1]);
        if (request.headers["if-none-match"] === snapshot.etag) {
          response.writeHead(304, { ...securityHeaders("application/json; charset=utf-8"), ETag: snapshot.etag });
          response.end();
          return;
        }
        sendJson(response, 200, snapshot.model, { ETag: snapshot.etag });
        return;
      }
      if (serveStatic(request, response, assetsRoot, url.pathname)) return;
      sendJson(response, 404, { error: "not found" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = error instanceof BoardRequestError ? error.status : error instanceof BoardError || error instanceof WorkspaceSnapshotError ? 503 : 500;
      if (!response.headersSent) sendJson(response, status, { error: message });
      else response.end();
    }
  });
  server.once("close", () => {
    if (notificationTimer !== null) clearTimeout(notificationTimer);
    clearInterval(fallbackTimer);
    for (const filePath of watchedFiles) fs.unwatchFile(filePath, scheduleRevisionReadback);
    for (const client of streamClients) client.end();
    streamClients.clear();
  });
  return server;
}

export async function startBoardServer({ workspace = null, mapPath = null, statePath = null, port = 4173, assetsRoot = DEFAULT_ASSETS } = {}) {
  const numericPort = Number(port);
  if (!Number.isInteger(numericPort) || numericPort < 0 || numericPort > 65535) {
    throw new BoardError(`invalid board port: ${port}`);
  }
  const server = createBoardServer({ workspace, mapPath, statePath, assetsRoot });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(numericPort, HOST, resolve);
  });
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : numericPort;
  process.stdout.write(`Mapflow board: http://${HOST}:${actualPort}\n`);
  process.stdout.write("Map and history are read-only; the current destination question can be answered explicitly. Press Ctrl+C to stop.\n");
  return server;
}
