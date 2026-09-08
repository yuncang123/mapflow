import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { LibraryError, openLibrary } from "./library.js";

const MAX_BODY_BYTES = 64 * 1024;
const STATIC_ASSETS = new Map([
  ["/", { contentType: "text/html; charset=utf-8", body: readFileSync(new URL("../public/index.html", import.meta.url)) }],
  ["/index.html", { contentType: "text/html; charset=utf-8", body: readFileSync(new URL("../public/index.html", import.meta.url)) }],
  ["/styles.css", { contentType: "text/css; charset=utf-8", body: readFileSync(new URL("../public/styles.css", import.meta.url)) }],
  ["/app.js", { contentType: "text/javascript; charset=utf-8", body: readFileSync(new URL("../public/app.js", import.meta.url)) }],
]);

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

function sendAsset(response, asset) {
  response.writeHead(200, {
    "content-type": asset.contentType,
    "content-length": asset.body.length,
    "cache-control": "no-cache",
    "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'",
    "x-content-type-options": "nosniff",
  });
  response.end(asset.body);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new LibraryError(413, "body_too_large", "Request body is too large");
    }
    chunks.push(chunk);
  }

  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (value === null || Array.isArray(value) || typeof value !== "object") {
      throw new Error("body must be an object");
    }
    return value;
  } catch (error) {
    if (error instanceof LibraryError) {
      throw error;
    }
    throw new LibraryError(400, "invalid_json", "Request body must be a JSON object");
  }
}

export function createLibraryServer({ dataFile }) {
  const library = openLibrary(dataFile);
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");

      if (request.method === "GET" && STATIC_ASSETS.has(url.pathname)) {
        sendAsset(response, STATIC_ASSETS.get(url.pathname));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/books") {
        sendJson(response, 201, { book: library.createBook(await readJson(request)) });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/readers") {
        sendJson(response, 201, { reader: library.createReader(await readJson(request)) });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/loans") {
        sendJson(response, 201, { loan: library.createLoan(await readJson(request)) });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/returns") {
        sendJson(response, 200, { loan: library.returnLoan(await readJson(request)) });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/loans") {
        if (url.searchParams.get("status") !== "active") {
          throw new LibraryError(400, "unsupported_status", "Only status=active is supported");
        }
        sendJson(response, 200, { loans: library.listActiveLoans() });
        return;
      }

      sendJson(response, 404, { error: { code: "not_found", message: "Route not found" } });
    } catch (error) {
      if (error instanceof LibraryError) {
        sendJson(response, error.status, { error: { code: error.code, message: error.message } });
        return;
      }
      console.error(error);
      sendJson(response, 500, { error: { code: "internal_error", message: "Internal server error" } });
    }
  });

  server.once("close", () => library.close());
  return server;
}

function configuredPort(value) {
  const port = value === undefined ? 3000 : Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("PORT must be an integer between 0 and 65535");
  }
  return port;
}

function startFromEnvironment() {
  const dataFile = path.resolve(process.env.LIBRARY_DATA_FILE || path.join("data", "library.sqlite"));
  const server = createLibraryServer({ dataFile });
  server.listen(configuredPort(process.env.PORT), "127.0.0.1", () => {
    const address = server.address();
    console.log(`Shelfwise listening on http://127.0.0.1:${address.port}`);
    console.log(`Library data file: ${dataFile}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  startFromEnvironment();
}
