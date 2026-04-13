import { useState, useRef, useCallback, useEffect } from "react";
import type {
  StepName,
  StepState,
  JobState,
  MetadataDetails,
  TranscriptDetails,
  ParsingDetails,
  StepEventData,
} from "../lib/types";
import { DEFAULT_STEPS, derivePhase } from "../lib/types";

const CUSTOM_PROMPT_MAX_LENGTH = 400;

function getInitialUrl(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("url")?.trim() ?? "";
}

function createJobFromSnapshot(data: Record<string, unknown>): JobState {
  const steps: Record<StepName, StepState> = { ...DEFAULT_STEPS };
  const rawSteps = data.steps as Record<string, unknown> | undefined;
  if (rawSteps) {
    for (const key of Object.keys(rawSteps)) {
      if (key in DEFAULT_STEPS) {
        const s = rawSteps[key] as Record<string, unknown>;
        steps[key as StepName] = {
          status: (s.status as StepState["status"]) || "idle",
          message: (s.message as string) || "",
        };
      }
    }
  }

  const job: JobState = {
    id: data.id as string,
    url: data.url as string,
    translate: data.translate as boolean,
    extractTranscript: data.extractTranscript as boolean,
    autoImport: data.autoImport as boolean,
    customPrompt: (data.customPrompt as string) || "",
    status: data.status as JobState["status"],
    addedAt: data.addedAt as number,
    steps,
    recipeTitle: (data.recipeTitle as string) || null,
    thumbnailUrl: (data.thumbnailUrl as string) || null,
    recipeUrl: (data.recipeUrl as string) || null,
    errorMessage: (data.errorMessage as string) || null,
    metadataDetails: data.metadataDetails as MetadataDetails | null,
    transcriptDetails: data.transcriptDetails as TranscriptDetails | null,
    parsingDetails: data.parsingDetails as ParsingDetails | null,
    position: (data.position as number) || 0,
    totalInQueue: (data.totalInQueue as number) || 0,
    phase: "loading",
    manualImportError: null,
    expandedDetails: {},
  };

  job.phase = derivePhase(job);
  return job;
}

