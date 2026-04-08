import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  fetchMetadata,
  extractSubtitles,
  downloadAudio,
  downloadThumbnail,
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
// Route
// -------------------------------------------------------------------------

export const parseRouter = new Hono();

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

function hasEnoughRecipeContext(description: string): { ok: boolean; reason?: string } {
  const trimmed = description.trim();
  if (trimmed.length < 160) {
    return {
      ok: false,
      reason:
        "Transcript extraction is disabled and the video description does not contain enough recipe detail to build a reliable recipe. Enable transcript extraction and try again.",
    };
  }

  const quantityMatches = trimmed.match(/(?:\d+(?:[.,]\d+)?|\d+\/\d+|[¼½¾⅓⅔⅛⅜⅝⅞])\s?(?:g|kg|mg|ml|l|tbsp|tsp|cup|cups|oz|lb|бр\.?|ч\.л\.?|с\.л\.?|гр\.?|кг|мл|л)\b/giu) ?? [];
  const recipeSignals = [
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
  ].filter((pattern) => pattern.test(trimmed));
  const nonEmptyLines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  if (quantityMatches.length >= 2 && (recipeSignals.length >= 1 || nonEmptyLines.length >= 4)) {
    return { ok: true };
  }

  return {
    ok: false,
    reason:
      "Transcript extraction is disabled and the available description looks too thin for a reliable parse. Enable transcript extraction and try again.",
  };
}

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

  if (!url) {
    return c.json({ error: "Missing required query parameter: url" }, 400);
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

    // Cleanup handles for temp files
    let audioCleanup: (() => Promise<void>) | null = null;

    const emit = async (event: SSEEvent) => {
      await stream.writeSSE({
        data: JSON.stringify(event),
        event: "message",
      });
    };

    try {
      // ----------------------------------------------------------------
      // Step 1: Fetch metadata
      // ----------------------------------------------------------------
      currentStep = "metadata";
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

      // ----------------------------------------------------------------
      // Step 2: Get transcript
      // ----------------------------------------------------------------
      let transcript = "";
      let transcriptSource: "subtitles" | "audio" | null = null;

      if (!extractTranscript) {
        await emit({
          step: "transcript",
          status: "done",
          message: "Skipped.",
        });

        const contextCheck = hasEnoughRecipeContext(metadata.description);
        if (!contextCheck.ok) {
          await emit({
            step: "parsing",
            status: "error",
            error: contextCheck.reason,
          });
          return;
        }
      } else if (metadata.hasSubtitles) {
        currentStep = "transcript";
        await emit({
          step: "transcript",
          status: "loading",
          message: "Extracting manual subtitles...",
        });

        const subs = metadata.subtitleLanguage
          ? await extractSubtitles(url, metadata.subtitleLanguage)
          : null;

        if (subs) {
          transcript = subs.text;
          transcriptSource = "subtitles";
          console.log(`[parse] Got subtitles (${transcript.length} chars)`);
          await emit({
            step: "transcript",
            status: "done",
            message: "Manual subtitles extracted.",
            data: {
              transcript,
              source: transcriptSource,
            },
          });
        } else {
          // Suitable manual subtitles were reported but extraction failed — fall through to audio
          console.log("[parse] Manual subtitle extraction returned nothing, downloading audio...");
          await emit({
            step: "transcript",
            status: "loading",
            message: "Suitable subtitles unavailable, downloading audio...",
          });

          const audioResult = await downloadAudio(url);
          audioCleanup = audioResult.cleanup;

          await emit({
            step: "transcript",
            status: "loading",
            message: "Transcribing audio...",
          });

          transcript = await transcribeAudio(audioResult.filePath);
          transcriptSource = "audio";
          console.log(`[parse] Transcription done (${transcript.length} chars)`);

          await emit({
            step: "transcript",
            status: "done",
            message: "Audio transcribed.",
            data: {
              transcript,
              source: transcriptSource,
            },
          });
        }
      } else {
        currentStep = "transcript";
        await emit({
          step: "transcript",
          status: "loading",
          message: "Downloading audio for transcription...",
        });

        const audioResult = await downloadAudio(url);
        audioCleanup = audioResult.cleanup;

        await emit({
          step: "transcript",
          status: "loading",
          message: "Transcribing audio...",
        });

        transcript = await transcribeAudio(audioResult.filePath);
        transcriptSource = "audio";
        console.log(`[parse] Transcription done (${transcript.length} chars)`);

        await emit({
          step: "transcript",
          status: "done",
          message: "Audio transcribed.",
          data: {
            transcript,
            source: transcriptSource,
          },
        });
      }

      // Clean up audio ASAP
      if (audioCleanup) {
        await audioCleanup().catch(() => {});
        audioCleanup = null;
      }

      // ----------------------------------------------------------------
      // Step 3: Parse recipe with LLM
      // ----------------------------------------------------------------
      currentStep = "parsing";
      await emit({
        step: "parsing",
        status: "loading",
        message: "Generating recipe with AI...",
      });

      const recipe = await parseRecipeFromTranscript({
        title: metadata.title,
        description: metadata.description,
        transcript,
        translate,
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

      if (!autoImport) {
        return;
      }

      // ----------------------------------------------------------------
      // Step 4: Import to Mealie
      // ----------------------------------------------------------------
      currentStep = "importing";
      await emit({
        step: "importing",
        status: "loading",
        message: "Importing to Mealie...",
      });

      const result = await runRecipeImport({
        preparedImport,
        thumbnailUrl: metadata.thumbnailUrl,
      });

      console.log(`[parse] Imported recipe: ${result.recipeUrl}`);

      await emit({
        step: "importing",
        status: "done",
        message: "Recipe imported successfully!",
        data: {
          recipeUrl: result.recipeUrl,
          slug: result.slug,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[parse] Pipeline error: ${message}`);

      // Determine which step failed based on the error context
      // The last emitted loading step is the one that failed
      // We emit a generic error since we don't track current step here
      await emit({
        step: currentStep,
        status: "error",
        error: message,
      }).catch(() => {});
    } finally {
      // Clean up any remaining temp files
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
