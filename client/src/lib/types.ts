export type StepName = "metadata" | "transcript" | "parsing" | "importing";
export type StepStatus = "idle" | "loading" | "done" | "error";
export type Phase = "input" | "queued" | "loading" | "review" | "done" | "error" | "cancelled";

export interface StepState {
  status: StepStatus;
  message: string;
}

export interface MetadataDetails {
  title: string;
  uploader?: string;
  duration?: number;
  description?: string;
  webpageUrl?: string;
  thumbnailSourceUrl?: string;
  hasSubtitles?: boolean;
  subtitleLanguage?: string;
}

export interface TranscriptDetails {
  transcript: string;
  source: "subtitles" | "audio";
}

export interface ParsingDetails {
  parsedRecipe: unknown;
  importPayload: unknown;
  ingredientWarnings: string[];
}

export interface JobState {
  id: string;
  url: string;
  translate: boolean;
  extractTranscript: boolean;
  autoImport: boolean;
  customPrompt: string;
  status: "queued" | "active" | "done" | "error" | "cancelled";
  addedAt: number;
  steps: Record<StepName, StepState>;
  recipeTitle: string | null;
  thumbnailUrl: string | null;
  recipeUrl: string | null;
  errorMessage: string | null;
  metadataDetails: MetadataDetails | null;
  transcriptDetails: TranscriptDetails | null;
  parsingDetails: ParsingDetails | null;
  position: number;
  totalInQueue: number;
  phase: Phase;
  manualImportError: string | null;
  expandedDetails: Partial<Record<StepName, boolean>>;
}

// Queue SSE event types

export interface StepEventData {
  jobId: string;
  step: StepName;
  status: StepStatus;
  message?: string;
  data?: {
    title?: string;
    thumbnailUrl?: string;
    duration?: number;
    uploader?: string;
    description?: string;
    webpageUrl?: string;
    thumbnailSourceUrl?: string;
    hasSubtitles?: boolean;
    subtitleLanguage?: string;
    transcript?: string;
    source?: "subtitles" | "audio";
    parsedRecipe?: unknown;
    importPayload?: unknown;
    ingredientWarnings?: string[];
    recipeUrl?: string;
    slug?: string;
  };
  error?: string;
}

export interface DiffEntry {
  label: string;
  before: string;
  after: string;
}

export interface IngredientDiff {
  title: string;
  changes: DiffEntry[];
}

export interface ParsingDiff {
  summary: Array<{ label: string; value: string }>;
  recipeChanges: DiffEntry[];
  ingredientChanges: IngredientDiff[];
}

export interface RecipeFact {
  label: string;
  value: string;
}

export interface NutritionEntry {
  label: string;
  value: string;
}

export const STEPS: { id: StepName; label: string }[] = [
  { id: "metadata", label: "Fetching video info" },
  { id: "transcript", label: "Extracting transcript" },
  { id: "parsing", label: "Generating recipe" },
  { id: "importing", label: "Importing to Mealie" },
];

export const DEFAULT_STEPS: Record<StepName, StepState> = {
  metadata: { status: "idle", message: "" },
  transcript: { status: "idle", message: "" },
  parsing: { status: "idle", message: "" },
  importing: { status: "idle", message: "" },
};

export function derivePhase(job: JobState): Phase {
  if (job.status === "queued") return "queued";
  if (job.status === "cancelled") return "cancelled";
  if (job.status === "error") return "error";
  if (job.status === "done") {
    if (job.recipeUrl) return "done";
    if (job.parsingDetails && !job.autoImport) return "review";
    return "done";
  }
  if (job.status === "active") {
    if (job.steps.importing?.status === "loading") return "loading";
    if (job.steps.parsing?.status === "loading") return "loading";
    if (job.steps.transcript?.status === "loading") return "loading";
    if (job.steps.metadata?.status === "loading") return "loading";
    return "loading";
  }
  return "loading";
}