export function useQueue() {
  const [jobs, setJobs] = useState<Map<string, JobState>>(new Map());
  const jobsRef = useRef<Map<string, JobState>>(jobs);
  jobsRef.current = jobs;
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const selectedJobIdRef = useRef<string | null>(selectedJobId);
  selectedJobIdRef.current = selectedJobId;
  const eventSourceRef = useRef<EventSource | null>(null);
  const eventBufferRef = useRef<{ event: string; data: string }[]>([]);
  const snapshotProcessedRef = useRef(false);
  const repromptingJobIdRef = useRef<string | null>(null);

const [url, setUrl] = useState(getInitialUrl);
  const [translate, setTranslate] = useState(false);
  const [extractTranscript, setExtractTranscript] = useState(true);
  const [autoImport, setAutoImport] = useState(true);
  const [useCustomPrompt, setUseCustomPrompt] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const [repromptingJobId, setRepromptingJobId] = useState<string | null>(null);

  const updateJob = useCallback(
    (jobId: string, patch: Partial<JobState>) => {
      setJobs((prev) => {
        const next = new Map(prev);
        const job = next.get(jobId);
        if (!job) return prev;
        const updated = { ...job, ...patch };
        updated.phase = derivePhase(updated);
        next.set(jobId, updated);
        return next;
      });
    },
    [],
  );

  const updateJobStep = useCallback(
    (jobId: string, stepName: StepName, patch: Partial<StepState>) => {
      setJobs((prev) => {
        const next = new Map(prev);
        const job = next.get(jobId);
        if (!job) return prev;
        const updated = {
          ...job,
          steps: { ...job.steps, [stepName]: { ...job.steps[stepName], ...patch } },
        };
        updated.phase = derivePhase(updated);
        next.set(jobId, updated);
        return next;
      });
    },
    [],
  );

  const removeJob = useCallback((jobId: string) => {
    setJobs((prev) => {
      const next = new Map(prev);
      next.delete(jobId);
      return next;
    });
    setSelectedJobId((prev) => (prev === jobId ? null : prev));
  }, []);

  const processEvent = useCallback(
    (event: string, dataStr: string) => {
      if (event === "job-added") {
        const data = JSON.parse(dataStr) as Record<string, unknown>;
        const job = createJobFromSnapshot(data);
        setJobs((prev) => {
          const next = new Map(prev);
          if (!next.has(job.id)) {
            next.set(job.id, job);
          }
          return next;
        });
        return;
      }

      if (event === "job-start") {
        const { jobId } = JSON.parse(dataStr) as { jobId: string };
        updateJob(jobId, { status: "active" });
        return;
      }

      if (event === "job-position") {
        const { jobId, position, totalInQueue } = JSON.parse(dataStr) as {
          jobId: string;
          position: number;
          totalInQueue: number;
        };
        updateJob(jobId, { position, totalInQueue });
        return;
      }

      if (event === "step") {
        const msg = JSON.parse(dataStr) as StepEventData;
        const { jobId, step, status, message, data, error } = msg;

        if (status === "idle") {
          updateJobStep(jobId, step, { status: "idle", message: message ?? "" });
          return;
        }

        if (status === "loading") {
          updateJobStep(jobId, step, { status: "loading", message: message ?? "" });
          return;
        }

        if (status === "done") {
          updateJobStep(jobId, step, { status: "done", message: message ?? "" });

          const jobPatch: Partial<JobState> = {};

          if (step === "metadata" && data) {
            if (data.title) jobPatch.recipeTitle = data.title;
            if (data.thumbnailUrl) jobPatch.thumbnailUrl = data.thumbnailUrl;
            if (data.title) {
              jobPatch.metadataDetails = {
                title: data.title,
                uploader: data.uploader,
                duration: data.duration,
                description: data.description,
                webpageUrl: data.webpageUrl,
                thumbnailSourceUrl: data.thumbnailSourceUrl,
                hasSubtitles: data.hasSubtitles,
                subtitleLanguage: data.subtitleLanguage,
              } satisfies MetadataDetails;
            }
          }

          if (
            step === "transcript" &&
            typeof data?.transcript === "string" &&
            (data.source === "subtitles" || data.source === "audio")
          ) {
            jobPatch.transcriptDetails = {
              transcript: data.transcript,
              source: data.source,
            } satisfies TranscriptDetails;
          }

          if (
            step === "parsing" &&
            data?.parsedRecipe !== undefined &&
            data?.importPayload !== undefined
          ) {
            jobPatch.parsingDetails = {
              parsedRecipe: data.parsedRecipe,
              importPayload: data.importPayload,
              ingredientWarnings: Array.isArray(data.ingredientWarnings)
                ? data.ingredientWarnings.filter(
                    (warning): warning is string => typeof warning === "string",
                  )
                : [],
            } satisfies ParsingDetails;
          }

          if (step === "importing" && data?.recipeUrl) {
            jobPatch.recipeUrl = data.recipeUrl;
          }

          if (Object.keys(jobPatch).length > 0) {
            updateJob(jobId, jobPatch);
          }
          return;
        }

        if (status === "error") {
          const failedStep = step ?? "metadata";
          updateJobStep(jobId, failedStep, {
            status: "error",
            message: error ?? "An unexpected error occurred.",
          });
          updateJob(jobId, {
            errorMessage: error ?? "An unexpected error occurred.",
          });
          return;
        }

        return;
      }

      if (event === "job-done") {
        const { jobId, recipeUrl } = JSON.parse(dataStr) as {
          jobId: string;
          recipeUrl: string;
        };
        updateJob(jobId, { status: "done", recipeUrl });
        if (repromptingJobIdRef.current === jobId) {
          setRepromptingJobId(null);
          repromptingJobIdRef.current = null;
        }
        return;
      }

      if (event === "job-review") {
        const { jobId } = JSON.parse(dataStr) as { jobId: string };
        updateJob(jobId, { status: "done" });
        if (repromptingJobIdRef.current === jobId) {
          setRepromptingJobId(null);
          repromptingJobIdRef.current = null;
        }
        return;
      }

      if (event === "job-error") {
        const { jobId, error } = JSON.parse(dataStr) as { jobId: string; error: string };
        updateJob(jobId, { status: "error", errorMessage: error ?? "An unexpected error occurred." });
        if (repromptingJobIdRef.current === jobId) {
          setRepromptingJobId(null);
          repromptingJobIdRef.current = null;
        }
        return;
      }

      if (event === "job-cancelled") {
        const { jobId } = JSON.parse(dataStr) as { jobId: string };
        updateJob(jobId, { status: "cancelled", errorMessage: "Job cancelled." });
        return;
      }

      if (event === "job-removed") {
        const { jobId } = JSON.parse(dataStr) as { jobId: string };
        removeJob(jobId);
        return;
      }

      if (event === "job-update") {
        const jobId = JSON.parse(dataStr) as string;
        fetch("/api/queue")
          .then((r) => r.json())
          .then((snapshot) => {
            const items = snapshot as Record<string, unknown>[];
            const updated = items.find((item) => item.id === jobId);
            if (updated) {
              const freshJob = createJobFromSnapshot(updated);
              setJobs((prev) => {
                const next = new Map(prev);
                next.set(jobId, freshJob);
                return next;
              });
            }
          })
          .catch(() => {});
        return;
      }
    },
    [updateJob, updateJobStep, removeJob],
  );

  useEffect(() => {
    let cancelled = false;

    fetch("/api/queue")
      .then((r) => r.json())
      .then((snapshot) => {
        if (cancelled) return;
        const jobMap = new Map<string, JobState>();
        for (const item of snapshot as Record<string, unknown>[]) {
          const job = createJobFromSnapshot(item);
          jobMap.set(job.id, job);
        }
        setJobs(jobMap);
        snapshotProcessedRef.current = true;

        setSelectedJobId((prev) => {
          if (prev) return prev;
          const jobs = Array.from(jobMap.values()).sort((a, b) => a.addedAt - b.addedAt);
          const activeJob = jobs.find((j) => j.status === "active" || j.status === "queued");
          if (activeJob) return activeJob.id;
          const lastJob = jobs[jobs.length - 1];
          return lastJob?.id ?? null;
        });

        for (const buffered of eventBufferRef.current) {
          processEvent(buffered.event, buffered.data);
        }
        eventBufferRef.current = [];
      })
      .catch(() => {
        snapshotProcessedRef.current = true;
      });

    return () => {
      cancelled = true;
    };
  }, [processEvent]);

  useEffect(() => {
    const es = new EventSource("/api/queue/stream");
    eventSourceRef.current = es;

    const eventNames = [
      "job-added",
      "job-start",
      "job-position",
      "step",
      "job-done",
      "job-review",
      "job-error",
      "job-cancelled",
      "job-removed",
      "job-update",
    ];

    for (const name of eventNames) {
      es.addEventListener(name, (e: MessageEvent) => {
        const data = (e as MessageEvent).data as string;
        if (snapshotProcessedRef.current) {
          processEvent(name, data);
        } else {
          eventBufferRef.current.push({ event: name, data });
        }
      });
    }

    es.onerror = () => {
      // Reconnect is handled automatically by EventSource
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [processEvent]);

  const cancelJob = useCallback(
    async (jobId: string) => {
      try {
        const res = await fetch(`/api/queue/${jobId}`, { method: "DELETE" });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          updateJob(jobId, {
            status: "error",
            errorMessage: data.error || "Could not cancel job.",
          });
        }
      } catch {
        updateJob(jobId, { status: "cancelled", errorMessage: "Job cancelled." });
      }
    },
    [updateJob],
  );

  const removeJobServer = useCallback(
    async (jobId: string) => {
      try {
        await fetch(`/api/queue/${jobId}`, { method: "DELETE" });
      } catch {
        // Ignore error, remove locally anyway
      }
      removeJob(jobId);
    },
    [removeJob],
  );

  const addJob = useCallback(
    (videoUrl: string) => {
      const jobId = crypto.randomUUID();

      const optimisticJob: JobState = {
        id: jobId,
        url: videoUrl,
        translate,
        extractTranscript,
        autoImport,
        customPrompt: useCustomPrompt ? customPrompt.trim() : "",
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
        phase: "queued",
        manualImportError: null,
        expandedDetails: {},
      };

      setJobs((prev) => {
        const next = new Map(prev);
        next.set(jobId, optimisticJob);
        return next;
      });

      const currentJob = selectedJobIdRef.current
        ? jobsRef.current.get(selectedJobIdRef.current)
        : undefined;
      const isFinished = currentJob
        ? currentJob.phase === "done" || currentJob.phase === "error" || currentJob.phase === "cancelled"
        : true;
      if (isFinished) {
        setSelectedJobId(jobId);
      }

      fetch("/api/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: videoUrl,
          translate,
          extractTranscript,
          autoImport,
          customPrompt: useCustomPrompt ? customPrompt.trim() : "",
          jobId,
        }),
      }).catch(() => {
        updateJob(jobId, {
          status: "error",
          errorMessage: "Failed to submit job. Please try again.",
        });
      });

      setUrl("");
    },
    [translate, extractTranscript, autoImport, useCustomPrompt, customPrompt, updateJob],
  );

  const toggleDetails = useCallback(
    (jobId: string, step: StepName) => {
      setJobs((prev) => {
        const next = new Map(prev);
        const job = next.get(jobId);
        if (!job) return prev;
        next.set(jobId, {
          ...job,
          expandedDetails: { ...job.expandedDetails, [step]: !job.expandedDetails[step] },
        });
        return next;
      });
    },
    [],
  );

  const handleManualImport = useCallback(
    async (jobId: string) => {
      const job = jobsRef.current.get(jobId);
      const importPayload = job?.parsingDetails?.importPayload ?? null;
      const ingredientWarnings = job?.parsingDetails?.ingredientWarnings ?? null;
      const thumbnailUrl = job?.metadataDetails?.thumbnailSourceUrl;

      if (!importPayload) return;

      updateJob(jobId, { manualImportError: null });
      updateJobStep(jobId, "importing", {
        status: "loading",
        message: "Importing to Mealie...",
      });

      try {
        const response = await fetch("/api/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobId,
            importPayload,
            ingredientWarnings,
            thumbnailUrl,
          }),
        });

        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
          recipeUrl?: string;
        };

        if (!response.ok || !data.recipeUrl) {
          throw new Error(data.error || "Manual import failed.");
        }

        updateJob(jobId, { recipeUrl: data.recipeUrl });
        updateJobStep(jobId, "importing", {
          status: "done",
          message: "Recipe imported successfully!",
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        updateJob(jobId, { manualImportError: message });
        updateJobStep(jobId, "importing", { status: "error", message });
      }
    },
    [updateJob, updateJobStep],
  );

  const toggleAutoImport = useCallback(
    async (jobId: string, value: boolean) => {
      const job = jobsRef.current.get(jobId);
      const shouldImport = value && job?.parsingDetails && !job?.recipeUrl;

      updateJob(jobId, { autoImport: value });
      try {
        await fetch(`/api/queue/${jobId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ autoImport: value }),
        });
      } catch {
        updateJob(jobId, { autoImport: !value });
        return;
      }
      if (shouldImport) {
        handleManualImport(jobId);
      }
    },
    [updateJob, handleManualImport],
  );

  const reprompt = useCallback(
    async (jobId: string, customPrompt: string) => {
      const job = jobsRef.current.get(jobId);
      if (!job) return;

      const prevParsingStep = { ...job.steps.parsing };
      const prevImportingStep = { ...job.steps.importing };
      const prevCustomPrompt = job.customPrompt;
      const prevParsingDetails = job.parsingDetails;
      const prevRecipeUrl = job.recipeUrl;
      const prevManualImportError = job.manualImportError;

      setRepromptingJobId(jobId);
      repromptingJobIdRef.current = jobId;
      updateJobStep(jobId, "parsing", {
        status: "loading",
        message: "Re-generating recipe with AI...",
      });
      updateJobStep(jobId, "importing", { status: "idle", message: "" });
      updateJob(jobId, {
        customPrompt,
        parsingDetails: null,
        recipeUrl: null,
        errorMessage: null,
        manualImportError: null,
      });

      try {
        const res = await fetch(`/api/reprompt/${jobId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customPrompt }),
        });

        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          updateJobStep(jobId, "parsing", prevParsingStep);
          updateJobStep(jobId, "importing", prevImportingStep);
          updateJob(jobId, {
            customPrompt: prevCustomPrompt,
            parsingDetails: prevParsingDetails,
            recipeUrl: prevRecipeUrl,
            errorMessage: data.error || "Reprompt failed.",
            manualImportError: prevManualImportError,
          });
          setRepromptingJobId(null);
          repromptingJobIdRef.current = null;
        }
      } catch {
        updateJobStep(jobId, "parsing", prevParsingStep);
        updateJobStep(jobId, "importing", prevImportingStep);
        updateJob(jobId, {
          customPrompt: prevCustomPrompt,
          parsingDetails: prevParsingDetails,
          recipeUrl: prevRecipeUrl,
          errorMessage: "Failed to reprompt. Please try again.",
          manualImportError: prevManualImportError,
        });
        setRepromptingJobId(null);
          repromptingJobIdRef.current = null;
      }
    },
    [updateJob, updateJobStep],
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = url.trim();
      if (!trimmed) return;
      addJob(trimmed);
    },
    [url, addJob],
  );

  const jobsArray = Array.from(jobs.values()).sort((a, b) => a.addedAt - b.addedAt);
  const hasMultipleJobs = jobsArray.length > 1;

  const getSelectedJob = useCallback(() => {
    if (!selectedJobId) return null;
    return jobs.get(selectedJobId) ?? null;
  }, [jobs, selectedJobId]);

  return {
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

    jobs: jobsArray,
    selectedJobId,
    selectJob: setSelectedJobId,
    hasMultipleJobs,

    handleSubmit,
    addJob,
    cancelJob,
    removeJob: removeJobServer,
    toggleDetails,
    handleManualImport,
    toggleAutoImport,
    reprompt,
    repromptingJobId,
    getSelectedJob,
  };
}