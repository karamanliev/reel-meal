import { useCallback, useEffect, useRef, useState } from "react";
import type { JobState, ParsingDetails, SourceDetails, ExtractedContentDetails, StepEventData, StepName, StepState } from "../lib/types";
import { DEFAULT_STEPS, derivePhase } from "../lib/types";
import { isExactHttpUrl } from "../lib/input";
import { consumeSharedPayload } from "../lib/share-inbox";

const CUSTOM_PROMPT_MAX_LENGTH = 400;

function initialText(): string { if (typeof window === "undefined") return ""; return new URLSearchParams(location.search).get("url")?.trim() ?? ""; }
function fromSnapshot(data: Record<string, unknown>): JobState {
  const steps = structuredClone(DEFAULT_STEPS); const raw = data.steps as Partial<Record<StepName, StepState>> | undefined;
  for (const key of Object.keys(DEFAULT_STEPS) as StepName[]) if (raw?.[key]) steps[key] = raw[key]!;
  const job: JobState = { id: String(data.id), sourceKind: data.sourceKind as JobState["sourceKind"], displayLabel: String(data.displayLabel ?? "Recipe"), resolvedSourceType: (data.resolvedSourceType as JobState["resolvedSourceType"]) ?? null,
    extractTranscript: data.extractTranscript !== false, autoImport: data.autoImport !== false, customPrompt: String(data.customPrompt ?? ""), status: data.status as JobState["status"], addedAt: Number(data.addedAt), steps,
    recipeTitle: data.recipeTitle as string | null, thumbnailUrl: data.thumbnailUrl as string | null, recipeUrl: data.recipeUrl as string | null, errorMessage: data.errorMessage as string | null,
    warnings: Array.isArray(data.warnings) ? data.warnings.filter((value): value is string => typeof value === "string") : [], sourceDetails: data.sourceDetails as SourceDetails | null,
    extractedContentDetails: data.extractedContentDetails as ExtractedContentDetails | null, parsingDetails: data.parsingDetails as ParsingDetails | null, hasRetainedContext: data.hasRetainedContext === true,
    position: Number(data.position ?? 0), totalInQueue: Number(data.totalInQueue ?? 0), phase: "loading", manualImportError: null, expandedDetails: {} };
  job.phase = derivePhase(job); return job;
}

