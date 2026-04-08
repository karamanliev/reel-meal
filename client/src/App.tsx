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

function formatDiffValue(value: unknown): string {
  if (value == null) return "null";
  if (typeof value === "string") return value || "empty";
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
  return JSON.stringify(a) === JSON.stringify(b);
}

function buildParsingDiff(details: ParsingDetails): ParsingDiff {
  const parsedRecipe = isRecord(details.parsedRecipe) ? details.parsedRecipe : {};
  const importPayload = isRecord(details.importPayload) ? details.importPayload : {};

  const recipeChanges: DiffEntry[] = [];
  const recipeFields: Array<[key: string, label: string]> = [
    ["recipeServings", "Servings"],
    ["recipeCategory", "Categories"],
    ["tags", "Tags"],
    ["nutrition", "Nutrition"],
    ["orgURL", "Source URL"],
  ];

  for (const [key, label] of recipeFields) {
    const before = parsedRecipe[key];
    const after = importPayload[key];
    if (!sameJson(before, after)) {
      recipeChanges.push({
        label,
        before: formatDiffValue(before),
        after: formatDiffValue(after),
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
  const [url, setUrl] = useState("");
  const [translate, setTranslate] = useState(false);
  const [extractTranscript, setExtractTranscript] = useState(true);
  const [phase, setPhase] = useState<"input" | "loading" | "done" | "error">("input");
  const [steps, setSteps] = useState<Record<StepName, StepState>>(DEFAULT_STEPS);
  const [recipeTitle, setRecipeTitle] = useState<string | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [recipeUrl, setRecipeUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
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
    setPhase("input");
    setSteps(DEFAULT_STEPS);
    currentStepRef.current = "metadata";
    setRecipeTitle(null);
    setThumbnailUrl(null);
    setRecipeUrl(null);
    setErrorMessage(null);
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

    const encodedUrl = encodeURIComponent(videoUrl);
    const es = new EventSource(
      `/api/parse?url=${encodedUrl}&translate=${translate}&extractTranscript=${extractTranscript}`
    );
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
        }

        // Final step done
        if (msg.step === "importing" && msg.data?.recipeUrl) {
          setRecipeUrl(msg.data.recipeUrl);
          setPhase("done");
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
        es.close();
      }
    });

    es.onerror = () => {
      updateStep(currentStepRef.current, {
        status: "error",
        message: "Connection to server lost. Please try again.",
      });
      setErrorMessage("Connection to server lost. Please try again.");
      setPhase("error");
      es.close();
    };
  };

  const isLoading = phase === "loading";
  const parsingDiff = parsingDetails ? buildParsingDiff(parsingDetails) : null;

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
              {isLoading ? "Processing..." : "Import Recipe"}
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
                checked={extractTranscript}
                onChange={(e) => setExtractTranscript(e.target.checked)}
                disabled={isLoading}
              />
              <span>Extract transcript</span>
            </label>
          </div>
        </form>

        {(phase === "loading" || phase === "done" || phase === "error") && (
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
                            <p><strong>Duration:</strong> {Math.round(metadataDetails.duration)}s</p>
                          )}
                          <p><strong>Subtitles available:</strong> {metadataDetails.hasSubtitles ? "Yes" : "No"}</p>
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
                          {parsingDiff && (
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

                          <details className={styles.rawDetails}>
                            <summary className={styles.rawDetailsSummary}>Raw Mealie import payload</summary>
                            <textarea
                              className={styles.detailsTextarea}
                              readOnly
                              value={JSON.stringify(parsingDetails.importPayload, null, 2)}
                              aria-label="Mealie import payload JSON"
                            />
                          </details>
                        </div>
                      )}
                    </span>
                  </li>
                );
              })}
            </ol>

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
