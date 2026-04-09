import { useState, useRef } from "react";
import type {
  StepName,
  StepState,
  Phase,
  SSEEvent,
  MetadataDetails,
  TranscriptDetails,
  ParsingDetails,
} from "../lib/types";
import { DEFAULT_STEPS } from "../lib/types";
import { getIngredients, getInstructions } from "../lib/formatters";
import {
  buildParsingDiff,
  buildRecipeFacts,
  getNutritionEntries,
} from "../lib/recipe-utils";

const CUSTOM_PROMPT_MAX_LENGTH = 400;

function getInitialUrl(): string {
  if (typeof window === "undefined") return "";

  return new URLSearchParams(window.location.search).get("url")?.trim() ?? "";
}

export function useRecipeParser() {
  const [url, setUrl] = useState(getInitialUrl);
  const [translate, setTranslate] = useState(false);
  const [extractTranscript, setExtractTranscript] = useState(true);
  const [autoImport, setAutoImport] = useState(true);
  const [useCustomPrompt, setUseCustomPrompt] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const [phase, setPhase] = useState<Phase>("input");
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
              ? msg.data.ingredientWarnings.filter(
                  (warning): warning is string => typeof warning === "string"
                )
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
        headers: { "Content-Type": "application/json" },
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
      updateStep("importing", { status: "error", message });
      setManualImportError(message);
      setPhase("review");
    }
  };

  const isLoading = phase === "loading";
  const parsingDiff = parsingDetails ? buildParsingDiff(parsingDetails) : null;
  const recipeFacts = parsingDetails ? buildRecipeFacts(parsingDetails) : [];
  const nutritionEntries = parsingDetails
    ? getNutritionEntries(parsingDetails)
    : [];
  const previewIngredients = parsingDetails
    ? getIngredients(parsingDetails.importPayload)
    : [];
  const previewInstructions = parsingDetails
    ? getInstructions(parsingDetails.importPayload)
    : [];
  const showCard =
    phase === "loading" ||
    phase === "review" ||
    phase === "done" ||
    phase === "error";
  const showDiffView = Boolean(recipeUrl);
  const showImportPreview =
    phase === "review" && Boolean(parsingDetails) && !recipeUrl;
  const showManualImportPanel =
    phase === "review" && Boolean(parsingDetails) && !recipeUrl;

  return {
    // Form state
    url,
    setUrl,
    translate,
    setTranslate,
    extractTranscript,
    setExtractTranscript,
    autoImport,
    setAutoImport,
    useCustomPrompt,
    setUseCustomPrompt,
    customPrompt,
    setCustomPrompt,
    customPromptMaxLength: CUSTOM_PROMPT_MAX_LENGTH,

    // Pipeline state
    phase,
    steps,
    isLoading,
    recipeTitle,
    thumbnailUrl,
    recipeUrl,
    errorMessage,
    manualImportError,

    // Details
    metadataDetails,
    transcriptDetails,
    parsingDetails,
    expandedDetails,

    // Derived
    parsingDiff,
    recipeFacts,
    nutritionEntries,
    previewIngredients,
    previewInstructions,
    showCard,
    showDiffView,
    showImportPreview,
    showManualImportPanel,

    // Actions
    handleSubmit,
    handleManualImport,
    toggleDetails,
    reset,
  };
}
