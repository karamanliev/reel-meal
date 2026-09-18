import test from "node:test";
import assert from "node:assert/strict";
import { isUnsafeIp, safeFetchBuffer, validatePublicUrl } from "./safe-fetch.js";

test("rejects private, link-local, credentialed, and IPv6 local URLs", async () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "192.168.1.1", "169.254.1.1", "::1", "fd00::1", "fe80::1"]) assert.equal(isUnsafeIp(address), true);
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
