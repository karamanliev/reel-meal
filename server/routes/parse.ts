import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  fetchMetadata,
  extractSubtitles,
  downloadAudio,
  downloadThumbnail,
  type VideoMetadata,
} from "../lib/ytdlp.js";
import { transcribeAudio } from "../lib/transcribe.js";
import { parseRecipeFromTranscript } from "../lib/llm.js";
import {
  importRecipe,
  prepareRecipeImport,
  type PreparedRecipeImport,
  type RecipeImportPayload,
} from "../lib/mealie.js";

// -------------------------------------------------------------------------
// SSE event types (shared with frontend)
// -------------------------------------------------------------------------

export type StepName = "metadata" | "transcript" | "parsing" | "importing";
export type StepStatus = "loading" | "done" | "error";

export interface SSEEvent {
  step: StepName;
  status: StepStatus;
  message?: string;
  data?: Record<string, unknown>;
  error?: string;
}

// -------------------------------------------------------------------------
// Job lock — one job at a time
// -------------------------------------------------------------------------

let jobRunning = false;

export function isJobRunning(): boolean {
  return jobRunning;
}

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

type EmitFn = (event: SSEEvent) => Promise<void>;

const CUSTOM_PROMPT_MAX_LENGTH = 400;

/**
 * Measurement quantities + units pattern — matches things like "200 g",
 * "1/2 cup", "¼ tsp", "2 бр.", "100 мл", etc.
 */
const QUANTITY_UNIT_RE =
  /(?:\d+(?:[.,]\d+)?|\d+\/\d+|[¼½¾⅓⅔⅛⅜⅝⅞])\s?(?:g|kg|mg|ml|l|tbsp|tsp|cup|cups|oz|lb|бр\.?|ч\.л\.?|с\.л\.?|гр\.?|кг|мл|л)\b/giu;

/** Words/phrases that signal recipe content (EN + BG). */
const RECIPE_SIGNAL_PATTERNS: RegExp[] = [
  /ingredients?/i,
  /instructions?/i,
  /directions?/i,
  /method/i,
  /recipe/i,
  /съставки/i,
  /продукти/i,
  /начин на приготвяне/i,
  /приготвяне/i,
  /разбърка/i,
  /добави/i,
  /печ[еи]/i,
];

const THIN_DESCRIPTION_REASON =
  "Transcript extraction is disabled and the available description looks too thin for a reliable parse. Enable transcript extraction and try again.";
const SHORT_DESCRIPTION_REASON =
  "Transcript extraction is disabled and the video description does not contain enough recipe detail to build a reliable recipe. Enable transcript extraction and try again.";

function hasEnoughRecipeContext(description: string): { ok: boolean; reason?: string } {
  const trimmed = description.trim();

  if (trimmed.length < 160) {
    return { ok: false, reason: SHORT_DESCRIPTION_REASON };
  }

  const quantityCount = (trimmed.match(QUANTITY_UNIT_RE) ?? []).length;
  const signalCount = RECIPE_SIGNAL_PATTERNS.filter((p) => p.test(trimmed)).length;
  const lineCount = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).length;

  if (quantityCount >= 2 && (signalCount >= 1 || lineCount >= 4)) {
    return { ok: true };
  }

  return { ok: false, reason: THIN_DESCRIPTION_REASON };
}

/**
 * Download audio, transcribe it via Whisper, and emit progress events.
 * Returns the transcript text and a cleanup function for the temp audio file.
 */
async function transcribeViaAudio(
  videoUrl: string,
  emit: EmitFn,
  downloadMessage: string,
): Promise<{ transcript: string; cleanup: (() => Promise<void>) | null }> {
  await emit({ step: "transcript", status: "loading", message: downloadMessage });

  const audioResult = await downloadAudio(videoUrl);

  await emit({ step: "transcript", status: "loading", message: "Transcribing audio..." });

  const transcript = await transcribeAudio(audioResult.filePath);
  console.log(`[parse] Transcription done (${transcript.length} chars)`);

  await emit({
    step: "transcript",
    status: "done",
    message: "Audio transcribed.",
    data: { transcript, source: "audio" },
  });

  return { transcript, cleanup: audioResult.cleanup };
}

async function runRecipeImport(params: {
  preparedImport: PreparedRecipeImport;
  thumbnailUrl?: string;
}): Promise<{ recipeUrl: string; slug: string }> {
  const { preparedImport, thumbnailUrl } = params;

  let thumbCleanup: (() => Promise<void>) | null = null;

  try {
    let thumbnailFilePath: string | undefined;
    if (thumbnailUrl) {
      try {
        const thumb = await downloadThumbnail(thumbnailUrl);
        thumbnailFilePath = thumb.filePath;
        thumbCleanup = thumb.cleanup;
      } catch (err) {
        console.warn(`[parse] Thumbnail download failed: ${err instanceof Error ? err.message : err}`);
      }
    }

    return await importRecipe({
      preparedImport,
      thumbnailFilePath,
    });
  } finally {
    if (thumbCleanup) await thumbCleanup().catch(() => {});
  }
}

