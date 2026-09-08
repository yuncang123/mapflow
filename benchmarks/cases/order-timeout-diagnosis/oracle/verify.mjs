#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? "");
const modulePath = path.join(root, "src", "order-service.mjs");
if (!fs.existsSync(modulePath)) throw new Error("src/order-service.mjs is missing");
const { queryOrder } = await import(`${pathToFileURL(modulePath).href}?oracle=${Date.now()}`);
if (typeof queryOrder !== "function") throw new Error("queryOrder export is missing");

const delay = (milliseconds, value, reject = false) => new Promise((resolve, fail) => setTimeout(() => (reject ? fail(value) : resolve(value)), milliseconds));

let calls = 0;
let result = await queryOrder("normal", { timeoutMs: 20, fetchOrder: async (id) => { calls += 1; return { id }; } });
if (result.status !== "ok" || result.order?.id !== "normal" || result.attempts !== 1 || calls !== 1) throw new Error("normal path contract failed");

calls = 0;
result = await queryOrder("transient", { timeoutMs: 8, fetchOrder: async (id) => (++calls === 1 ? delay(30, { id }) : { id }) });
if (result.status !== "ok" || result.order?.id !== "transient" || result.attempts !== 2 || calls !== 2) throw new Error("transient timeout retry contract failed");

calls = 0;
result = await queryOrder("persistent", { timeoutMs: 5, fetchOrder: async () => { calls += 1; return delay(30, {}); } });
if (result.status !== "unavailable" || result.code !== "UPSTREAM_TIMEOUT" || result.attempts !== 2 || calls !== 2) throw new Error("persistent timeout fallback contract failed");

calls = 0;
result = await queryOrder("bad-request", { timeoutMs: 20, fetchOrder: async () => { calls += 1; const error = new Error("bad request"); error.code = "BAD_REQUEST"; throw error; } });
if (result.status !== "unavailable" || result.code !== "BAD_REQUEST" || result.attempts !== 1 || calls !== 1) throw new Error("non-timeout error must not retry");

await delay(35, null);
process.stdout.write("hidden acceptance passed: normal, transient timeout, persistent timeout, non-timeout error\n");
