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
import { jobQueue, type StepName, type StepState, type JobMetadataDetails } from "../lib/queue.js";

// -------------------------------------------------------------------------
// SSE event types (shared with frontend)
// -------------------------------------------------------------------------

export type SSEStepName = "metadata" | "transcript" | "parsing" | "importing";
export type SSEStepStatus = "loading" | "done" | "error";

export interface SSEEvent {
  step: SSEStepName;
  status: SSEStepStatus;
  message?: string;
  data?: Record<string, unknown>;
  error?: string;
}

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

type EmitFn = (event: SSEEvent) => Promise<void>;

const CUSTOM_PROMPT_MAX_LENGTH = 400;

const QUANTITY_UNIT_RE =
  /(?:\d+(?:[.,]\d+)?|\d+\/\d+|[¼½¾⅓⅔⅛⅜⅝⅞])\s?(?:g|kg|mg|ml|l|tbsp|tsp|cup|cups|oz|lb|бр\.?|ч\.л\.?|с\.л\.?|гр\.?|кг|мл|л)\b/giu;

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
  const lineCount = trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean).length;

  if (quantityCount >= 2 && (signalCount >= 1 || lineCount >= 4)) {
    return { ok: true };
  }

  return { ok: false, reason: THIN_DESCRIPTION_REASON };
}

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
// Pipeline steps
// -------------------------------------------------------------------------

async function stepMetadata(url: string, emit: EmitFn): Promise<VideoMetadata> {
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

    console.log("[parse] Manual subtitle extraction returned nothing, downloading audio...");
  }

  const downloadMsg = metadata.hasSubtitles
    ? "Suitable subtitles unavailable, downloading audio..."
    : "Downloading audio for transcription...";
  const result = await transcribeViaAudio(url, emit, downloadMsg);
  return {
    transcript: result.transcript,
    source: "audio",
    audioCleanup: result.cleanup,
    aborted: false,
  };
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

  console.log(
    `[parse] Recipe parsed: "${recipe.name}" with ${recipe.recipeIngredient.length} ingredients`,
  );

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
): Promise<{ recipeUrl: string; slug: string }> {
  await emit({ step: "importing", status: "loading", message: "Importing to Mealie..." });

  const result = await runRecipeImport({ preparedImport, thumbnailUrl });
  console.log(`[parse] Imported recipe: ${result.recipeUrl}`);

  await emit({
    step: "importing",
    status: "done",
    message: "Recipe imported successfully!",
    data: { recipeUrl: result.recipeUrl, slug: result.slug },
  });

  return result;
}

// -------------------------------------------------------------------------
// Pipeline runner
// -------------------------------------------------------------------------

