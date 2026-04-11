import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { config } from "./lib/config.js";
import { parseRouter } from "./routes/parse.js";

const app = new Hono();

// -------------------------------------------------------------------------
// Middleware
// -------------------------------------------------------------------------

app.use("*", logger());

// Allow cross-origin requests in dev (Vite dev server runs on a different port)
app.use(
  "/api/*",
  cors({
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  })
);

// -------------------------------------------------------------------------
// API routes
// -------------------------------------------------------------------------

app.route("/", parseRouter);

// Health check
app.get("/api/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

// -------------------------------------------------------------------------
// Static file serving (production — serves the Vite build)
// -------------------------------------------------------------------------

const CLIENT_DIST = "./client/dist";

app.use("/*", serveStatic({ root: CLIENT_DIST }));
app.get("*", serveStatic({ root: CLIENT_DIST, path: "index.html" }));

// -------------------------------------------------------------------------
// Start
// -------------------------------------------------------------------------

const port = config.port;

const whisperStatus = config.skipLocalWhisper
  ? "skipped via SKIP_LOCAL_WHISPER"
  : config.whisperApiUrl ?? "disabled (remote fallback only)";

console.log(
  [
    `[server] Mealie Recipe Parser starting on port ${port}`,
    `  Mealie:        ${config.mealieUrl}`,
    `  LLM model:     ${config.openaiModel}`,
    `  Transcription: ${config.transcriptionModel}`,
    `  Whisper:       ${whisperStatus}`,
    `  yt-dlp cookies: ${config.ytdlpCookiesFile ?? "not configured"}`,
  ].join("\n")
);

serve({
  fetch: app.fetch,
  port,
});

console.log(`[server] Listening on http://localhost:${port}`);