export function useQueue() {
  const [jobs, setJobs] = useState<Map<string, JobState>>(new Map()); const jobsRef = useRef(jobs);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null); const selectedRef = useRef(selectedJobId);
  const [inputText, setInputTextState] = useState(initialText); const [sourceImages, setSourceImagesState] = useState<File[]>([]); const [customImage, setCustomImageState] = useState<File | null>(null);
  const [extractTranscript, setExtractTranscript] = useState(true); const [autoImport, setAutoImport] = useState(true);
  const [useCustomPrompt, setUseCustomPrompt] = useState(false); const [customPrompt, setCustomPrompt] = useState(""); const [useCustomImage, setUseCustomImage] = useState(false);
  const [repromptingJobId, setRepromptingJobId] = useState<string | null>(null); const repromptRef = useRef<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false); const submittingRef = useRef(false); const formRevisionRef = useRef(0);
  const eventBufferRef = useRef<Array<{ event: string; raw: string }>>([]); const snapshotProcessedRef = useRef(false);
  const setInputText = useCallback((value: string) => { formRevisionRef.current++; setInputTextState(value); }, []);
  const setSourceImages = useCallback((value: File[]) => { formRevisionRef.current++; setSourceImagesState(value); }, []);
  const setCustomImage = useCallback((value: File | null) => { formRevisionRef.current++; setCustomImageState(value); }, []);
  useEffect(() => { jobsRef.current = jobs; }, [jobs]);
  useEffect(() => { selectedRef.current = selectedJobId; }, [selectedJobId]);
  const updateJob = useCallback((id: string, patch: Partial<JobState>) => setJobs((previous) => { const current = previous.get(id); if (!current) return previous; const next = new Map(previous); const updated = { ...current, ...patch }; updated.phase = derivePhase(updated); next.set(id, updated); return next; }), []);
  const updateStep = useCallback((id: string, step: StepName, patch: Partial<StepState>) => setJobs((previous) => { const current = previous.get(id); if (!current) return previous; const next = new Map(previous); const updated = { ...current, steps: { ...current.steps, [step]: { ...current.steps[step], ...patch } } }; updated.phase = derivePhase(updated); next.set(id, updated); return next; }), []);
  const removeLocal = useCallback((id: string) => { setJobs((previous) => { const next = new Map(previous); next.delete(id); return next; }); setSelectedJobId((current) => current === id ? null : current); }, []);
  const refresh = useCallback(async () => { const response = await fetch("/api/queue"); if (!response.ok) return; const list = await response.json() as Record<string, unknown>[]; const map = new Map(list.map((item) => { const job = fromSnapshot(item); return [job.id, job] })); setJobs(map); setSelectedJobId((current) => current ?? [...map.values()].at(-1)?.id ?? null); }, []);

  const processEvent = useCallback((event: string, raw: string) => {
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (event === "job-added") { const job = fromSnapshot(data); setJobs((previous) => { const current = previous.get(job.id); const next = new Map(previous); next.set(job.id, current ? { ...current, ...job, expandedDetails: current.expandedDetails, manualImportError: current.manualImportError } : job); return next; }); return; }
    const id = String(data.jobId ?? "");
    if (event === "job-start") updateJob(id, { status: "active" });
    else if (event === "job-position") updateJob(id, { position: Number(data.position), totalInQueue: Number(data.totalInQueue) });
    else if (event === "job-cancelled") updateJob(id, { status: "cancelled", errorMessage: "Job cancelled." });
    else if (event === "job-removed") removeLocal(id);
    else if (event === "job-done") { updateJob(id, { status: "done", recipeUrl: String(data.recipeUrl ?? "") }); setRepromptingJobId(null); repromptRef.current = null; }
    else if (event === "job-review") { updateJob(id, { status: "done" }); setRepromptingJobId(null); repromptRef.current = null; }
    else if (event === "job-error") { updateJob(id, { status: "error", errorMessage: String(data.error ?? "Processing failed.") }); setRepromptingJobId(null); repromptRef.current = null; }
    else if (event === "job-update") void refresh();
    else if (event === "step") {
      const message = data as unknown as StepEventData; updateStep(message.jobId, message.step, { status: message.status, message: message.message ?? message.error ?? "" });
      const detail = message.data ?? {}; const patch: Partial<JobState> = {};
      if (detail.resolvedSourceType) patch.resolvedSourceType = detail.resolvedSourceType as JobState["resolvedSourceType"];
      if (detail.sourceDetails) patch.sourceDetails = detail.sourceDetails as SourceDetails;
      if (detail.extractedContentDetails) patch.extractedContentDetails = detail.extractedContentDetails as ExtractedContentDetails;
      if (detail.parsingDetails) patch.parsingDetails = detail.parsingDetails as ParsingDetails;
      if (detail.recipeTitle) patch.recipeTitle = String(detail.recipeTitle); if (detail.thumbnailUrl) patch.thumbnailUrl = String(detail.thumbnailUrl); if (detail.recipeUrl) patch.recipeUrl = String(detail.recipeUrl);
      if (Array.isArray(detail.warnings)) patch.warnings = detail.warnings.filter((value): value is string => typeof value === "string");
      if (message.error) patch.errorMessage = message.error; if (Object.keys(patch).length) updateJob(message.jobId, patch);
    }
  }, [refresh, removeLocal, updateJob, updateStep]);

  useEffect(() => {
    let active = true;
    fetch("/api/queue").then((response) => response.ok ? response.json() : []).then((list: Record<string, unknown>[]) => {
      if (!active) return;
      const map = new Map(list.map((item) => { const job = fromSnapshot(item); return [job.id, job] }));
      setJobs(map); setSelectedJobId((current) => current ?? [...map.values()].at(-1)?.id ?? null);
      snapshotProcessedRef.current = true;
      for (const buffered of eventBufferRef.current) processEvent(buffered.event, buffered.raw);
      eventBufferRef.current = [];
    }).catch(() => {
      if (!active) return;
      snapshotProcessedRef.current = true;
      for (const buffered of eventBufferRef.current) processEvent(buffered.event, buffered.raw);
      eventBufferRef.current = [];
    });
    return () => { active = false; };
  }, [processEvent]);
  useEffect(() => { const stream = new EventSource("/api/queue/stream"); const names = ["job-added", "job-start", "job-position", "step", "job-done", "job-review", "job-error", "job-cancelled", "job-removed", "job-update"]; const listeners = names.map((name) => { const listener = (event: Event) => { const raw = (event as MessageEvent).data; if (snapshotProcessedRef.current) processEvent(name, raw); else eventBufferRef.current.push({ event: name, raw }); }; stream.addEventListener(name, listener); return [name, listener] as const; }); return () => { for (const [name, listener] of listeners) stream.removeEventListener(name, listener); stream.close(); }; }, [processEvent]);
  useEffect(() => { void consumeSharedPayload().then((shared) => { if (!shared) return; if (shared.files.length) { setInputText(""); setSourceImages(shared.files); } else setInputText(shared.url || shared.text); }); }, [setInputText, setSourceImages]);

  const addJob = useCallback(async () => {
    if (submittingRef.current) return;
    const text = inputText.trim(); const kind = sourceImages.length ? "images" : isExactHttpUrl(text) ? "url" : "text"; if (kind !== "images" && !text) return;
    submittingRef.current = true; setIsSubmitting(true); const submittedRevision = formRevisionRef.current;
    const id = crypto.randomUUID(); const optimistic = fromSnapshot({ id, sourceKind: kind, displayLabel: kind === "images" ? `${sourceImages.length} recipe images` : text.slice(0, 80), extractTranscript, autoImport, customPrompt: useCustomPrompt ? customPrompt.trim() : "", status: "queued", addedAt: Date.now(), steps: DEFAULT_STEPS, warnings: [], hasRetainedContext: false });
    setJobs((previous) => new Map(previous).set(id, optimistic)); if (!selectedRef.current || ["done", "error", "cancelled"].includes(jobsRef.current.get(selectedRef.current)?.phase ?? "done")) setSelectedJobId(id);
    const form = new FormData(); form.set("jobId", id); form.set("kind", kind); form.set("value", text); form.set("extractTranscript", String(extractTranscript)); form.set("autoImport", String(autoImport)); form.set("customPrompt", useCustomPrompt ? customPrompt.trim() : "");
    for (const image of sourceImages) form.append("sourceImages", image); if (useCustomImage && customImage) form.set("customImage", customImage);
    try { const response = await fetch("/api/parse", { method: "POST", body: form }); const data = await response.json().catch(() => ({})) as { error?: string }; if (!response.ok) throw new Error(data.error || "Submission failed."); if (formRevisionRef.current === submittedRevision) { setInputTextState(""); setSourceImagesState([]); setCustomImageState(null); setUseCustomImage(false); } }
    catch (error) { updateJob(id, { status: "error", errorMessage: error instanceof Error ? error.message : String(error) }); }
    finally { submittingRef.current = false; setIsSubmitting(false); }
  }, [inputText, sourceImages, customImage, extractTranscript, autoImport, useCustomPrompt, customPrompt, useCustomImage, updateJob]);
  const handleSubmit = useCallback((event: React.FormEvent) => { event.preventDefault(); void addJob(); }, [addJob]);
  const cancelJob = useCallback(async (id: string) => { try { const response = await fetch(`/api/queue/${id}`, { method: "DELETE" }); if (!response.ok) { const data = await response.json().catch(() => ({})) as { error?: string }; updateJob(id, { errorMessage: data.error ?? "Job could not be cancelled." }); } } catch { updateJob(id, { errorMessage: "Job could not be cancelled." }); } }, [updateJob]);
  const removeJob = useCallback(async (id: string) => { try { const response = await fetch(`/api/queue/${id}`, { method: "DELETE" }); if (response.ok) removeLocal(id); else { const data = await response.json().catch(() => ({})) as { error?: string }; updateJob(id, { errorMessage: data.error ?? "Job could not be removed." }); } } catch { updateJob(id, { errorMessage: "Job could not be removed." }); } }, [removeLocal, updateJob]);
  const toggleDetails = useCallback((id: string, step: StepName) => setJobs((previous) => { const current = previous.get(id); if (!current) return previous; const next = new Map(previous); next.set(id, { ...current, expandedDetails: { ...current.expandedDetails, [step]: !current.expandedDetails[step] } }); return next; }), []);
  const handleManualImport = useCallback(async (id: string) => { updateJob(id, { manualImportError: null }); updateStep(id, "importing", { status: "loading", message: "Importing to Mealie..." }); try { const response = await fetch(`/api/import/${id}`, { method: "POST" }); const data = await response.json().catch(() => ({})) as { error?: string; recipeUrl?: string }; if (!response.ok) throw new Error(data.error ?? "Import failed."); updateJob(id, { recipeUrl: data.recipeUrl ?? null }); } catch (error) { const message = error instanceof Error ? error.message : String(error); updateJob(id, { manualImportError: message }); updateStep(id, "importing", { status: "error", message }); } }, [updateJob, updateStep]);
  const toggleAutoImport = useCallback(async (id: string, value: boolean) => { updateJob(id, { autoImport: value }); try { const response = await fetch(`/api/queue/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ autoImport: value }) }); if (!response.ok) throw new Error(); if (value && jobsRef.current.get(id)?.parsingDetails && !jobsRef.current.get(id)?.recipeUrl) void handleManualImport(id); } catch { updateJob(id, { autoImport: !value, errorMessage: "Auto-import setting could not be updated." }); } }, [handleManualImport, updateJob]);
  const reprompt = useCallback(async (id: string, prompt: string) => { setRepromptingJobId(id); repromptRef.current = id; try { const response = await fetch(`/api/reprompt/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customPrompt: prompt }) }); if (!response.ok) { const data = await response.json().catch(() => ({})) as { error?: string }; throw new Error(data.error ?? "Reprompt failed."); } } catch (error) { updateJob(id, { errorMessage: error instanceof Error ? error.message : String(error) }); setRepromptingJobId(null); repromptRef.current = null; } }, [updateJob]);
  const jobsArray = [...jobs.values()].sort((a, b) => a.addedAt - b.addedAt);
  return { inputText, setInputText, sourceImages, setSourceImages, customImage, setCustomImage, useCustomImage, setUseCustomImage, isSubmitting, extractTranscript, setExtractTranscript, autoImport, setAutoImport, useCustomPrompt, setUseCustomPrompt, customPrompt, setCustomPrompt, customPromptMaxLength: CUSTOM_PROMPT_MAX_LENGTH,
    jobs: jobsArray, selectedJobId, selectJob: setSelectedJobId, hasMultipleJobs: jobsArray.length > 1, handleSubmit, addJob, cancelJob, removeJob, toggleDetails, handleManualImport, toggleAutoImport, reprompt, repromptingJobId, getSelectedJob: () => selectedJobId ? jobs.get(selectedJobId) ?? null : null };
}
