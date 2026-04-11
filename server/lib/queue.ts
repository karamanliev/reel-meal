import { EventEmitter } from "node:events";

export type StepName = "metadata" | "transcript" | "parsing" | "importing";
export type StepStatus = "idle" | "loading" | "done" | "error";

export interface StepState {
  status: StepStatus;
  message: string;
}

export interface JobMetadataDetails {
  title: string;
  uploader?: string;
  duration?: number;
  description?: string;
  webpageUrl?: string;
  thumbnailSourceUrl?: string;
  hasSubtitles?: boolean;
  subtitleLanguage?: string;
}

export interface JobTranscriptDetails {
  transcript: string;
  source: "subtitles" | "audio";
}

export interface JobParsingDetails {
  parsedRecipe: unknown;
  importPayload: unknown;
  ingredientWarnings: string[];
}

export interface JobParams {
  id: string;
  url: string;
  translate: boolean;
  extractTranscript: boolean;
  autoImport: boolean;
  customPrompt: string;
}

export type JobStatus = "queued" | "active" | "done" | "error" | "cancelled";

export interface Job extends JobParams {
  status: JobStatus;
  addedAt: number;
  steps: Record<StepName, StepState>;
  recipeTitle: string | null;
  thumbnailUrl: string | null;
  recipeUrl: string | null;
  errorMessage: string | null;
  metadataDetails: JobMetadataDetails | null;
  transcriptDetails: JobTranscriptDetails | null;
  parsingDetails: JobParsingDetails | null;
  position: number;
  totalInQueue: number;
}

const DEFAULT_STEPS: Record<StepName, StepState> = {
  metadata: { status: "idle", message: "" },
  transcript: { status: "idle", message: "" },
  parsing: { status: "idle", message: "" },
  importing: { status: "idle", message: "" },
};

type ProcessCallback = (jobId: string) => void;

class JobQueue extends EventEmitter {
  private jobs: Map<string, Job> = new Map();
  private queue: string[] = [];
  private activeJobId: string | null = null;
  private cancelledIds: Set<string> = new Set();
  private processCallback: ProcessCallback | null = null;

  setProcessCallback(callback: ProcessCallback): void {
    this.processCallback = callback;
  }

  add(params: JobParams): Job {
    const job: Job = {
      ...params,
      status: "queued",
      addedAt: Date.now(),
      steps: { ...DEFAULT_STEPS },
      recipeTitle: null,
      thumbnailUrl: null,
      recipeUrl: null,
      errorMessage: null,
      metadataDetails: null,
      transcriptDetails: null,
      parsingDetails: null,
      position: 0,
      totalInQueue: 0,
    };

    this.jobs.set(job.id, job);
    this.queue.push(job.id);

    this.emit("job:added", this.toJson(job));

    if (!this.activeJobId) {
      this.activateNext();
    } else {
      this.updatePositions();
    }

    return job;
  }

  cancel(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    if (job.status === "cancelled") return true;
    if (job.status === "done" || job.status === "error") return false;

    const queueIndex = this.queue.indexOf(jobId);
    if (queueIndex !== -1) {
      this.queue.splice(queueIndex, 1);
    }

    const wasActive = this.activeJobId === jobId;
    job.status = "cancelled";
    job.errorMessage = "Job cancelled.";
    this.cancelledIds.add(jobId);

    if (wasActive) {
      this.activeJobId = null;
      this.activateNext();
    } else {
      this.updatePositions();
    }

    this.emit("job:cancelled", jobId);

    return true;
  }

  remove(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    if (job.status === "active") return false;

    const queueIndex = this.queue.indexOf(jobId);
    if (queueIndex !== -1) {
      this.queue.splice(queueIndex, 1);
    }

    this.jobs.delete(jobId);
    this.cancelledIds.delete(jobId);

    if (job.status === "queued") {
      this.updatePositions();
    }

    this.emit("job:removed", jobId);
    return true;
  }

