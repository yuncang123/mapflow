class UpstreamTimeout extends Error {
  constructor() {
    super("upstream timeout");
    this.code = "UPSTREAM_TIMEOUT";
  }
}

async function within(promise, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new UpstreamTimeout()), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function queryOrder(orderId, { fetchOrder, timeoutMs = 25 } = {}) {
  try {
    const order = await within(fetchOrder(orderId), timeoutMs);
    return { status: "ok", order, attempts: 1 };
  } catch (error) {
    if (error.code !== "UPSTREAM_TIMEOUT") return { status: "unavailable", code: error.code ?? "UPSTREAM_ERROR", attempts: 1 };
    return { status: "unavailable", code: "UPSTREAM_TIMEOUT", attempts: 1 };
  }
}
