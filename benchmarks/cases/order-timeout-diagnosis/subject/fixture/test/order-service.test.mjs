import assert from "node:assert/strict";
import test from "node:test";
import { queryOrder } from "../src/order-service.mjs";

const delay = (milliseconds, value) => new Promise((resolve) => setTimeout(() => resolve(value), milliseconds));

test("normal query succeeds in one attempt", async () => {
  const result = await queryOrder("order-1", { fetchOrder: async (id) => ({ id }), timeoutMs: 10 });
  assert.equal(result.status, "ok");
  assert.equal(result.attempts, 1);
});

test("one timeout is retried once", async () => {
  let calls = 0;
  const result = await queryOrder("order-2", {
    timeoutMs: 10,
    fetchOrder: async (id) => (++calls === 1 ? delay(30, { id }) : { id }),
  });
  assert.equal(result.status, "ok");
  assert.equal(result.attempts, 2);
  assert.equal(calls, 2);
});

test("two timeouts use the safe fallback", async () => {
  let calls = 0;
  const result = await queryOrder("order-3", { timeoutMs: 5, fetchOrder: async () => { calls += 1; return delay(30, {}); } });
  assert.deepEqual({ status: result.status, code: result.code, attempts: result.attempts }, { status: "unavailable", code: "UPSTREAM_TIMEOUT", attempts: 2 });
  assert.equal(calls, 2);
});