// -------------------------------------------------------------------------
// Pipeline steps — each returns updated state needed by later steps
// -------------------------------------------------------------------------

async function stepMetadata(
  url: string,
  emit: EmitFn,
): Promise<VideoMetadata> {
  await emit({ step: "metadata", status: "loading", message: "Fetching video info..." });

  const metadata = await fetchMetadata(url);
  const proxiedThumbnailUrl = metadata.thumbnailUrl
    ? `/api/thumbnail?url=${encodeURIComponent(metadata.thumbnailUrl)}`
    : "";
  console.log(`[parse] Metadata fetched: "${metadata.title}"`);

  await emit({
    step: "metadata",
    status: "done",
    message: `Found: ${metadata.title}`,
    data: {
      title: metadata.title,
      thumbnailUrl: proxiedThumbnailUrl,
      duration: metadata.duration,
      uploader: metadata.uploader,
      description: metadata.description,
      webpageUrl: metadata.webpageUrl,
      thumbnailSourceUrl: metadata.thumbnailUrl,
      hasSubtitles: metadata.hasSubtitles,
      subtitleLanguage: metadata.subtitleLanguage,
    },
  });

  return metadata;
}

interface TranscriptResult {
  transcript: string;
  source: "subtitles" | "audio" | null;
  audioCleanup: (() => Promise<void>) | null;
  aborted: boolean;
}

async function stepTranscript(
  url: string,
  metadata: VideoMetadata,
  extractTranscript: boolean,
  emit: EmitFn,
): Promise<TranscriptResult> {
  if (!extractTranscript) {
    await emit({ step: "transcript", status: "done", message: "Skipped." });

    const contextCheck = hasEnoughRecipeContext(metadata.description);
    if (!contextCheck.ok) {
      await emit({ step: "parsing", status: "error", error: contextCheck.reason });
      return { transcript: "", source: null, audioCleanup: null, aborted: true };
    }
    return { transcript: "", source: null, audioCleanup: null, aborted: false };
  }

  // Try manual subtitles first
  if (metadata.hasSubtitles) {
    await emit({ step: "transcript", status: "loading", message: "Extracting manual subtitles..." });

    const subs = metadata.subtitleLanguage
      ? await extractSubtitles(url, metadata.subtitleLanguage)
      : null;

    if (subs) {
      console.log(`[parse] Got subtitles (${subs.text.length} chars)`);
      await emit({
        step: "transcript",
        status: "done",
        message: "Manual subtitles extracted.",
        data: { transcript: subs.text, source: "subtitles" },
      });
      return { transcript: subs.text, source: "subtitles", audioCleanup: null, aborted: false };
    }

    // Subtitles were reported but extraction failed — fall through to audio
    console.log("[parse] Manual subtitle extraction returned nothing, downloading audio...");
  }

  // Fall back to audio transcription
  const downloadMsg = metadata.hasSubtitles
    ? "Suitable subtitles unavailable, downloading audio..."
    : "Downloading audio for transcription...";
  const result = await transcribeViaAudio(url, emit, downloadMsg);
  return { transcript: result.transcript, source: "audio", audioCleanup: result.cleanup, aborted: false };
}

async function stepParsing(
  metadata: VideoMetadata,
  transcript: string,
  translate: boolean,
  customPrompt: string,
  url: string,
  emit: EmitFn,
): Promise<{ preparedImport: PreparedRecipeImport }> {
  await emit({ step: "parsing", status: "loading", message: "Generating recipe with AI..." });

  const recipe = await parseRecipeFromTranscript({
    title: metadata.title,
    description: metadata.description,
    transcript,
    translate,
    customPrompt: customPrompt || undefined,
  });
  const preparedImport = await prepareRecipeImport(recipe, url);

  console.log(`[parse] Recipe parsed: "${recipe.name}" with ${recipe.recipeIngredient.length} ingredients`);

  await emit({
    step: "parsing",
    status: "done",
    message: `Recipe parsed: ${recipe.name}`,
    data: {
      parsedRecipe: recipe,
      importPayload: preparedImport.payload,
      ingredientWarnings: preparedImport.ingredientWarnings,
    },
  });

  return { preparedImport };
}

async function stepImporting(
  preparedImport: PreparedRecipeImport,
  thumbnailUrl: string | undefined,
  emit: EmitFn,
): Promise<void> {
  await emit({ step: "importing", status: "loading", message: "Importing to Mealie..." });

  const result = await runRecipeImport({ preparedImport, thumbnailUrl });
  console.log(`[parse] Imported recipe: ${result.recipeUrl}`);

  await emit({
    step: "importing",
    status: "done",
    message: "Recipe imported successfully!",
    data: { recipeUrl: result.recipeUrl, slug: result.slug },
  });
}