async function processJob(jobId: string): Promise<void> {
  const job = jobQueue.getJob(jobId);
  if (!job) return;

  const emit: EmitFn = async (event: SSEEvent) => {
    const stepPatch: Partial<StepState> = {
      status: event.status as StepState["status"],
      message: event.message ?? event.error ?? "",
    };
    jobQueue.updateStep(jobId, event.step as StepName, stepPatch);

    if (event.status === "done" && event.data) {
      if (event.step === "metadata") {
        const d = event.data;
        jobQueue.updateJob(jobId, {
          recipeTitle: (d.title as string) ?? null,
          thumbnailUrl: (d.thumbnailUrl as string) ?? null,
          metadataDetails: {
            title: d.title as string,
            uploader: d.uploader as string | undefined,
            duration: d.duration as number | undefined,
            description: d.description as string | undefined,
            webpageUrl: d.webpageUrl as string | undefined,
            thumbnailSourceUrl: d.thumbnailSourceUrl as string | undefined,
            hasSubtitles: d.hasSubtitles as boolean | undefined,
            subtitleLanguage: d.subtitleLanguage as string | undefined,
          } satisfies JobMetadataDetails,
        });
      } else if (event.step === "transcript") {
        const d = event.data;
        if (
          typeof d.transcript === "string" &&
          (d.source === "subtitles" || d.source === "audio")
        ) {
          jobQueue.updateJob(jobId, {
            transcriptDetails: {
              transcript: d.transcript,
              source: d.source,
            },
          });
        }
      } else if (event.step === "parsing") {
        const d = event.data;
        jobQueue.updateJob(jobId, {
          parsingDetails: {
            parsedRecipe: d.parsedRecipe,
            importPayload: d.importPayload,
            ingredientWarnings: Array.isArray(d.ingredientWarnings)
              ? d.ingredientWarnings.filter((w): w is string => typeof w === "string")
              : [],
          },
        });
      } else if (event.step === "importing") {
        const d = event.data;
        if (d.recipeUrl) {
          jobQueue.updateJob(jobId, { recipeUrl: d.recipeUrl as string });
        }
      }
    }

    if (event.status === "error") {
      jobQueue.updateJob(jobId, { errorMessage: event.error ?? "An unexpected error occurred." });
    }

    jobQueue.emit("step", { jobId, ...event });
  };

  let audioCleanup: (() => Promise<void>) | null = null;

  try {
    const metadata = await stepMetadata(job.url, emit);

    if (jobQueue.isCancelled(jobId)) return;

    const transcriptResult = await stepTranscript(job.url, metadata, job.extractTranscript, emit);
    audioCleanup = transcriptResult.audioCleanup;

    if (transcriptResult.aborted) {
      const errMsg = job.errorMessage ?? "Not enough context to parse a recipe.";
      jobQueue.fail(jobId, errMsg);
      return;
    }

    if (jobQueue.isCancelled(jobId)) return;

    if (audioCleanup) {
      await audioCleanup().catch(() => {});
      audioCleanup = null;
    }

    const { preparedImport } = await stepParsing(
      metadata,
      transcriptResult.transcript,
      job.translate,
      job.customPrompt,
      job.url,
      emit,
    );

    if (jobQueue.isCancelled(jobId)) return;

    if (!job.autoImport) {
      jobQueue.updateStep(jobId, "importing", {
        status: "idle",
        message: "Ready to import when you are.",
      });
      jobQueue.emit("step", {
        jobId,
        step: "importing",
        status: "idle",
        message: "Ready to import when you are.",
      });
      jobQueue.review(jobId);
      return;
    }

    const result = await stepImporting(preparedImport, metadata.thumbnailUrl, emit);
    jobQueue.complete(jobId, result.recipeUrl);
  } catch (err) {
    if (jobQueue.isCancelled(jobId)) return;
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[parse] Pipeline error for job ${jobId}: ${message}`);
    jobQueue.fail(jobId, message);
  } finally {
    if (audioCleanup) await audioCleanup().catch(() => {});
  }
}

jobQueue.setProcessCallback((jobId) => {
  processJob(jobId).catch((err) => {
    console.error(`[parse] Unhandled error in job ${jobId}:`, err);
  });
});

// -------------------------------------------------------------------------
// Routes
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
      502,
    );
  }

  const image = await response.arrayBuffer();
  const contentType = response.headers.get("content-type") ?? "image/jpeg";

  c.header("Content-Type", contentType);
  c.header("Cache-Control", "public, max-age=1800");
  return c.body(image);
});

parseRouter.post("/api/parse", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (typeof body !== "object" || body === null) {
    return c.json({ error: "Invalid request body" }, 400);
  }

  const url = typeof (body as Record<string, unknown>).url === "string" ? ((body as Record<string, unknown>).url as string).trim() : "";
  const translate = (body as Record<string, unknown>).translate === true;
  const extractTranscript = (body as Record<string, unknown>).extractTranscript !== false;
  const autoImport = (body as Record<string, unknown>).autoImport !== false;
  const customPrompt = typeof (body as Record<string, unknown>).customPrompt === "string" ? ((body as Record<string, unknown>).customPrompt as string).trim() : "";
  const jobId = typeof (body as Record<string, unknown>).jobId === "string" ? ((body as Record<string, unknown>).jobId as string) : crypto.randomUUID();

  if (!url) {
    return c.json({ error: "Missing required field: url" }, 400);
  }

  if (customPrompt.length > CUSTOM_PROMPT_MAX_LENGTH) {
    return c.json(
      { error: `Custom prompt is too long. Keep it under ${CUSTOM_PROMPT_MAX_LENGTH} characters.` },
      400,
    );
  }

  const job = jobQueue.add({
    id: jobId,
    url,
    translate,
    extractTranscript,
    autoImport,
    customPrompt,
  });

  return c.json({ jobId: job.id });
});

parseRouter.get("/api/queue", async (c) => {
  const snapshot = jobQueue.getSnapshot();
  return c.json(snapshot);
});

parseRouter.get("/api/queue/stream", async (c) => {
  return streamSSE(c, async (stream) => {
    const handlers: Record<string, (...args: unknown[]) => void> = {};

    handlers["job:added"] = (job: unknown) => {
      stream.writeSSE({ event: "job-added", data: JSON.stringify(job) }).catch(() => {});
    };

    handlers["job:start"] = (jobId: unknown) => {
      stream.writeSSE({ event: "job-start", data: JSON.stringify({ jobId }) }).catch(() => {});
    };

    handlers["job:position"] = (data: unknown) => {
      stream.writeSSE({ event: "job-position", data: JSON.stringify(data) }).catch(() => {});
    };

    handlers["job:cancelled"] = (jobId: unknown) => {
      stream.writeSSE({ event: "job-cancelled", data: JSON.stringify({ jobId }) }).catch(() => {});
    };

    handlers["job:removed"] = (jobId: unknown) => {
      stream.writeSSE({ event: "job-removed", data: JSON.stringify({ jobId }) }).catch(() => {});
    };

    handlers["job:done"] = (data: unknown) => {
      stream.writeSSE({ event: "job-done", data: JSON.stringify(data) }).catch(() => {});
    };

    handlers["job:review"] = (jobId: unknown) => {
      stream.writeSSE({ event: "job-review", data: JSON.stringify({ jobId }) }).catch(() => {});
    };

    handlers["job:error"] = (data: unknown) => {
      stream.writeSSE({ event: "job-error", data: JSON.stringify(data) }).catch(() => {});
    };

    handlers["step"] = (data: unknown) => {
      stream.writeSSE({ event: "step", data: JSON.stringify(data) }).catch(() => {});
    };

    handlers["job:update"] = (jobId: unknown) => {
      stream.writeSSE({ event: "job-update", data: JSON.stringify(jobId) }).catch(() => {});
    };

    for (const [event, handler] of Object.entries(handlers)) {
      jobQueue.on(event, handler);
    }

    const keepalive = setInterval(() => {
      stream.writeSSE({ data: "" }).catch(() => {});
    }, 25000);

    await new Promise<void>((resolve) => {
      const abortHandler = () => {
        clearInterval(keepalive);
        for (const [event, handler] of Object.entries(handlers)) {
          jobQueue.off(event, handler);
        }
        c.req.raw.signal.removeEventListener("abort", abortHandler);
        resolve();
      };
      c.req.raw.signal.addEventListener("abort", abortHandler);
    });
  });
});

parseRouter.patch("/api/queue/:jobId", async (c) => {
  const jobId = c.req.param("jobId");
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (typeof body !== "object" || body === null) {
    return c.json({ error: "Invalid request body" }, 400);
  }

  const job = jobQueue.getJob(jobId);
  if (!job) {
    return c.json({ error: "Job not found." }, 404);
  }

  const newAutoImport = (body as Record<string, unknown>).autoImport;
  if (typeof newAutoImport === "boolean") {
    jobQueue.updateJob(jobId, { autoImport: newAutoImport });
    jobQueue.emit("job:update", jobId);
  }

  return c.json({ success: true, jobId, autoImport: newAutoImport ?? job.autoImport });
});

parseRouter.delete("/api/queue/:jobId", async (c) => {
  const jobId = c.req.param("jobId");
  const job = jobQueue.getJob(jobId);

  if (!job) {
    return c.json({ error: "Job not found." }, 404);
  }

  if (job.status === "queued" || job.status === "active") {
    const cancelled = jobQueue.cancel(jobId);
    if (!cancelled) {
      return c.json({ error: "Failed to cancel job." }, 500);
    }
    return c.json({ success: true, jobId });
  }

  const removed = jobQueue.remove(jobId);
  if (!removed) {
    return c.json({ error: "Failed to remove job." }, 500);
  }
  return c.json({ success: true, jobId });
});

parseRouter.post("/api/import", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (typeof body !== "object" || body === null) {
    return c.json({ error: "Invalid request body" }, 400);
  }

  const payload = (body as Record<string, unknown>).importPayload;
  if (typeof payload !== "object" || payload === null) {
    return c.json({ error: "Missing importPayload" }, 400);
  }

  const ingredientWarnings = Array.isArray((body as Record<string, unknown>).ingredientWarnings)
    ? ((body as Record<string, unknown>).ingredientWarnings as unknown[]).filter(
        (warning): warning is string => typeof warning === "string",
      )
    : [];
  const thumbnailUrl =
    typeof (body as Record<string, unknown>).thumbnailUrl === "string"
      ? ((body as Record<string, unknown>).thumbnailUrl as string)
      : undefined;

  const jobId = typeof (body as Record<string, unknown>).jobId === "string"
    ? ((body as Record<string, unknown>).jobId as string)
    : undefined;

  if (jobId) {
    jobQueue.updateStep(jobId, "importing", { status: "loading", message: "Importing to Mealie..." });
    jobQueue.emit("step", {
      jobId,
      step: "importing",
      status: "loading",
      message: "Importing to Mealie...",
    });
  }

  try {
    const result = await runRecipeImport({
      preparedImport: {
        payload: payload as RecipeImportPayload,
        ingredientWarnings,
      },
      thumbnailUrl,
    });

    if (jobId) {
      jobQueue.updateStep(jobId, "importing", {
        status: "done",
        message: "Recipe imported successfully!",
      });
      jobQueue.updateJob(jobId, { recipeUrl: result.recipeUrl });
      jobQueue.emit("step", {
        jobId,
        step: "importing",
        status: "done",
        message: "Recipe imported successfully!",
        data: { recipeUrl: result.recipeUrl, slug: result.slug },
      });
      jobQueue.emit("job:done", { jobId, recipeUrl: result.recipeUrl });
    }

    return c.json({
      recipeUrl: result.recipeUrl,
      slug: result.slug,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[parse] Manual import error: ${message}`);

    if (jobId) {
      jobQueue.updateStep(jobId, "importing", { status: "error", message });
      jobQueue.updateJob(jobId, { errorMessage: message });
      jobQueue.emit("step", {
        jobId,
        step: "importing",
        status: "error",
        error: message,
      });
    }

    return c.json({ error: message }, 500);
  }
});