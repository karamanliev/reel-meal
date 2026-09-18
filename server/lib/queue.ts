import { EventEmitter } from "node:events";
import type { ManagedAsset } from "./assets.js";
import type { PreparedRecipeImport } from "./mealie.js";
import type { ResolvedSourceType, SubmittedSource } from "./input.js";

export type StepName = "source" | "extraction" | "generation" | "importing";
export type StepStatus = "idle" | "loading" | "done" | "error";
export interface StepState { status: StepStatus; message: string }

export type NormalizedSourceContext =
  | { kind: "text"; sourceType: Exclude<ResolvedSourceType, "images">; title: string; description: string; body: string; attributionUrl: string; extractionMethod: string }
  | { kind: "images"; assets: ManagedAsset[] };

export interface SourceDetails {
  sourceType: ResolvedSourceType;
  title?: string;
  url?: string;
  uploader?: string;
  duration?: number;
  description?: string;
  hasSubtitles?: boolean;
  subtitleLanguage?: string;
  extractionMethod?: string;
  selectedRecipe?: string | null;
  textLength?: number;
  textPreview?: string;
  imageCount?: number;
  images?: ManagedAsset[];
  selectedImageIndex?: number;
  customImage?: ManagedAsset | null;
}

export interface ExtractedContentDetails {
  content: string;
  source: "subtitles" | "audio" | "description" | "webpage" | "pasted-text" | "images";
}

export interface JobParsingDetails { parsedRecipe: unknown; importPayload: unknown; ingredientWarnings: string[] }
export interface FinalImageState { customAssetId?: string; sourceAssetId?: string; remoteAssetId?: string; selectedSourceIndex?: number; warnings: string[] }

export interface JobParams {
  id: string;
  source: SubmittedSource;
  displayLabel: string;
  sourceAssets: ManagedAsset[];
  customImage: ManagedAsset | null;
  extractTranscript: boolean;
  autoImport: boolean;
  customPrompt: string;
}

export type JobStatus = "queued" | "active" | "done" | "error" | "cancelled";
export interface Job extends JobParams {
  status: JobStatus;
  addedAt: number;
  steps: Record<StepName, StepState>;
  resolvedSourceType: ResolvedSourceType | null;
  recipeTitle: string | null;
  thumbnailUrl: string | null;
  recipeUrl: string | null;
  errorMessage: string | null;
  warnings: string[];
  sourceDetails: SourceDetails | null;
  extractedContentDetails: ExtractedContentDetails | null;
  parsingDetails: JobParsingDetails | null;
  normalizedContext: NormalizedSourceContext | null;
  preparedImport: PreparedRecipeImport | null;
  finalImage: FinalImageState;
  position: number;
  totalInQueue: number;
}

const defaultSteps = (): Record<StepName, StepState> => ({
  source: { status: "idle", message: "" }, extraction: { status: "idle", message: "" },
  generation: { status: "idle", message: "" }, importing: { status: "idle", message: "" },
});
type ProcessCallback = (jobId: string) => void;
type CleanupCallback = (jobId: string) => void | Promise<void>;
const RETENTION_MS = 24 * 60 * 60 * 1000;

