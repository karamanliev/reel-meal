import test from "node:test";
import assert from "node:assert/strict";
import { createPinnedLookup, isUnsafeIp, safeFetchBuffer, validatePublicUrl } from "./safe-fetch.js";

test("pinned DNS lookup supports single-address and all-address callbacks", () => {
  const lookup = createPinnedLookup("93.184.216.34", 4);
  lookup("public.test", {}, (error, result, family) => {
    assert.equal(error, null);
    assert.equal(result, "93.184.216.34");
    assert.equal(family, 4);
  });
  lookup("public.test", { all: true }, (error, result) => {
    assert.equal(error, null);
    assert.deepEqual(result, [{ address: "93.184.216.34", family: 4 }]);
  });
});

test("rejects private, link-local, credentialed, and IPv6 local URLs", async () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "192.168.1.1", "169.254.1.1", "::1", "fd00::1", "fe80::1", "::ffff:7f00:1"]) assert.equal(isUnsafeIp(address), true);
  await assert.rejects(() => validatePublicUrl("http://user:pass@example.com", async () => ["93.184.216.34"]), /credentials/);
  await assert.rejects(() => validatePublicUrl("http://private.test", async () => ["10.0.0.2"]), /restricted/);
});

test("revalidates redirect destinations and validates content type", async () => {
  const redirectFetch = async () => new Response(null, { status: 302, headers: { location: "http://internal.test/" } });
  await assert.rejects(() => safeFetchBuffer("https://public.test", { maxBytes: 10, fetchImpl: redirectFetch as typeof fetch, resolveHost: async (host) => host === "public.test" ? ["93.184.216.34"] : ["127.0.0.1"] }), /restricted/);
  await assert.rejects(() => safeFetchBuffer("https://public.test", { maxBytes: 100, contentTypes: ["text/html"], fetchImpl: (async () => new Response("{}", { headers: { "content-type": "application/json" } })) as typeof fetch, resolveHost: async () => ["93.184.216.34"] }), /content type/);
});

test("rejects oversized streamed bodies", async () => {
  await assert.rejects(() => safeFetchBuffer("https://public.test", { maxBytes: 3, fetchImpl: (async () => new Response("1234")) as typeof fetch, resolveHost: async () => ["93.184.216.34"] }), /exceeds/);
});

test("keeps the timeout active while reading the response body", async () => {
  const stalledFetch = async (_input: URL | RequestInfo, init?: RequestInit) => new Response(new ReadableStream({
    start(controller) {
      init?.signal?.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")), { once: true });
    },
  }));
  await assert.rejects(() => safeFetchBuffer("https://public.test", { maxBytes: 10, timeoutMs: 5, fetchImpl: stalledFetch as typeof fetch, resolveHost: async () => ["93.184.216.34"] }), /timed out/);
});
