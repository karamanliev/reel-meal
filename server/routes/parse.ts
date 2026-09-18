import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import { readFile } from "node:fs/promises";
import { fetchMetadata, extractSubtitles, downloadAudio, type VideoMetadata } from "../lib/ytdlp.js";
import { transcribeAudio } from "../lib/transcribe.js";
import { parseRecipeSource, IncompleteRecipeError } from "../lib/llm.js";
import { importRecipe, prepareRecipeImport } from "../lib/mealie.js";
import { assetManager, type ManagedAsset } from "../lib/assets.js";
import { extractRecipeWebpage } from "../lib/webpage.js";
import { safeFetchBuffer, validatePublicUrl } from "../lib/safe-fetch.js";
import { assertModelInputLength, MAX_CUSTOM_PROMPT_CHARS, MAX_MULTIPART_BYTES, type SubmittedSource } from "../lib/input.js";
import { jobQueue, type Job, type StepName, type StepState, type SourceDetails, type ExtractedContentDetails } from "../lib/queue.js";

type SSEEvent = { step: StepName; status: StepState["status"]; message?: string; data?: Record<string, unknown>; error?: string };
type Emit = (event: SSEEvent) => Promise<void>;

function emitFor(jobId: string): Emit {
  return async (event) => {
    jobQueue.updateStep(jobId, event.step, { status: event.status, message: event.message ?? event.error ?? "" });
    jobQueue.emit("step", { jobId, ...event });
  };
}

