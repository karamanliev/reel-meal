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
    hasSubtitles?: boolean;
    recipeUrl?: string;
    slug?: string;
  };
}

interface StepState {
  status: StepStatus;
  message: string;
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

// -------------------------------------------------------------------------
// Component
// -------------------------------------------------------------------------

export default function App() {
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<"input" | "loading" | "done" | "error">("input");
  const [steps, setSteps] = useState<Record<StepName, StepState>>(DEFAULT_STEPS);
  const [recipeTitle, setRecipeTitle] = useState<string | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [recipeUrl, setRecipeUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
    const es = new EventSource(`/api/parse?url=${encodedUrl}`);
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
        }

        // Final step done
        if (msg.step === "importing" && msg.data?.recipeUrl) {
          setRecipeUrl(msg.data.recipeUrl);
          setPhase("done");
          es.close();

          // Auto-redirect after a short pause so the user can see the success state
          setTimeout(() => {
            window.location.href = msg.data!.recipeUrl!;
          }, 2500);
        }
      } else if (msg.status === "error") {
        // Mark the step that was active when the error occurred
        const failedStep = currentStepRef.current;
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
      setErrorMessage("Connection to server lost. Please try again.");
      setPhase("error");
      es.close();
    };
  };

  const isLoading = phase === "loading";

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
                    </span>
                  </li>
                );
              })}
            </ol>

            {/* Success banner */}
            {phase === "done" && recipeUrl && (
              <div className={styles.successBanner}>
                <p>Recipe imported! Redirecting you to Mealie...</p>
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
