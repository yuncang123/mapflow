#!/usr/bin/env node

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { BoardError, createBoardSnapshotReader } from "./mapflow-board-core.mjs";

const TOOL_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ASSETS = path.resolve(TOOL_DIRECTORY, "board");
const HOST = "127.0.0.1";

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

export function createBoardServer({ mapPath = null, statePath = null, assetsRoot = DEFAULT_ASSETS } = {}) {
  const readSnapshot = createBoardSnapshotReader({ mapPath, statePath });
  return http.createServer((request, response) => {
    try {
      if (!new Set(["GET", "HEAD"]).has(request.method)) {
        response.setHeader("Allow", "GET, HEAD");
        sendJson(response, 405, { error: "the board is read-only" });
        return;
      }
      const url = new URL(request.url ?? "/", `http://${HOST}`);
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
        if (request.headers["if-none-match"] === snapshot.etag) {
          response.writeHead(304, {
            ...securityHeaders("application/json; charset=utf-8"),
            ETag: snapshot.etag,
          });
          response.end();
          return;
        }
        const body = url.pathname === "/health" ? {
          status: snapshot.model.projection.source_status,
          map_id: snapshot.model.map.id,
          revision: snapshot.model.projection.revision,
          read_only: true,
        } : snapshot.model;
        sendJson(response, 200, body, { ETag: snapshot.etag });
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
      sendJson(response, error instanceof BoardError ? 503 : 500, { error: message });
    }
  });
}

export async function startBoardServer({ mapPath = null, statePath = null, port = 4173, assetsRoot = DEFAULT_ASSETS } = {}) {
  const numericPort = Number(port);
  if (!Number.isInteger(numericPort) || numericPort < 0 || numericPort > 65535) {
    throw new BoardError(`invalid board port: ${port}`);
  }
  const server = createBoardServer({ mapPath, statePath, assetsRoot });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(numericPort, HOST, resolve);
  });
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : numericPort;
  process.stdout.write(`Mapflow board: http://${HOST}:${actualPort}\n`);
  process.stdout.write("Read-only projection; press Ctrl+C to stop.\n");
  return server;
}