// -------------------------------------------------------------------------
// Route
// -------------------------------------------------------------------------

export const parseRouter = new Hono();

parseRouter.get("/api/thumbnail", async (c) => {
  const thumbnailUrl = c.req.query("url");

  if (!thumbnailUrl) {
    return c.json({ error: "Missing required query parameter: url" }, 400);
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(thumbnailUrl);
  } catch {
    return c.json({ error: "Invalid thumbnail URL" }, 400);
  }

  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    return c.json({ error: "Unsupported thumbnail URL protocol" }, 400);
  }

  const response = await fetch(parsedUrl.toString());
  if (!response.ok) {
    return c.json(
      { error: `Failed to fetch thumbnail: ${response.status} ${response.statusText}` },
      502
    );
  }

  const image = await response.arrayBuffer();
  const contentType = response.headers.get("content-type") ?? "image/jpeg";

  c.header("Content-Type", contentType);
  c.header("Cache-Control", "public, max-age=1800");
  return c.body(image);
});

parseRouter.get("/api/parse", async (c) => {
  const url = c.req.query("url");
  const translate = c.req.query("translate") === "true";
  const extractTranscript = c.req.query("extractTranscript") !== "false";
  const autoImport = c.req.query("autoImport") !== "false";
  const customPrompt = c.req.query("customPrompt")?.trim() || "";

  if (!url) {
    return c.json({ error: "Missing required query parameter: url" }, 400);
  }

  if (customPrompt.length > CUSTOM_PROMPT_MAX_LENGTH) {
    return c.json(
      { error: `Custom prompt is too long. Keep it under ${CUSTOM_PROMPT_MAX_LENGTH} characters.` },
      400
    );
  }

  if (jobRunning) {
    return c.json(
      { error: "A recipe is already being processed. Please wait and try again." },
      409
    );
  }

  return streamSSE(c, async (stream) => {
    jobRunning = true;
    let currentStep: StepName = "metadata";
    let audioCleanup: (() => Promise<void>) | null = null;

    const emit: EmitFn = async (event) => {
      await stream.writeSSE({
        data: JSON.stringify(event),
        event: "message",
      });
    };

    try {
      const metadata = await stepMetadata(url, emit);

      currentStep = "transcript";
      const transcriptResult = await stepTranscript(url, metadata, extractTranscript, emit);
      audioCleanup = transcriptResult.audioCleanup;

      if (transcriptResult.aborted) return;

      // Clean up audio ASAP
      if (audioCleanup) {
        await audioCleanup().catch(() => {});
        audioCleanup = null;
      }

      currentStep = "parsing";
      const { preparedImport } = await stepParsing(
        metadata, transcriptResult.transcript, translate, customPrompt, url, emit,
      );

      if (!autoImport) return;

      currentStep = "importing";
      await stepImporting(preparedImport, metadata.thumbnailUrl, emit);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[parse] Pipeline error: ${message}`);
      await emit({ step: currentStep, status: "error", error: message }).catch(() => {});
    } finally {
      if (audioCleanup) await audioCleanup().catch(() => {});
      jobRunning = false;
    }
  });
});

parseRouter.post("/api/import", async (c) => {
  if (jobRunning) {
    return c.json(
      { error: "A recipe is already being processed. Please wait and try again." },
      409
    );
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (typeof body !== "object" || body === null) {
    return c.json({ error: "Invalid request body" }, 400);
  }

  const payload = (body as { importPayload?: unknown }).importPayload;
  if (typeof payload !== "object" || payload === null) {
    return c.json({ error: "Missing importPayload" }, 400);
  }

  const ingredientWarnings = Array.isArray((body as { ingredientWarnings?: unknown }).ingredientWarnings)
    ? (body as { ingredientWarnings: unknown[] }).ingredientWarnings.filter(
        (warning): warning is string => typeof warning === "string"
      )
    : [];
  const thumbnailUrl =
    typeof (body as { thumbnailUrl?: unknown }).thumbnailUrl === "string"
      ? (body as { thumbnailUrl: string }).thumbnailUrl
      : undefined;

  jobRunning = true;

  try {
    const result = await runRecipeImport({
      preparedImport: {
        payload: payload as RecipeImportPayload,
        ingredientWarnings,
      },
      thumbnailUrl,
    });

    return c.json({
      recipeUrl: result.recipeUrl,
      slug: result.slug,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[parse] Manual import error: ${message}`);
    return c.json({ error: message }, 500);
  } finally {
    jobRunning = false;
  }
});
