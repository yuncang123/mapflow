import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Library } from "./library.mjs";

const port = Number(process.env.PORT ?? 3000);
const file = process.env.LIBRARY_DATA_FILE ?? path.join(os.tmpdir(), "shelfwise-existing.json");
const library = new Library(file);

function send(response, status, body, type = "application/json") {
  response.writeHead(status, { "content-type": `${type}; charset=utf-8` });
  response.end(type === "application/json" ? JSON.stringify(body) : body);
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

export const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  try {
    if (request.method === "GET" && url.pathname === "/") return send(response, 200, "<!doctype html><html><body><h1>Shelfwise</h1></body></html>", "text/html");
    if (request.method === "POST" && url.pathname === "/api/books") return send(response, 201, library.addBook(await readBody(request)));
    if (request.method === "POST" && url.pathname === "/api/readers") return send(response, 201, library.addReader(await readBody(request)));
    if (request.method === "POST" && url.pathname === "/api/loans") return send(response, 201, library.borrow(await readBody(request)));
    if (request.method === "POST" && url.pathname === "/api/returns") return send(response, 200, library.returnBook((await readBody(request)).bookId));
    if (request.method === "GET" && url.pathname === "/api/loans") return send(response, 200, library.listLoans(url.searchParams.get("status")));
    return send(response, 404, { error: "not found" });
  } catch (error) {
    return send(response, 400, { error: error.message });
  }
});

if (path.resolve(process.argv[1] ?? "") === path.resolve(fileURLToPath(import.meta.url))) server.listen(port, "127.0.0.1");
