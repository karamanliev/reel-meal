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
import { importRecipe } from "../lib/mealie.js";

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

parseRouter.get("/api/parse", async (c) => {
  const url = c.req.query("url");

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

    // Cleanup handles for temp files
    let audioCleanup: (() => Promise<void>) | null = null;
    let thumbCleanup: (() => Promise<void>) | null = null;

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
      await emit({ step: "metadata", status: "loading", message: "Fetching video info..." });

      const metadata = await fetchMetadata(url);
      console.log(`[parse] Metadata fetched: "${metadata.title}"`);

      await emit({
        step: "metadata",
        status: "done",
        message: `Found: ${metadata.title}`,
        data: {
          title: metadata.title,
          thumbnailUrl: metadata.thumbnailUrl,
          duration: metadata.duration,
          uploader: metadata.uploader,
          hasSubtitles: metadata.hasSubtitles,
        },
      });

      // ----------------------------------------------------------------
      // Step 2: Get transcript
      // ----------------------------------------------------------------
      let transcript: string;

      if (metadata.hasSubtitles) {
        await emit({
          step: "transcript",
          status: "loading",
          message: "Extracting subtitles...",
        });

        const subs = await extractSubtitles(url);

        if (subs) {
          transcript = subs.text;
          console.log(`[parse] Got subtitles (${transcript.length} chars)`);
          await emit({
            step: "transcript",
            status: "done",
            message: "Subtitles extracted.",
          });
        } else {
          // Subtitles reported but extraction failed — fall through to audio
          console.log("[parse] Subtitle extraction returned nothing, downloading audio...");
          await emit({
            step: "transcript",
            status: "loading",
            message: "Subtitles unavailable, downloading audio...",
          });

          const audioResult = await downloadAudio(url);
          audioCleanup = audioResult.cleanup;

          await emit({
            step: "transcript",
            status: "loading",
            message: "Transcribing audio...",
          });

          transcript = await transcribeAudio(audioResult.filePath);
          console.log(`[parse] Transcription done (${transcript.length} chars)`);

          await emit({ step: "transcript", status: "done", message: "Audio transcribed." });
        }
      } else {
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
        console.log(`[parse] Transcription done (${transcript.length} chars)`);

        await emit({ step: "transcript", status: "done", message: "Audio transcribed." });
      }

      // Clean up audio ASAP
      if (audioCleanup) {
        await audioCleanup().catch(() => {});
        audioCleanup = null;
      }

      // ----------------------------------------------------------------
      // Step 3: Parse recipe with LLM
      // ----------------------------------------------------------------
      await emit({
        step: "parsing",
        status: "loading",
        message: "Generating recipe with AI...",
      });

      const recipe = await parseRecipeFromTranscript({
        title: metadata.title,
        description: metadata.description,
        transcript,
      });

      console.log(`[parse] Recipe parsed: "${recipe.name}" with ${recipe.recipeIngredient.length} ingredients`);

      await emit({
        step: "parsing",
        status: "done",
        message: `Recipe parsed: ${recipe.name}`,
      });

      // ----------------------------------------------------------------
      // Step 4: Import to Mealie
      // ----------------------------------------------------------------
      await emit({
        step: "importing",
        status: "loading",
        message: "Importing to Mealie...",
      });

      // Download thumbnail
      let thumbnailFilePath: string | undefined;
      if (metadata.thumbnailUrl) {
        try {
          const thumb = await downloadThumbnail(metadata.thumbnailUrl);
          thumbnailFilePath = thumb.filePath;
          thumbCleanup = thumb.cleanup;
        } catch (err) {
          console.warn(`[parse] Thumbnail download failed: ${err instanceof Error ? err.message : err}`);
        }
      }

      const result = await importRecipe({
        recipe,
        originalUrl: url,
        thumbnailFilePath,
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
        step: "importing", // will be overridden client-side by tracking current step
        status: "error",
        error: message,
      }).catch(() => {});
    } finally {
      // Clean up any remaining temp files
      if (audioCleanup) await audioCleanup().catch(() => {});
      if (thumbCleanup) await thumbCleanup().catch(() => {});
      jobRunning = false;
    }
  });
});