export class JobQueue extends EventEmitter {
  private jobs = new Map<string, Job>();
  private queue: string[] = [];
  private activeJobId: string | null = null;
  private cancelledIds = new Set<string>();
  private processCallback: ProcessCallback | null = null;
  private cleanupCallback: CleanupCallback | null = null;
  private expiryTimers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly retentionMs = RETENTION_MS) { super(); }

  setProcessCallback(callback: ProcessCallback): void { this.processCallback = callback }
  setCleanupCallback(callback: CleanupCallback): void { this.cleanupCallback = callback }

  add(params: JobParams): Job {
    if (this.jobs.has(params.id)) throw new Error("A job with this identifier already exists.");
    const job: Job = { ...params, status: "queued", addedAt: Date.now(), steps: defaultSteps(), resolvedSourceType: null,
      recipeTitle: null, thumbnailUrl: params.sourceAssets[0]?.previewUrl ?? params.customImage?.previewUrl ?? null,
      recipeUrl: null, errorMessage: null, warnings: [], sourceDetails: null, extractedContentDetails: null,
      parsingDetails: null, normalizedContext: null, preparedImport: null,
      finalImage: { customAssetId: params.customImage?.id, warnings: [] }, position: 0, totalInQueue: 0 };
    this.jobs.set(job.id, job); this.queue.push(job.id); this.emit("job:added", this.toJson(job));
    if (!this.activeJobId) this.activateNext(); else this.updatePositions();
    return job;
  }

  cancel(jobId: string): boolean {
    const job = this.jobs.get(jobId); if (!job || job.status === "done" || job.status === "error") return false;
    this.queue = this.queue.filter((id) => id !== jobId); const active = this.activeJobId === jobId;
    job.status = "cancelled"; job.errorMessage = "Job cancelled."; this.cancelledIds.add(jobId);
    if (active) { this.activeJobId = null; this.activateNext(); } else this.updatePositions();
    this.emit("job:cancelled", jobId); this.cleanup(jobId); return true;
  }

  remove(jobId: string): boolean {
    const job = this.jobs.get(jobId); if (!job || job.status === "active") return false;
    this.queue = this.queue.filter((id) => id !== jobId); this.jobs.delete(jobId); this.cancelledIds.delete(jobId);
    this.clearExpiry(jobId); this.cleanup(jobId); this.updatePositions(); this.emit("job:removed", jobId); return true;
  }

  complete(jobId: string, recipeUrl: string): void { const job = this.jobs.get(jobId); if (job) { job.status = "done"; job.recipeUrl = recipeUrl; } this.finish(jobId); this.emit("job:done", { jobId, recipeUrl }); }
  review(jobId: string): void { const job = this.jobs.get(jobId); if (job) job.status = "done"; this.finish(jobId); this.emit("job:review", jobId); }
  fail(jobId: string, error: string): void { const job = this.jobs.get(jobId); if (job) { job.status = "error"; job.errorMessage = error; } this.finish(jobId); this.emit("job:error", { jobId, error }); }
  private finish(jobId: string): void { if (this.activeJobId === jobId) this.activeJobId = null; this.cancelledIds.delete(jobId); const job = this.jobs.get(jobId); if (job && (job.sourceAssets.length || job.customImage)) this.scheduleExpiry(jobId); this.activateNext(); }

  isActive(jobId: string): boolean { return this.activeJobId === jobId }
  isCancelled(jobId: string): boolean { return this.cancelledIds.has(jobId) }
  getJob(jobId: string): Job | undefined { return this.jobs.get(jobId) }
  getActiveJobId(): string | null { return this.activeJobId }
  getSnapshot(): object[] { return [...this.jobs.values()].filter((job) => job.status !== "cancelled").sort((a, b) => a.addedAt - b.addedAt).map((job) => this.toJson(job)); }
  updateStep(jobId: string, step: StepName, patch: Partial<StepState>): void { const job = this.jobs.get(jobId); if (job) job.steps[step] = { ...job.steps[step], ...patch }; }
  updateJob(jobId: string, patch: Partial<Job>): void { const job = this.jobs.get(jobId); if (job) Object.assign(job, patch); }
  touch(jobId: string): void { this.clearExpiry(jobId) }

  reprompt(jobId: string, customPrompt: string): boolean {
    const job = this.jobs.get(jobId); if (!job?.normalizedContext || !["done", "error"].includes(job.status) || this.activeJobId) return false;
    this.touch(jobId); job.customPrompt = customPrompt; job.status = "active"; job.parsingDetails = null; job.preparedImport = null;
    job.recipeUrl = null; job.errorMessage = null; job.steps.generation = { status: "loading", message: "Re-generating recipe with AI..." };
    job.steps.importing = { status: "idle", message: "" }; this.activeJobId = jobId; this.cancelledIds.delete(jobId);
    this.emit("job:start", jobId); this.emit("step", { jobId, step: "generation", status: "loading", message: "Re-generating recipe with AI..." }); return true;
  }

  private toJson(job: Job): object {
    return { id: job.id, sourceKind: job.source.kind, displayLabel: job.displayLabel, extractTranscript: job.extractTranscript, autoImport: job.autoImport, customPrompt: job.customPrompt, status: job.status,
      addedAt: job.addedAt, steps: { ...job.steps }, resolvedSourceType: job.resolvedSourceType, recipeTitle: job.recipeTitle,
      thumbnailUrl: job.thumbnailUrl, recipeUrl: job.recipeUrl, errorMessage: job.errorMessage, warnings: [...job.warnings],
      sourceDetails: job.sourceDetails, extractedContentDetails: job.extractedContentDetails, parsingDetails: job.parsingDetails,
      hasRetainedContext: Boolean(job.normalizedContext), position: job.position, totalInQueue: job.totalInQueue };
  }

  private activateNext(): void {
    while (this.queue.length) { const id = this.queue.shift()!; if (this.cancelledIds.has(id)) continue; const job = this.jobs.get(id); if (!job) continue;
      this.activeJobId = id; job.status = "active"; job.position = 0; job.totalInQueue = 0; this.updatePositions(); this.emit("job:start", id); this.processCallback?.(id); return; }
    this.activeJobId = null;
  }
  private updatePositions(): void { const ids = this.queue.filter((id) => this.jobs.has(id) && !this.cancelledIds.has(id)); ids.forEach((id, index) => { const job = this.jobs.get(id)!; const position = index + 1; if (job.position !== position || job.totalInQueue !== ids.length) { job.position = position; job.totalInQueue = ids.length; this.emit("job:position", { jobId: id, position, totalInQueue: ids.length }); } }); }
  private scheduleExpiry(jobId: string): void { this.clearExpiry(jobId); const timer = setTimeout(() => this.remove(jobId), this.retentionMs); timer.unref(); this.expiryTimers.set(jobId, timer); }
  private clearExpiry(jobId: string): void { const timer = this.expiryTimers.get(jobId); if (timer) clearTimeout(timer); this.expiryTimers.delete(jobId); }
  private cleanup(jobId: string): void { Promise.resolve(this.cleanupCallback?.(jobId)).catch((error) => console.warn(`[queue] Asset cleanup failed for ${jobId}: ${error}`)); }
}

export const jobQueue = new JobQueue();