async function cacheRemoteImage(job: Job, url: string, label: string): Promise<ManagedAsset | null> {
  try {
    const response = await safeFetchBuffer(url, { maxBytes: 10 * 1024 * 1024, timeoutMs: 10_000, contentTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"] });
    return await assetManager.saveRemote(job.id, response.buffer, response.contentType, label);
  } catch (error) {
    job.warnings.push(`Source image could not be retained: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

async function prepareVideo(job: Job, metadata: VideoMetadata, emit: Emit): Promise<void> {
  job.resolvedSourceType = "video";
  const remote = metadata.thumbnailUrl ? await cacheRemoteImage(job, metadata.thumbnailUrl, "video-thumbnail.jpg") : null;
  if (remote) { job.finalImage.remoteAssetId = remote.id; job.thumbnailUrl = remote.previewUrl; }
  const details: SourceDetails = { sourceType: "video", title: metadata.title, url: metadata.webpageUrl || (job.source.kind === "url" ? job.source.url : ""), uploader: metadata.uploader, duration: metadata.duration, description: metadata.description, hasSubtitles: metadata.hasSubtitles, subtitleLanguage: metadata.subtitleLanguage ?? undefined, customImage: job.customImage };
  job.sourceDetails = details; job.recipeTitle = metadata.title;
  await emit({ step: "source", status: "done", message: `Found video: ${metadata.title}`, data: { sourceDetails: details, recipeTitle: metadata.title, thumbnailUrl: job.thumbnailUrl, resolvedSourceType: "video" } });

  let transcript = ""; let source: ExtractedContentDetails["source"] = "subtitles"; let cleanup: (() => Promise<void>) | null = null;
  if (job.extractTranscript) {
    await emit({ step: "extraction", status: "loading", message: metadata.hasSubtitles ? "Extracting subtitles..." : "Downloading audio for transcription..." });
    const subtitles = metadata.hasSubtitles && metadata.subtitleLanguage ? await extractSubtitles((job.source as { kind: "url"; url: string }).url, metadata.subtitleLanguage) : null;
    if (subtitles) transcript = subtitles.text;
    else {
      const audio = await downloadAudio((job.source as { kind: "url"; url: string }).url); cleanup = audio.cleanup; source = "audio";
      transcript = await transcribeAudio(audio.filePath);
    }
  }
  try {
    const body = assertModelInputLength(`${metadata.description}${transcript ? `\n\nTranscript:\n${transcript}` : ""}`);
    job.normalizedContext = { kind: "text", sourceType: "video", title: metadata.title, description: metadata.description, body, attributionUrl: metadata.webpageUrl || (job.source as { kind: "url"; url: string }).url, extractionMethod: transcript ? source : "description" };
    const extracted: ExtractedContentDetails = { content: body, source: transcript ? source : "description" };
    job.extractedContentDetails = extracted;
    await emit({ step: "extraction", status: "done", message: transcript ? `${source === "audio" ? "Audio transcribed" : "Subtitles extracted"}.` : "Using video description.", data: { extractedContentDetails: extracted } });
  } finally { if (cleanup) await cleanup().catch(() => {}); }
}

async function prepareUrl(job: Job, emit: Emit): Promise<void> {
  const url = (job.source as { kind: "url"; url: string }).url;
  await emit({ step: "source", status: "loading", message: "Checking URL and trying video extraction first..." });
  await validatePublicUrl(url);
  let videoError = "";
  try { const metadata = await fetchMetadata(url); await prepareVideo(job, metadata, emit); return; }
  catch (error) { videoError = error instanceof Error ? error.message : String(error); }
  await emit({ step: "source", status: "loading", message: "Not a supported video. Fetching static recipe page..." });
  try {
    const page = await extractRecipeWebpage(url); job.resolvedSourceType = "webpage";
    const remote = page.imageUrl ? await cacheRemoteImage(job, page.imageUrl, "webpage-recipe-image.jpg") : null;
    if (remote) { job.finalImage.remoteAssetId = remote.id; job.thumbnailUrl = remote.previewUrl; }
    const details: SourceDetails = { sourceType: "webpage", title: page.title, url: page.canonicalUrl, description: page.description, extractionMethod: page.extractionMethod, selectedRecipe: page.selectedRecipe, customImage: job.customImage };
    job.sourceDetails = details; job.recipeTitle = page.title;
    job.normalizedContext = { kind: "text", sourceType: "webpage", title: page.title, description: page.description, body: page.body, attributionUrl: page.canonicalUrl, extractionMethod: page.extractionMethod };
    job.extractedContentDetails = { content: page.body, source: "webpage" };
    await emit({ step: "source", status: "done", message: `Found recipe page: ${page.title}`, data: { sourceDetails: details, recipeTitle: page.title, thumbnailUrl: job.thumbnailUrl, resolvedSourceType: "webpage" } });
    await emit({ step: "extraction", status: "done", message: page.extractionMethod === "json-ld" ? "Schema.org Recipe data extracted." : "Readable page content extracted.", data: { extractedContentDetails: job.extractedContentDetails } });
  } catch (pageError) {
    throw new Error(`URL could not be processed as video or recipe page. Video: ${videoError}. Page: ${pageError instanceof Error ? pageError.message : pageError}`);
  }
}

async function prepareSource(job: Job, emit: Emit): Promise<void> {
  if (job.source.kind === "url") return prepareUrl(job, emit);
  await emit({ step: "source", status: "loading", message: job.source.kind === "text" ? "Preparing pasted recipe text..." : "Validating retained recipe images..." });
  if (job.source.kind === "text") {
    const body = assertModelInputLength(job.source.text); job.resolvedSourceType = "text";
    job.normalizedContext = { kind: "text", sourceType: "text", title: "Pasted recipe", description: "", body, attributionUrl: "", extractionMethod: "pasted-text" };
    job.sourceDetails = { sourceType: "text", title: "Pasted recipe", textLength: body.length, textPreview: body.slice(0, 500), customImage: job.customImage };
    job.extractedContentDetails = { content: body, source: "pasted-text" };
    await emit({ step: "source", status: "done", message: `Prepared ${body.length.toLocaleString()} characters of pasted text.`, data: { sourceDetails: job.sourceDetails, resolvedSourceType: "text" } });
    await emit({ step: "extraction", status: "done", message: "Pasted recipe text ready.", data: { extractedContentDetails: job.extractedContentDetails } });
    return;
  }
  for (const asset of job.sourceAssets) await assetManager.resolve(job.id, asset.id);
  job.resolvedSourceType = "images"; job.normalizedContext = { kind: "images", assets: job.sourceAssets };
  job.sourceDetails = { sourceType: "images", title: `${job.sourceAssets.length} recipe image${job.sourceAssets.length === 1 ? "" : "s"}`, imageCount: job.sourceAssets.length, images: job.sourceAssets, customImage: job.customImage };
  job.thumbnailUrl = job.sourceAssets[0]?.previewUrl ?? job.customImage?.previewUrl ?? null;
  job.extractedContentDetails = { content: `${job.sourceAssets.length} ordered recipe images retained for vision analysis.`, source: "images" };
  await emit({ step: "source", status: "done", message: `${job.sourceAssets.length} recipe image${job.sourceAssets.length === 1 ? "" : "s"} ready.`, data: { sourceDetails: job.sourceDetails, thumbnailUrl: job.thumbnailUrl, resolvedSourceType: "images" } });
  await emit({ step: "extraction", status: "done", message: "Images ready for vision analysis.", data: { extractedContentDetails: job.extractedContentDetails } });
}

async function generate(job: Job, emit: Emit): Promise<void> {
  if (!job.normalizedContext) throw new Error("Prepared source context is missing.");
  await emit({ step: "generation", status: "loading", message: job.resolvedSourceType === "images" ? "Reading images and generating recipe with AI..." : "Generating recipe with AI..." });
  let generated;
  try { generated = await parseRecipeSource({ jobId: job.id, context: job.normalizedContext, customPrompt: job.customPrompt || undefined }); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const looksLikeVisionCapabilityError = /(?:support[^.]*(?:image|vision|multimodal)|(?:image|vision|multimodal)[^.]*support|image_url)/i.test(message);
    if (job.resolvedSourceType === "images" && !(error instanceof IncompleteRecipeError) && looksLikeVisionCapabilityError) throw new Error(`The configured OPENAI_MODEL may not support image input: ${message}`);
    throw error;
  }
  const orgUrl = job.normalizedContext.kind === "text" && (job.resolvedSourceType === "video" || job.resolvedSourceType === "webpage") ? job.normalizedContext.attributionUrl : "";
  job.preparedImport = await prepareRecipeImport(generated.recipe, orgUrl);
  if (job.resolvedSourceType === "images") {
    const index = generated.preferredSourceImageIndex ?? 0; const selected = job.sourceAssets[index] ?? job.sourceAssets[0];
    job.finalImage.selectedSourceIndex = index; job.finalImage.sourceAssetId = selected?.id;
    if (job.sourceDetails) job.sourceDetails.selectedImageIndex = index;
    if (!job.customImage && selected) job.thumbnailUrl = selected.previewUrl;
  }
  job.recipeTitle = generated.recipe.name;
  job.parsingDetails = { parsedRecipe: generated.recipe, importPayload: job.preparedImport.payload, ingredientWarnings: job.preparedImport.ingredientWarnings };
  await emit({ step: "generation", status: "done", message: `Recipe generated: ${generated.recipe.name}`, data: { parsingDetails: job.parsingDetails, recipeTitle: generated.recipe.name, sourceDetails: job.sourceDetails, thumbnailUrl: job.thumbnailUrl } });
}

async function importPrepared(job: Job, emit: Emit): Promise<{ recipeUrl: string }> {
  if (!job.preparedImport) throw new Error("Prepared recipe is missing. Generate it again.");
  jobQueue.touch(job.id); await emit({ step: "importing", status: "loading", message: "Importing to Mealie..." });
  const ids = [job.finalImage.customAssetId, job.finalImage.sourceAssetId ?? job.finalImage.remoteAssetId].filter((id, index, all): id is string => Boolean(id) && all.indexOf(id) === index);
  const paths: string[] = [];
  for (const id of ids) { try { paths.push((await assetManager.resolve(job.id, id)).path); } catch (error) { job.warnings.push(`Image is no longer available: ${error instanceof Error ? error.message : error}`); } }
  const result = await importRecipe({ preparedImport: job.preparedImport, imageFilePaths: paths });
  job.warnings.push(...result.warnings); job.finalImage.warnings.push(...result.warnings);
  await emit({ step: "importing", status: "done", message: result.warnings.length ? "Recipe imported with image warnings." : "Recipe imported successfully!", data: { recipeUrl: result.recipeUrl, warnings: job.warnings } });
  return result;
}

async function finishAfterGeneration(job: Job, emit: Emit): Promise<void> {
  if (!job.autoImport) { await emit({ step: "importing", status: "idle", message: "Ready to import when you are." }); jobQueue.review(job.id); return; }
  const result = await importPrepared(job, emit); jobQueue.complete(job.id, result.recipeUrl);
}

async function processJob(jobId: string): Promise<void> {
  const job = jobQueue.getJob(jobId); if (!job) return; const emit = emitFor(jobId);
  try { await prepareSource(job, emit); if (jobQueue.isCancelled(jobId)) return; await generate(job, emit); if (jobQueue.isCancelled(jobId)) return; await finishAfterGeneration(job, emit); }
  catch (error) { if (jobQueue.isCancelled(jobId)) return; const message = error instanceof Error ? error.message : String(error); const step = job.normalizedContext ? "generation" : "source"; await emit({ step, status: "error", error: message }); jobQueue.fail(jobId, message); }
}

jobQueue.setProcessCallback((jobId) => void processJob(jobId));
jobQueue.setCleanupCallback((jobId) => assetManager.cleanupJob(jobId));

function field(body: Record<string, string | File | (string | File)[]>, name: string): string {
  const value = body[name]; if (Array.isArray(value)) { if (value.length !== 1 || typeof value[0] !== "string") throw new Error(`Invalid multipart field: ${name}.`); return value[0]; }
  return typeof value === "string" ? value : "";
}
function files(body: Record<string, string | File | (string | File)[]>, name: string): File[] { const value = body[name]; return (Array.isArray(value) ? value : value ? [value] : []).filter((item): item is File => item instanceof File); }
function bool(value: string, defaultValue: boolean): boolean { if (!value) return defaultValue; if (value === "true") return true; if (value === "false") return false; throw new Error("Boolean form fields must be true or false."); }
function safeJobId(value: string): string { const id = value || crypto.randomUUID(); if (!/^[a-zA-Z0-9_-]{8,128}$/.test(id)) throw new Error("Invalid job identifier."); return id; }

export const parseRouter = new Hono();
parseRouter.get("/api/assets/:jobId/:assetId", async (c) => {
  try { const job = jobQueue.getJob(c.req.param("jobId")); if (!job) return c.json({ error: "Job not found." }, 404); const asset = await assetManager.resolve(job.id, c.req.param("assetId")); c.header("Content-Type", asset.contentType); c.header("X-Content-Type-Options", "nosniff"); c.header("Cache-Control", "private, no-store"); return c.body(await readFile(asset.path)); }
  catch (error) { return c.json({ error: error instanceof Error ? error.message : String(error) }, 404); }
});

parseRouter.post("/api/parse", bodyLimit({ maxSize: MAX_MULTIPART_BYTES, onError: (c) => c.json({ error: "Upload request exceeds the allowed size." }, 413) }), async (c) => {
  let jobId = "";
  try {
    const contentType = c.req.header("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const raw = await c.req.json<Record<string, unknown>>(); const url = typeof raw.url === "string" ? raw.url.trim() : "";
      if (!url) return c.json({ error: "Missing required field: url" }, 400); jobId = safeJobId(typeof raw.jobId === "string" ? raw.jobId : "");
      const customPrompt = typeof raw.customPrompt === "string" ? raw.customPrompt.trim() : ""; if (customPrompt.length > MAX_CUSTOM_PROMPT_CHARS) return c.json({ error: "Custom prompt is too long." }, 400);
      const job = jobQueue.add({ id: jobId, source: { kind: "url", url }, displayLabel: url, sourceAssets: [], customImage: null, extractTranscript: raw.extractTranscript !== false, autoImport: raw.autoImport !== false, customPrompt });
      return c.json({ jobId: job.id });
    }
    if (!contentType.includes("multipart/form-data")) return c.json({ error: "Use JSON or multipart form data." }, 415);
    const body = await c.req.parseBody({ all: true }) as Record<string, string | File | (string | File)[]>;
    jobId = safeJobId(field(body, "jobId")); const kind = field(body, "kind"); const value = field(body, "value").trim();
    const customPrompt = field(body, "customPrompt").trim(); if (customPrompt.length > MAX_CUSTOM_PROMPT_CHARS) throw new Error("Custom prompt is too long.");
    const sourceFiles = files(body, "sourceImages"); const customFiles = files(body, "customImage");
    if (!['url', 'text', 'images'].includes(kind)) throw new Error("Invalid input kind.");
    if ((kind === "images" && value) || (kind !== "images" && sourceFiles.length)) throw new Error("A job must contain exactly one recipe source type.");
    if (kind !== "images" && !value) throw new Error("Recipe source is empty.");
    let sourceAssets: ManagedAsset[] = []; let customImage: ManagedAsset | null = null;
    if (sourceFiles.length) sourceAssets = await assetManager.saveUploads(jobId, sourceFiles, "source");
    if (customFiles.length) customImage = (await assetManager.saveUploads(jobId, customFiles, "custom"))[0] ?? null;
    let source: SubmittedSource;
    if (kind === "url") source = { kind: "url", url: value }; else if (kind === "text") source = { kind: "text", text: assertModelInputLength(value) }; else { if (!sourceAssets.length) throw new Error("Choose at least one source image."); source = { kind: "images", assetIds: sourceAssets.map((asset) => asset.id) }; }
    const displayLabel = source.kind === "url" ? source.url : source.kind === "text" ? source.text.slice(0, 80) : `${sourceAssets.length} recipe image${sourceAssets.length === 1 ? "" : "s"}`;
    const job = jobQueue.add({ id: jobId, source, displayLabel, sourceAssets, customImage, extractTranscript: bool(field(body, "extractTranscript"), true), autoImport: bool(field(body, "autoImport"), true), customPrompt });
    return c.json({ jobId: job.id });
  } catch (error) { if (jobId && !jobQueue.getJob(jobId)) await assetManager.cleanupJob(jobId).catch(() => {}); return c.json({ error: error instanceof Error ? error.message : String(error) }, 400); }
});

parseRouter.get("/api/queue", (c) => c.json(jobQueue.getSnapshot()));
parseRouter.get("/api/queue/stream", (c) => streamSSE(c, async (stream) => {
  const mapping: Record<string, string> = { "job:added": "job-added", "job:start": "job-start", "job:position": "job-position", "job:cancelled": "job-cancelled", "job:removed": "job-removed", "job:done": "job-done", "job:review": "job-review", "job:error": "job-error", "job:update": "job-update", step: "step" };
  const handlers = new Map<string, (...args: unknown[]) => void>();
  for (const [internal, external] of Object.entries(mapping)) { const handler = (data: unknown) => { const payload = ["job:start", "job:cancelled", "job:removed", "job:review"].includes(internal) ? { jobId: data } : data; void stream.writeSSE({ event: external, data: JSON.stringify(payload) }); }; handlers.set(internal, handler); jobQueue.on(internal, handler); }
  const keepalive = setInterval(() => void stream.writeSSE({ data: "" }), 25_000);
  await new Promise<void>((resolve) => c.req.raw.signal.addEventListener("abort", () => { clearInterval(keepalive); for (const [event, handler] of handlers) jobQueue.off(event, handler); resolve(); }, { once: true }));
}));

parseRouter.patch("/api/queue/:jobId", async (c) => { const job = jobQueue.getJob(c.req.param("jobId")); if (!job) return c.json({ error: "Job not found." }, 404); const body = await c.req.json<{ autoImport?: boolean }>(); if (typeof body.autoImport === "boolean") { job.autoImport = body.autoImport; jobQueue.emit("job:update", job.id); } return c.json({ success: true, autoImport: job.autoImport }); });
parseRouter.delete("/api/queue/:jobId", (c) => { const job = jobQueue.getJob(c.req.param("jobId")); if (!job) return c.json({ error: "Job not found." }, 404); const ok = job.status === "queued" || job.status === "active" ? jobQueue.cancel(job.id) : jobQueue.remove(job.id); return ok ? c.json({ success: true }) : c.json({ error: "Job could not be removed." }, 409); });

parseRouter.post("/api/import/:jobId", async (c) => {
  const job = jobQueue.getJob(c.req.param("jobId")); if (!job) return c.json({ error: "Job not found." }, 404); if (!job.preparedImport) return c.json({ error: "Job has no prepared recipe to import." }, 400);
  try { const result = await importPrepared(job, emitFor(job.id)); jobQueue.complete(job.id, result.recipeUrl); return c.json({ recipeUrl: result.recipeUrl }); }
  catch (error) { const message = error instanceof Error ? error.message : String(error); await emitFor(job.id)({ step: "importing", status: "error", error: message }); return c.json({ error: message }, 500); }
});

parseRouter.post("/api/reprompt/:jobId", async (c) => {
  const jobId = c.req.param("jobId"); const body: { customPrompt?: string } = await c.req.json<{ customPrompt?: string }>().catch(() => ({})); const customPrompt = body.customPrompt?.trim() ?? "";
  if (customPrompt.length > MAX_CUSTOM_PROMPT_CHARS) return c.json({ error: "Custom prompt is too long." }, 400);
  if (!jobQueue.reprompt(jobId, customPrompt)) return c.json({ error: "Job cannot be reprompted or another job is active." }, 409);
  const job = jobQueue.getJob(jobId)!; process.nextTick(async () => { try { await generate(job, emitFor(jobId)); if (!jobQueue.isCancelled(jobId)) await finishAfterGeneration(job, emitFor(jobId)); } catch (error) { if (!jobQueue.isCancelled(jobId)) jobQueue.fail(jobId, error instanceof Error ? error.message : String(error)); } });
  return c.json({ success: true, jobId });
});
