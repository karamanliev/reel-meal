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
    allowMethods: ["GET", "POST", "OPTIONS"],
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

// Serve /assets and other static files from the client dist directory
app.use(
  "/assets/*",
  serveStatic({ root: "./client/dist" })
);

// Serve index.html for all non-API routes (SPA fallback)
app.use(
  "*",
  serveStatic({ root: "./client/dist", path: "index.html" })
);

// -------------------------------------------------------------------------
// Start
// -------------------------------------------------------------------------

const port = config.port;

console.log(`[server] Mealie Recipe Parser starting on port ${port}`);
console.log(`[server] Mealie instance: ${config.mealieUrl}`);
console.log(
  `[server] Whisper: ${config.whisperApiUrl ? config.whisperApiUrl : "disabled (remote fallback only)"}`
);
console.log(`[server] LLM model: ${config.openaiModel}`);
console.log(`[server] Transcription model: ${config.transcriptionModel}`);

serve({
  fetch: app.fetch,
  port,
});

console.log(`[server] Listening on http://localhost:${port}`);
