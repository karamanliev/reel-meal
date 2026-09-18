import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class SafeFetchError extends Error {}

export interface SafeFetchOptions {
  maxBytes: number;
  timeoutMs?: number;
  maxRedirects?: number;
  contentTypes?: string[];
  fetchImpl?: typeof fetch;
  resolveHost?: (hostname: string) => Promise<string[]>;
}

function isUnsafeIpv4(ip: string): boolean {
  const octets = ip.split(".").map(Number);
  const [a, b] = octets;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19));
}

function isUnsafeIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase().split("%")[0];
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd") || /^fe[89ab]/.test(normalized) || normalized.startsWith("ff")) return true;
  const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  return Boolean(mapped && isUnsafeIpv4(mapped));
}

export function isUnsafeIp(ip: string): boolean {
  const family = isIP(ip);
  return family === 4 ? isUnsafeIpv4(ip) : family === 6 ? isUnsafeIpv6(ip) : true;
}

export async function validatePublicUrl(value: string, resolveHost?: (hostname: string) => Promise<string[]>): Promise<URL> {
  let url: URL;
  try { url = new URL(value); } catch { throw new SafeFetchError("URL is malformed."); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new SafeFetchError("Only HTTP and HTTPS URLs are supported.");
  if (url.username || url.password) throw new SafeFetchError("URLs containing credentials are not allowed.");
  if (!url.hostname || url.hostname.endsWith(".")) throw new SafeFetchError("URL has an invalid host.");
  const addresses = resolveHost
    ? (await resolveHost(url.hostname).catch(() => [])).map((address) => ({ address }))
    : await lookup(url.hostname, { all: true, verbatim: true }).catch(() => []);
  if (addresses.length === 0) throw new SafeFetchError("URL host could not be resolved.");
  if (addresses.some(({ address }) => isUnsafeIp(address))) throw new SafeFetchError("URL resolves to a private or restricted network address.");
  return url;
}

export async function safeFetchBuffer(value: string, options: SafeFetchOptions): Promise<{ buffer: Buffer; contentType: string; finalUrl: string }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const redirects = options.maxRedirects ?? 3;
  let current = value;
  for (let redirect = 0; redirect <= redirects; redirect++) {
    const url = await validatePublicUrl(current, options.resolveHost);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
    let response: Response;
    try {
      response = await fetchImpl(url, { redirect: "manual", signal: controller.signal, headers: { Accept: "text/html,image/*;q=0.8", "User-Agent": "ReelMeal/1.0" } });
    } catch (error) {
      throw new SafeFetchError(error instanceof Error && error.name === "AbortError" ? "Remote request timed out." : "Remote request failed.");
    } finally { clearTimeout(timer); }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new SafeFetchError("Remote redirect is missing a destination.");
      if (redirect === redirects) throw new SafeFetchError("Remote request exceeded the redirect limit.");
      current = new URL(location, url).href;
      continue;
    }
    if (!response.ok) throw new SafeFetchError(`Remote request failed with status ${response.status}.`);
    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    if (options.contentTypes && !options.contentTypes.some((type) => contentType.startsWith(type))) throw new SafeFetchError("Remote response has an unsupported content type.");
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > options.maxBytes) throw new SafeFetchError("Remote response exceeds the allowed size.");
    const reader = response.body?.getReader();
    if (!reader) throw new SafeFetchError("Remote response has no body.");
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      total += chunk.byteLength;
      if (total > options.maxBytes) { await reader.cancel(); throw new SafeFetchError("Remote response exceeds the allowed size."); }
      chunks.push(chunk);
    }
    return { buffer: Buffer.concat(chunks), contentType, finalUrl: url.href };
  }
  throw new SafeFetchError("Remote request failed.");
}