  complete(jobId: string, recipeUrl: string): void {
    const job = this.jobs.get(jobId);
    if (job) {
      job.status = "done";
      job.recipeUrl = recipeUrl;
    }
    if (this.activeJobId === jobId) {
      this.activeJobId = null;
    }
    this.cancelledIds.delete(jobId);
    this.emit("job:done", { jobId, recipeUrl });
    this.activateNext();
  }

  review(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (job) {
      job.status = "done";
    }
    if (this.activeJobId === jobId) {
      this.activeJobId = null;
    }
    this.cancelledIds.delete(jobId);
    this.emit("job:review", jobId);
    this.activateNext();
  }

  fail(jobId: string, error: string): void {
    const job = this.jobs.get(jobId);
    if (job) {
      job.status = "error";
      job.errorMessage = error;
    }
    if (this.activeJobId === jobId) {
      this.activeJobId = null;
    }
    this.cancelledIds.delete(jobId);
    this.emit("job:error", { jobId, error });
    this.activateNext();
  }

  isActive(jobId: string): boolean {
    return this.activeJobId === jobId;
  }

  isCancelled(jobId: string): boolean {
    return this.cancelledIds.has(jobId);
  }

  getJob(jobId: string): Job | undefined {
    return this.jobs.get(jobId);
  }

  getSnapshot(): object[] {
    return Array.from(this.jobs.values())
      .filter((j) => j.status !== "cancelled")
      .sort((a, b) => a.addedAt - b.addedAt)
      .map((j) => this.toJson(j));
  }

  updateStep(jobId: string, step: StepName, patch: Partial<StepState>): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.steps[step] = { ...job.steps[step], ...patch };
  }

  updateJob(jobId: string, patch: Partial<Job>): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    Object.assign(job, patch);
  }

  private toJson(job: Job): object {
    return {
      id: job.id,
      url: job.url,
      translate: job.translate,
      extractTranscript: job.extractTranscript,
      autoImport: job.autoImport,
      customPrompt: job.customPrompt,
      status: job.status,
      addedAt: job.addedAt,
      steps: { ...job.steps },
      recipeTitle: job.recipeTitle,
      thumbnailUrl: job.thumbnailUrl,
      recipeUrl: job.recipeUrl,
      errorMessage: job.errorMessage,
      metadataDetails: job.metadataDetails ? { ...job.metadataDetails } : null,
      transcriptDetails: job.transcriptDetails ? { ...job.transcriptDetails } : null,
      parsingDetails: job.parsingDetails
        ? {
            parsedRecipe: job.parsingDetails.parsedRecipe,
            importPayload: job.parsingDetails.importPayload,
            ingredientWarnings: [...job.parsingDetails.ingredientWarnings],
          }
        : null,
      position: job.position,
      totalInQueue: job.totalInQueue,
    };
  }

  private activateNext(): void {
    while (this.queue.length > 0) {
      const jobId = this.queue.shift()!;
      if (this.cancelledIds.has(jobId)) continue;

      this.activeJobId = jobId;
      const job = this.jobs.get(jobId);
      if (job) {
        job.status = "active";
        job.position = 0;
        job.totalInQueue = 0;
      }

      this.updatePositions();
      this.emit("job:start", jobId);

      if (this.processCallback) {
        this.processCallback(jobId);
      }

      return;
    }
    this.activeJobId = null;
  }

  private updatePositions(): void {
    const activeQueue = this.queue.filter((id) => {
      const job = this.jobs.get(id);
      return job && !this.cancelledIds.has(id);
    });

    const total = activeQueue.length;
    activeQueue.forEach((id, index) => {
      const job = this.jobs.get(id);
      if (!job || this.cancelledIds.has(id)) return;
      const position = index + 1;
      if (job.position !== position || job.totalInQueue !== total) {
        job.position = position;
        job.totalInQueue = total;
        this.emit("job:position", { jobId: id, position, totalInQueue: total });
      }
    });
  }
}

export const jobQueue = new JobQueue();