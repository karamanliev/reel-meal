export type StepName = "metadata" | "transcript" | "parsing" | "importing";
export type StepStatus = "idle" | "loading" | "done" | "error";
export type Phase = "input" | "loading" | "review" | "done" | "error";

export interface SSEEvent {
  step: StepName;
  status: "loading" | "done" | "error";
  message?: string;
  error?: string;
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
}

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
