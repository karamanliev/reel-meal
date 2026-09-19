export type StepName = "source" | "extraction" | "generation" | "importing";
export type StepStatus = "idle" | "loading" | "done" | "error";
export type Phase = "input" | "queued" | "loading" | "review" | "done" | "error" | "cancelled";
export type ResolvedSourceType = "video" | "webpage" | "text" | "images";
export interface StepState { status: StepStatus; message: string }
export interface AssetDescriptor { id: string; fileName: string; contentType: string; size: number; previewUrl: string }
export interface SourceDetails { sourceType: ResolvedSourceType; title?: string; url?: string; uploader?: string; duration?: number; description?: string; hasSubtitles?: boolean; subtitleLanguage?: string; extractionMethod?: string; selectedRecipe?: string | null; textLength?: number; textPreview?: string; imageCount?: number; images?: AssetDescriptor[]; selectedImageIndex?: number; customImage?: AssetDescriptor | null }
export interface ExtractedContentDetails { content: string; source: "subtitles" | "audio" | "description" | "webpage" | "pasted-text" | "images" }
export interface ParsingDetails { parsedRecipe: unknown; importPayload: unknown; ingredientWarnings: string[]; nutritionWarnings: string[] }
export interface JobState {
  id: string; sourceKind: "url" | "text" | "images"; displayLabel: string; resolvedSourceType: ResolvedSourceType | null;
  extractTranscript: boolean; autoImport: boolean; customPrompt: string;
  status: "queued" | "active" | "done" | "error" | "cancelled"; addedAt: number; steps: Record<StepName, StepState>;
  recipeTitle: string | null; thumbnailUrl: string | null; recipeUrl: string | null; errorMessage: string | null; warnings: string[];
  sourceDetails: SourceDetails | null; extractedContentDetails: ExtractedContentDetails | null; parsingDetails: ParsingDetails | null;
  hasRetainedContext: boolean; position: number; totalInQueue: number; phase: Phase; manualImportError: string | null;
  expandedDetails: Partial<Record<StepName, boolean>>;
}
export interface StepEventData { jobId: string; step: StepName; status: StepStatus; message?: string; data?: Record<string, unknown>; error?: string }
export interface DiffEntry { label: string; before: string; after: string }
export interface IngredientDiff { title: string; changes: DiffEntry[] }
export interface ParsingDiff { summary: Array<{ label: string; value: string }>; recipeChanges: DiffEntry[]; ingredientChanges: IngredientDiff[] }
export interface RecipeFact { label: string; value: string }
export interface NutritionEntry { label: string; value: string }
export const DEFAULT_STEPS: Record<StepName, StepState> = { source: { status: "idle", message: "" }, extraction: { status: "idle", message: "" }, generation: { status: "idle", message: "" }, importing: { status: "idle", message: "" } };
export function getSteps(type: ResolvedSourceType | null): { id: StepName; label: string }[] {
  const source = type === "video" ? "Fetching video info" : type === "webpage" ? "Fetching recipe page" : type === "images" ? "Preparing images" : "Preparing pasted recipe";
  const extraction = type === "video" ? "Extracting transcript" : type === "webpage" ? "Extracting page content" : type === "images" ? "Reading recipe images" : "Reading pasted text";
  return [{ id: "source", label: source }, { id: "extraction", label: extraction }, { id: "generation", label: "Generating recipe" }, { id: "importing", label: "Importing to Mealie" }];
}
export function derivePhase(job: JobState): Phase { if (job.status === "queued") return "queued"; if (job.status === "cancelled") return "cancelled"; if (job.status === "error") return "error"; if (job.status === "done") return job.recipeUrl ? "done" : job.parsingDetails && !job.autoImport ? "review" : "done"; return "loading"; }
