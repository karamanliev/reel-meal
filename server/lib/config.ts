import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// Load .env file manually (no dotenv dependency needed in Node 20+)
function loadEnv(): void {
  try {
    const envPath = resolve(process.cwd(), ".env");
    const content = readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env file not found — rely on actual environment variables
  }
}

loadEnv();

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}

function optional(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

function optionalNumber(key: string, fallback: number): number {
  const val = process.env[key];
  if (!val) return fallback;
  const n = Number(val);
  if (isNaN(n)) throw new Error(`Environment variable ${key} must be a number, got: ${val}`);
  return n;
}

function optionalBoolean(key: string, fallback: boolean): boolean {
  const val = process.env[key];
  if (!val) return fallback;

  const normalized = val.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;

  throw new Error(`Environment variable ${key} must be a boolean, got: ${val}`);
}

function detectCookiesFile(): string | null {
  const candidate = resolve(process.cwd(), "cookies.txt");
  return existsSync(candidate) ? candidate : null;
}

export const config = {
  port: optionalNumber("PORT", 3000),

  // LLM
  openaiApiKey: required("OPENAI_API_KEY"),
  openaiBaseUrl: optional("OPENAI_BASE_URL", "https://openrouter.ai/api/v1"),
  openaiModel: optional("OPENAI_MODEL", "google/gemini-2.5-flash"),

  // Transcription fallback model (must support audio)
  transcriptionModel: optional("TRANSCRIPTION_MODEL", "google/gemini-2.5-flash"),

  // Local Whisper (optional)
  whisperApiUrl: process.env["WHISPER_API_URL"] || null,
  whisperTimeoutMs: optionalNumber("WHISPER_TIMEOUT_MS", 15000),
  skipLocalWhisper: optionalBoolean("SKIP_LOCAL_WHISPER", false),

  // yt-dlp cookies file (optional, Netscape format — needed for Instagram, etc.)
  // Auto-detects cookies.txt in project root; env var overrides.
  ytdlpCookiesFile: process.env["YTDLP_COOKIES_FILE"] || detectCookiesFile(),

  // Mealie
  mealieUrl: required("MEALIE_URL").replace(/\/$/, ""),
  mealieApiToken: required("MEALIE_API_TOKEN"),
} as const;

export type Config = typeof config;
