import { useState, useRef } from "react";
import styles from "./App.module.css";

// -------------------------------------------------------------------------
// Types (mirror the server SSE event shape)
// -------------------------------------------------------------------------

type StepName = "metadata" | "transcript" | "parsing" | "importing";
type StepStatus = "idle" | "loading" | "done" | "error";

interface SSEEvent {
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

interface StepState {
  status: StepStatus;
  message: string;
}

interface MetadataDetails {
  title: string;
  uploader?: string;
  duration?: number;
  description?: string;
  webpageUrl?: string;
  thumbnailSourceUrl?: string;
  hasSubtitles?: boolean;
  subtitleLanguage?: string;
}

interface TranscriptDetails {
  transcript: string;
  source: "subtitles" | "audio";
}

interface ParsingDetails {
  parsedRecipe: unknown;
  importPayload: unknown;
  ingredientWarnings: string[];
}

interface DiffEntry {
  label: string;
  before: string;
  after: string;
}

interface IngredientDiff {
  title: string;
  changes: DiffEntry[];
}

interface ParsingDiff {
  summary: Array<{ label: string; value: string }>;
  recipeChanges: DiffEntry[];
  ingredientChanges: IngredientDiff[];
}

interface RecipeFact {
  label: string;
  value: string;
}

interface NutritionEntry {
  label: string;
  value: string;
}

const STEPS: { id: StepName; label: string }[] = [
  { id: "metadata", label: "Fetching video info" },
  { id: "transcript", label: "Extracting transcript" },
  { id: "parsing", label: "Generating recipe" },
  { id: "importing", label: "Importing to Mealie" },
];

const DEFAULT_STEPS: Record<StepName, StepState> = {
  metadata: { status: "idle", message: "" },
  transcript: { status: "idle", message: "" },
  parsing: { status: "idle", message: "" },
  importing: { status: "idle", message: "" },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeEmptyText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

function normalizeComparableValue(value: unknown): unknown {
  if (value == null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  return value;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}

function humanizeIsoDuration(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(
    /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i
  );
  if (!match) return trimmed;

  const [, daysText, hoursText, minutesText, secondsText] = match;
  const days = daysText ? Number(daysText) : 0;
  const hours = hoursText ? Number(hoursText) : 0;
  const minutes = minutesText ? Number(minutesText) : 0;
  const seconds = secondsText ? Math.round(Number(secondsText)) : 0;

  const parts: string[] = [];
  if (days) parts.push(`${days} day${days === 1 ? "" : "s"}`);
  if (hours) parts.push(`${hours} hr`);
  if (minutes) parts.push(`${minutes} min`);
  if (seconds && parts.length === 0) parts.push(`${seconds} sec`);

  return parts.join(" ") || trimmed;
}

function formatVideoDuration(value: number): string {
  const totalSeconds = Math.max(0, Math.round(value));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];

  if (hours) parts.push(`${hours} hr`);
  if (minutes) parts.push(`${minutes} min`);
  if (seconds && hours === 0) parts.push(`${seconds} sec`);

  return parts.join(" ") || "0 sec";
}

function formatTimeValue(value: unknown): string {
  return typeof value === "string" && value.trim() ? humanizeIsoDuration(value) : "";
}

function getInstructions(value: unknown): Record<string, unknown>[] {
  if (!isRecord(value) || !Array.isArray(value.recipeInstructions)) return [];
  return value.recipeInstructions.filter(isRecord);
}

function hasMeaningfulValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

function pickPreferredValue(primary: unknown, fallback: unknown): unknown {
  return hasMeaningfulValue(primary) ? primary : fallback;
}

function formatIngredientPreview(ingredient: Record<string, unknown>): string {
  const display = normalizeEmptyText(ingredient.display);
  if (display) return display;

  const parts = [
    typeof ingredient.quantity === "number" ? formatNumber(ingredient.quantity) : "",
    getNamedValue(ingredient.unit).name,
    getNamedValue(ingredient.food).name,
    normalizeEmptyText(ingredient.note),
  ].filter(Boolean);

  return parts.join(" ") || normalizeEmptyText(ingredient.originalText) || "Ingredient";
}

function getSectionTitle(value: unknown): string {
  return normalizeEmptyText(isRecord(value) ? value.title : value);
}

function buildRecipeFacts(details: ParsingDetails): RecipeFact[] {
  const parsedRecipe = isRecord(details.parsedRecipe) ? details.parsedRecipe : {};
  const importPayload = isRecord(details.importPayload) ? details.importPayload : {};

  const facts: RecipeFact[] = [];
  const recipeServings = pickPreferredValue(importPayload.recipeServings, parsedRecipe.recipeServings);
  const prepTime = pickPreferredValue(importPayload.prepTime, parsedRecipe.prepTime);
  const cookTime = pickPreferredValue(importPayload.cookTime, parsedRecipe.cookTime);
  const totalTime = pickPreferredValue(importPayload.totalTime, parsedRecipe.totalTime);

  if (typeof recipeServings === "number") {
    facts.push({ label: "Servings", value: formatNumber(recipeServings) });
  }

  const prepTimeValue = formatTimeValue(prepTime);
  if (prepTimeValue) facts.push({ label: "Prep time", value: prepTimeValue });

  const cookTimeValue = formatTimeValue(cookTime);
  if (cookTimeValue) facts.push({ label: "Cook time", value: cookTimeValue });

  const totalTimeValue = formatTimeValue(totalTime);
  if (totalTimeValue) facts.push({ label: "Total time", value: totalTimeValue });

  return facts;
}

function getNutritionEntries(details: ParsingDetails): NutritionEntry[] {
  const parsedRecipe = isRecord(details.parsedRecipe) ? details.parsedRecipe : {};
  const importPayload = isRecord(details.importPayload) ? details.importPayload : {};
  const nutrition = pickPreferredValue(importPayload.nutrition, parsedRecipe.nutrition);
  if (!isRecord(nutrition)) return [];

  const fields: Array<[key: string, label: string]> = [
    ["calories", "Calories"],
    ["proteinContent", "Protein"],
    ["fatContent", "Fat"],
    ["carbohydrateContent", "Carbs"],
    ["fiberContent", "Fiber"],
    ["sugarContent", "Sugar"],
    ["sodiumContent", "Sodium"],
  ];

  return fields
    .map(([key, label]) => ({ label, value: normalizeEmptyText(nutrition[key]) }))
    .filter((entry) => entry.value);
}

function formatDiffValue(value: unknown): string {
  if (value == null) return "not set";
  if (typeof value === "string") return value.trim() || "not set";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function getNamedValue(value: unknown): { name: string; id: string | null } {
  if (!isRecord(value)) return { name: "", id: null };
  return {
    name: typeof value.name === "string" ? value.name.trim() : "",
    id: typeof value.id === "string" ? value.id : null,
  };
}

function getIngredients(value: unknown): Record<string, unknown>[] {
  if (!isRecord(value) || !Array.isArray(value.recipeIngredient)) return [];
  return value.recipeIngredient.filter(isRecord);
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(normalizeComparableValue(a)) === JSON.stringify(normalizeComparableValue(b));
}

function buildParsingDiff(details: ParsingDetails): ParsingDiff {
  const parsedRecipe = isRecord(details.parsedRecipe) ? details.parsedRecipe : {};
  const importPayload = isRecord(details.importPayload) ? details.importPayload : {};

  const recipeChanges: DiffEntry[] = [];
  const recipeFields: Array<[key: string, label: string]> = [
    ["recipeServings", "Servings"],
    ["prepTime", "Prep time"],
    ["cookTime", "Cook time"],
    ["totalTime", "Total time"],
    ["recipeCategory", "Categories"],
    ["tags", "Tags"],
    ["nutrition", "Nutrition"],
    ["orgURL", "Source URL"],
  ];

  for (const [key, label] of recipeFields) {
    const before = parsedRecipe[key];
    const after = importPayload[key];
    if (!sameJson(before, after)) {
      const isTimeField = key === "prepTime" || key === "cookTime" || key === "totalTime";
      recipeChanges.push({
        label,
        before: isTimeField ? formatTimeValue(before) || "not set" : formatDiffValue(before),
        after: isTimeField ? formatTimeValue(after) || "not set" : formatDiffValue(after),
      });
    }
  }

  const parsedIngredients = getIngredients(parsedRecipe);
  const importedIngredients = getIngredients(importPayload);
  const ingredientChanges: IngredientDiff[] = [];

  for (let index = 0; index < Math.max(parsedIngredients.length, importedIngredients.length); index += 1) {
    const parsedIngredient = parsedIngredients[index] ?? {};
    const importedIngredient = importedIngredients[index] ?? {};
    const title =
      (typeof importedIngredient.originalText === "string" && importedIngredient.originalText) ||
      (typeof parsedIngredient.originalText === "string" && parsedIngredient.originalText) ||
      `Ingredient ${index + 1}`;

    const changes: DiffEntry[] = [];

    if (!sameJson(parsedIngredient.quantity, importedIngredient.quantity)) {
      changes.push({
        label: "Quantity",
        before: formatDiffValue(parsedIngredient.quantity),
        after: formatDiffValue(importedIngredient.quantity),
      });
    }

    const parsedUnit = getNamedValue(parsedIngredient.unit);
    const importedUnit = getNamedValue(importedIngredient.unit);
    if (parsedUnit.name !== importedUnit.name) {
      changes.push({
        label: "Unit",
        before: parsedUnit.name || "none",
        after: importedUnit.name || "none",
      });
    } else if (parsedUnit.name && importedUnit.id) {
      changes.push({
        label: "Unit linked",
        before: parsedUnit.name,
        after: `${importedUnit.name} (${importedUnit.id.slice(0, 8)}...)`,
      });
    }

    const parsedFood = getNamedValue(parsedIngredient.food);
    const importedFood = getNamedValue(importedIngredient.food);
    if (parsedFood.name !== importedFood.name) {
      changes.push({
        label: "Food",
        before: parsedFood.name || "none",
        after: importedFood.name || "none",
      });
    } else if (parsedFood.name && importedFood.id) {
      changes.push({
        label: "Food linked",
        before: parsedFood.name,
        after: `${importedFood.name} (${importedFood.id.slice(0, 8)}...)`,
      });
    }

    const parsedNote = normalizeEmptyText(parsedIngredient.note);
    const importedNote = normalizeEmptyText(importedIngredient.note);
    if (parsedNote !== importedNote) {
      changes.push({
        label: "Note",
        before: parsedNote || "empty",
        after: importedNote || "empty",
      });
    }

    if (changes.length > 0) {
      ingredientChanges.push({ title, changes });
    }
  }

  const importedFoodLinks = importedIngredients.filter((ingredient) => getNamedValue(ingredient.food).id).length;
  const importedUnitLinks = importedIngredients.filter((ingredient) => getNamedValue(ingredient.unit).id).length;

  return {
    summary: [
      { label: "Foods linked", value: String(importedFoodLinks) },
      { label: "Units linked", value: String(importedUnitLinks) },
      { label: "Recipe changes", value: String(recipeChanges.length) },
      { label: "Ingredients changed", value: String(ingredientChanges.length) },
    ],
    recipeChanges,
    ingredientChanges,
  };
}

// -------------------------------------------------------------------------
// Component
// -------------------------------------------------------------------------

export default function App() {
  const CUSTOM_PROMPT_MAX_LENGTH = 400;
  const [url, setUrl] = useState("");
  const [translate, setTranslate] = useState(false);
  const [extractTranscript, setExtractTranscript] = useState(true);
  const [autoImport, setAutoImport] = useState(true);
  const [useCustomPrompt, setUseCustomPrompt] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const [phase, setPhase] = useState<"input" | "loading" | "review" | "done" | "error">("input");
  const [steps, setSteps] = useState<Record<StepName, StepState>>(DEFAULT_STEPS);
  const [recipeTitle, setRecipeTitle] = useState<string | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [recipeUrl, setRecipeUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [manualImportError, setManualImportError] = useState<string | null>(null);
  const [metadataDetails, setMetadataDetails] = useState<MetadataDetails | null>(null);
  const [transcriptDetails, setTranscriptDetails] = useState<TranscriptDetails | null>(null);
  const [parsingDetails, setParsingDetails] = useState<ParsingDetails | null>(null);
  const [expandedDetails, setExpandedDetails] = useState<Partial<Record<StepName, boolean>>>({});

  const eventSourceRef = useRef<EventSource | null>(null);
  // Track which step is currently active so errors can be attributed correctly
  const currentStepRef = useRef<StepName>("metadata");

  const updateStep = (name: StepName, patch: Partial<StepState>) => {
    setSteps((prev) => ({ ...prev, [name]: { ...prev[name], ...patch } }));
  };

  const reset = () => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setPhase("input");
    setSteps(DEFAULT_STEPS);
    currentStepRef.current = "metadata";
    setRecipeTitle(null);
    setThumbnailUrl(null);
    setRecipeUrl(null);
    setErrorMessage(null);
    setManualImportError(null);
    setMetadataDetails(null);
    setTranscriptDetails(null);
    setParsingDetails(null);
    setExpandedDetails({});
  };

  const toggleDetails = (step: StepName) => {
    setExpandedDetails((prev) => ({ ...prev, [step]: !prev[step] }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;

    reset();
    // Small delay to let reset complete before opening SSE
    setTimeout(() => startParsing(trimmed), 50);
  };

  const startParsing = (videoUrl: string) => {
    setPhase("loading");
    setManualImportError(null);

    const params = new URLSearchParams({
      url: videoUrl,
      translate: String(translate),
      extractTranscript: String(extractTranscript),
      autoImport: String(autoImport),
    });
    const trimmedCustomPrompt = customPrompt.trim();
    if (useCustomPrompt && trimmedCustomPrompt) {
      params.set("customPrompt", trimmedCustomPrompt);
    }

    const es = new EventSource(`/api/parse?${params.toString()}`);
    eventSourceRef.current = es;

    es.addEventListener("message", (event: MessageEvent) => {
      const msg: SSEEvent = JSON.parse(event.data as string);

      if (msg.status === "loading") {
        currentStepRef.current = msg.step;
        updateStep(msg.step, { status: "loading", message: msg.message ?? "" });
      } else if (msg.status === "done") {
        updateStep(msg.step, { status: "done", message: msg.message ?? "" });

        // Show metadata as soon as it arrives
        if (msg.step === "metadata" && msg.data) {
          if (msg.data.title) setRecipeTitle(msg.data.title);
          if (msg.data.thumbnailUrl) setThumbnailUrl(msg.data.thumbnailUrl);

          if (msg.data.title) {
            setMetadataDetails({
              title: msg.data.title,
              uploader: msg.data.uploader,
              duration: msg.data.duration,
              description: msg.data.description,
              webpageUrl: msg.data.webpageUrl,
              thumbnailSourceUrl: msg.data.thumbnailSourceUrl,
              hasSubtitles: msg.data.hasSubtitles,
              subtitleLanguage: msg.data.subtitleLanguage,
            });
          }
        }

        if (
          msg.step === "transcript" &&
          typeof msg.data?.transcript === "string" &&
          (msg.data.source === "subtitles" || msg.data.source === "audio")
        ) {
          setTranscriptDetails({
            transcript: msg.data.transcript,
            source: msg.data.source,
          });
        }

        if (
          msg.step === "parsing" &&
          msg.data?.parsedRecipe !== undefined &&
          msg.data?.importPayload !== undefined
        ) {
          setParsingDetails({
            parsedRecipe: msg.data.parsedRecipe,
            importPayload: msg.data.importPayload,
            ingredientWarnings: Array.isArray(msg.data.ingredientWarnings)
              ? msg.data.ingredientWarnings.filter((warning): warning is string => typeof warning === "string")
              : [],
          });

          if (!autoImport) {
            updateStep("importing", {
              status: "idle",
              message: "Ready to import when you are.",
            });
            setExpandedDetails((prev) => ({ ...prev, parsing: true }));
            setPhase("review");
            eventSourceRef.current = null;
            es.close();
            return;
          }
        }

        // Final step done
        if (msg.step === "importing" && msg.data?.recipeUrl) {
          setRecipeUrl(msg.data.recipeUrl);
          setPhase("done");
          eventSourceRef.current = null;
          es.close();
        }
      } else if (msg.status === "error") {
        const failedStep = msg.step ?? currentStepRef.current;
        updateStep(failedStep, {
          status: "error",
          message: msg.error ?? "An unexpected error occurred.",
        });
        setErrorMessage(msg.error ?? "An unexpected error occurred.");
        setPhase("error");
        eventSourceRef.current = null;
        es.close();
      }
    });

    es.onerror = () => {
      if (eventSourceRef.current !== es) return;
      updateStep(currentStepRef.current, {
        status: "error",
        message: "Connection to server lost. Please try again.",
      });
      setErrorMessage("Connection to server lost. Please try again.");
      setPhase("error");
      eventSourceRef.current = null;
      es.close();
    };
  };

  const handleManualImport = async () => {
    if (!parsingDetails) return;

    setManualImportError(null);
    setErrorMessage(null);
    setPhase("loading");
    currentStepRef.current = "importing";
    updateStep("importing", {
      status: "loading",
      message: "Importing to Mealie...",
    });

    try {
      const response = await fetch("/api/import", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          importPayload: parsingDetails.importPayload,
          ingredientWarnings: parsingDetails.ingredientWarnings,
          thumbnailUrl: metadataDetails?.thumbnailSourceUrl,
        }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        recipeUrl?: string;
      };

      if (!response.ok || !data.recipeUrl) {
        throw new Error(data.error || "Manual import failed.");
      }

      setRecipeUrl(data.recipeUrl);
      updateStep("importing", {
        status: "done",
        message: "Recipe imported successfully!",
      });
      setPhase("done");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      updateStep("importing", {
        status: "error",
        message,
      });
      setManualImportError(message);
      setPhase("review");
    }
  };

  const isLoading = phase === "loading";
  const parsingDiff = parsingDetails ? buildParsingDiff(parsingDetails) : null;
  const recipeFacts = parsingDetails ? buildRecipeFacts(parsingDetails) : [];
  const nutritionEntries = parsingDetails ? getNutritionEntries(parsingDetails) : [];
  const previewIngredients = parsingDetails ? getIngredients(parsingDetails.importPayload) : [];
  const previewInstructions = parsingDetails ? getInstructions(parsingDetails.importPayload) : [];
  const showDiffView = Boolean(recipeUrl);
  const showImportPreview = phase === "review" && Boolean(parsingDetails) && !recipeUrl;
  const showManualImportPanel = phase === "review" && Boolean(parsingDetails) && !recipeUrl;

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className={styles.logoIcon} aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" />
            <path d="M7 2v20" />
            <path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" />
          </svg>
        </div>
        <div>
          <h1 className={styles.title}>Recipe Parser</h1>
          <p className={styles.subtitle}>Import recipes from YouTube &amp; Instagram into Mealie</p>
        </div>
      </header>

      <main className={styles.main}>
        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.inputRow}>
            <input
              className={styles.input}
              type="url"
              placeholder="Paste a YouTube or Instagram video URL..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={isLoading}
              required
              autoFocus
            />
            <button
              className={styles.button}
              type="submit"
              disabled={isLoading || !url.trim()}
            >
              {isLoading ? "Processing..." : autoImport ? "Import Recipe" : "Generate Recipe"}
            </button>
          </div>
          <div className={styles.checkboxRow}>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={translate}
                onChange={(e) => setTranslate(e.target.checked)}
                disabled={isLoading}
              />
              <span>Translate to English</span>
            </label>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={useCustomPrompt}
                onChange={(e) => setUseCustomPrompt(e.target.checked)}
                disabled={isLoading}
              />
              <span>Custom prompt</span>
            </label>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={extractTranscript}
                onChange={(e) => setExtractTranscript(e.target.checked)}
                disabled={isLoading}
              />
              <span>Extract transcript</span>
            </label>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={autoImport}
                onChange={(e) => setAutoImport(e.target.checked)}
                disabled={isLoading}
              />
              <span>Auto import</span>
            </label>
          </div>
          {useCustomPrompt && (
            <div className={styles.customPromptWrap}>
              <textarea
                className={styles.textarea}
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder='Add extra instructions for the parser. Example: "Prefer metric units" or "Keep steps extra concise".'
                disabled={isLoading}
                maxLength={CUSTOM_PROMPT_MAX_LENGTH}
                rows={4}
              />
              <div className={styles.fieldHint}>
                Extra instructions are added on top of the built-in parser prompt. Keep it short.
              </div>
            </div>
          )}
        </form>

        {(phase === "loading" || phase === "review" || phase === "done" || phase === "error") && (
          <div className={styles.card}>
            {/* Recipe preview — appears as soon as metadata arrives */}
            {(recipeTitle || thumbnailUrl) && (
              <div className={styles.recipePreview}>
                {thumbnailUrl && (
                  <img
                    className={styles.thumbnail}
                    src={thumbnailUrl}
                    alt={recipeTitle ?? "Recipe thumbnail"}
                  />
                )}
                {recipeTitle && (
                  <h2 className={styles.recipeTitle}>{recipeTitle}</h2>
                )}
              </div>
            )}

            {/* Step progress list */}
            <ol className={styles.steps}>
              {STEPS.map((step) => {
                const state = steps[step.id];
                const hasDetails =
                  (step.id === "metadata" && Boolean(metadataDetails)) ||
                  (step.id === "transcript" && Boolean(transcriptDetails)) ||
                  (step.id === "parsing" && Boolean(parsingDetails));
                const detailsOpen = Boolean(expandedDetails[step.id]);
                return (
                  <li
                    key={step.id}
                    className={[styles.step, styles[`step--${state.status}`]].join(" ")}
                  >
                    <span className={styles.stepIcon} aria-hidden="true">
                      {state.status === "done" && <CheckIcon />}
                      {state.status === "loading" && <Spinner />}
                      {state.status === "error" && <ErrorIcon />}
                      {state.status === "idle" && <IdleIcon />}
                    </span>
                    <span className={styles.stepText}>
                      <span className={styles.stepLabel}>{step.label}</span>
                      {state.message && (
                        <span className={styles.stepMessage}>{state.message}</span>
                      )}
                      {hasDetails && (
                        <button
                          type="button"
                          className={styles.detailsButton}
                          onClick={() => toggleDetails(step.id)}
                        >
                          {detailsOpen ? "Hide details" : "Show details"}
                        </button>
                      )}
                      {step.id === "metadata" && detailsOpen && metadataDetails && (
                        <div className={styles.detailsPanel}>
                          <p><strong>Title:</strong> {metadataDetails.title}</p>
                          {metadataDetails.uploader && <p><strong>Uploader:</strong> {metadataDetails.uploader}</p>}
                          {typeof metadataDetails.duration === "number" && (
                            <p><strong>Duration:</strong> {formatVideoDuration(metadataDetails.duration)}</p>
                          )}
                          <p>
                            <strong>Manual same-language subtitles:</strong>{" "}
                            {metadataDetails.hasSubtitles ? "Yes" : "No"}
                          </p>
                          {metadataDetails.subtitleLanguage && (
                            <p><strong>Subtitle language:</strong> {metadataDetails.subtitleLanguage}</p>
                          )}
                          {metadataDetails.webpageUrl && (
                            <p><strong>Video URL:</strong> {metadataDetails.webpageUrl}</p>
                          )}
                          {metadataDetails.thumbnailSourceUrl && (
                            <p><strong>Thumbnail source:</strong> {metadataDetails.thumbnailSourceUrl}</p>
                          )}
                          {metadataDetails.description && (
                            <textarea
                              className={styles.detailsTextarea}
                              readOnly
                              value={metadataDetails.description}
                              aria-label="Video description"
                            />
                          )}
                        </div>
                      )}
                      {step.id === "transcript" && detailsOpen && transcriptDetails && (
                        <div className={styles.detailsPanel}>
                          <p>
                            <strong>Source:</strong>{" "}
                            {transcriptDetails.source === "subtitles"
                              ? "Subtitles"
                              : "Audio transcription"}
                          </p>
                          <textarea
                            className={styles.detailsTextarea}
                            readOnly
                            value={transcriptDetails.transcript}
                            aria-label="Extracted transcript"
                          />
                        </div>
                      )}
                      {step.id === "parsing" && detailsOpen && parsingDetails && (
                        <div className={styles.detailsPanel}>
                          {parsingDetails.ingredientWarnings.length > 0 && (
                            <div className={styles.warningBlock}>
                              <p><strong>Ingredient parser warnings:</strong></p>
                              {parsingDetails.ingredientWarnings.map((warning) => (
                                <p key={warning}>{warning}</p>
                              ))}
                            </div>
                          )}

                          {(recipeFacts.length > 0 || nutritionEntries.length > 0) && (
                            <div className={styles.previewSection}>
                              <p><strong>Recipe details</strong></p>
                              {recipeFacts.length > 0 && (
                                <div className={styles.factGrid}>
                                  {recipeFacts.map((fact) => (
                                    <div key={fact.label} className={styles.factCard}>
                                      <span className={styles.factValue}>{fact.value}</span>
                                      <span className={styles.factLabel}>{fact.label}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {nutritionEntries.length > 0 && (
                                <div className={styles.previewSubsection}>
                                  <p><strong>Nutrition</strong></p>
                                  <div className={styles.factGrid}>
                                    {nutritionEntries.map((entry) => (
                                      <div key={entry.label} className={styles.factCard}>
                                        <span className={styles.factValue}>{entry.value}</span>
                                        <span className={styles.factLabel}>{entry.label}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

                          {previewIngredients.length > 0 && (
                            <div className={styles.previewSection}>
                              <p><strong>Ingredients preview</strong></p>
                              <div className={styles.previewList}>
                                {previewIngredients.map((ingredient, index) => {
                                  const sectionTitle = getSectionTitle(ingredient);
                                  return (
                                    <div
                                      key={`ingredient-preview-${index}`}
                                      className={styles.previewListItem}
                                    >
                                      {sectionTitle && (
                                        <p className={styles.previewSectionTitle}>{sectionTitle}</p>
                                      )}
                                      <p className={styles.previewItemText}>
                                        {formatIngredientPreview(ingredient)}
                                      </p>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {previewInstructions.length > 0 && (
                            <div className={styles.previewSection}>
                              <p><strong>Instructions preview</strong></p>
                              <div className={styles.previewList}>
                                {previewInstructions.map((instruction, index) => {
                                  const sectionTitle = getSectionTitle(instruction);
                                  const instructionText = normalizeEmptyText(instruction.text);
                                  if (!instructionText) return null;

                                  return (
                                    <div
                                      key={`instruction-preview-${index}`}
                                      className={styles.previewListItem}
                                    >
                                      {sectionTitle && (
                                        <p className={styles.previewSectionTitle}>{sectionTitle}</p>
                                      )}
                                      <p className={styles.previewItemLabel}>Step {index + 1}</p>
                                      <p className={styles.previewItemText}>{instructionText}</p>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {showImportPreview && (
                            <>
                              <p><strong>Mealie import preview</strong></p>
                              <p className={styles.previewHint}>
                                This is the JSON payload that will be sent to Mealie when you import.
                              </p>
                              <textarea
                                className={styles.detailsTextarea}
                                readOnly
                                value={JSON.stringify(parsingDetails.importPayload, null, 2)}
                                aria-label="Mealie import payload preview"
                              />
                            </>
                          )}

                          {showDiffView && parsingDiff && (
                            <>
                              <div className={styles.diffSummaryGrid}>
                                {parsingDiff.summary.map((item) => (
                                  <div key={item.label} className={styles.diffSummaryCard}>
                                    <span className={styles.diffSummaryValue}>{item.value}</span>
                                    <span className={styles.diffSummaryLabel}>{item.label}</span>
                                  </div>
                                ))}
                              </div>

                              {parsingDiff.recipeChanges.length > 0 && (
                                <div className={styles.diffSection}>
                                  <p><strong>Recipe-level changes</strong></p>
                                  <div className={styles.diffList}>
                                    {parsingDiff.recipeChanges.map((change) => (
                                      <div key={change.label} className={styles.diffRow}>
                                        <span className={styles.diffLabel}>{change.label}</span>
                                        <span className={styles.diffValues}>
                                          <span className={styles.diffBefore}>{change.before}</span>
                                          <span className={styles.diffArrow} aria-hidden="true">-&gt;</span>
                                          <span className={styles.diffAfter}>{change.after}</span>
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {parsingDiff.ingredientChanges.length > 0 && (
                                <div className={styles.diffSection}>
                                  <p><strong>Ingredient changes</strong></p>
                                  <div className={styles.ingredientDiffList}>
                                    {parsingDiff.ingredientChanges.map((ingredient, ingredientIndex) => (
                                      <div key={`${ingredientIndex}-${ingredient.title}`} className={styles.ingredientDiffCard}>
                                        <p className={styles.ingredientDiffTitle}>{ingredient.title}</p>
                                        <div className={styles.diffList}>
                                          {ingredient.changes.map((change) => (
                                            <div
                                              key={`${ingredient.title}-${change.label}`}
                                              className={styles.diffRow}
                                            >
                                              <span className={styles.diffLabel}>{change.label}</span>
                                              <span className={styles.diffValues}>
                                                <span className={styles.diffBefore}>{change.before}</span>
                                                <span className={styles.diffArrow} aria-hidden="true">-&gt;</span>
                                                <span className={styles.diffAfter}>{change.after}</span>
                                              </span>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </>
                          )}

                          <details className={styles.rawDetails}>
                            <summary className={styles.rawDetailsSummary}>Raw AI recipe JSON</summary>
                            <textarea
                              className={styles.detailsTextarea}
                              readOnly
                              value={JSON.stringify(parsingDetails.parsedRecipe, null, 2)}
                              aria-label="AI parsed recipe JSON"
                            />
                          </details>

                          {showDiffView && (
                            <details className={styles.rawDetails}>
                              <summary className={styles.rawDetailsSummary}>Raw Mealie import payload</summary>
                              <textarea
                                className={styles.detailsTextarea}
                                readOnly
                                value={JSON.stringify(parsingDetails.importPayload, null, 2)}
                              aria-label="Mealie import payload JSON"
                              />
                            </details>
                          )}
                        </div>
                      )}
                    </span>
                  </li>
                );
              })}
            </ol>

            {showManualImportPanel && (
              <div className={styles.manualImportPanel}>
                <p className={styles.manualImportText}>
                  Recipe generated. Review the payload above, then import it into Mealie when ready.
                </p>
                {manualImportError && (
                  <p className={styles.manualImportError}>{manualImportError}</p>
                )}
                <button
                  type="button"
                  className={styles.manualImportButton}
                  onClick={handleManualImport}
                  disabled={isLoading}
                >
                  Import now
                </button>
              </div>
            )}

            {/* Success banner */}
            {phase === "done" && recipeUrl && (
              <div className={styles.successBanner}>
                <p>Recipe imported successfully.</p>
                <a href={recipeUrl} className={styles.link}>
                  Open recipe &rarr;
                </a>
              </div>
            )}

            {/* Error banner */}
            {phase === "error" && (
              <div className={styles.errorBanner}>
                <p className={styles.errorText}>{errorMessage}</p>
                <button className={styles.retryButton} onClick={reset}>
                  Try Again
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

// -------------------------------------------------------------------------
// Icons (inline SVG)
// -------------------------------------------------------------------------

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 0 1 0 1.414l-8 8a1 1 0 0 1-1.414 0l-4-4a1 1 0 0 1 1.414-1.414L8 12.586l7.293-7.293a1 1 0 0 1 1.414 0z" clipRule="evenodd" />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0zm-7 4a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm-1-9a1 1 0 0 0-1 1v4a1 1 0 1 0 2 0V6a1 1 0 0 0-1-1z" clipRule="evenodd" />
    </svg>
  );
}

function IdleIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="10" cy="10" r="7" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg className={styles.spinner} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray="32" strokeDashoffset="12" />
    </svg>
  );
}
