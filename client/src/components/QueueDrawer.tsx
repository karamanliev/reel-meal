import { useEffect, useRef, useState } from "react";
import type { JobState } from "../lib/types";

interface QueueDrawerProps {
  open: boolean;
  onClose: () => void;
  jobs: JobState[];
  selectedJobId: string | null;
  selectJob: (jobId: string) => void;
  cancelJob: (jobId: string) => void;
  removeJob: (jobId: string) => void;
  toggleAutoImport: (jobId: string, value: boolean) => void;
  addJob: (url: string) => void;
}

function JobStatusBadge({ phase }: { phase: JobState["phase"] }) {
  switch (phase) {
    case "queued":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-sun px-2 py-0.5 text-[0.7rem] font-700 uppercase tracking-wider">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-black" />
          Queued
        </span>
      );
    case "loading":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-blue px-2 py-0.5 text-[0.7rem] font-700 uppercase tracking-wider text-white">
          <span className="inline-block h-1.5 w-1.5 animate-spin-slow rounded-full bg-white" />
          Processing
        </span>
      );
    case "review":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-lime px-2 py-0.5 text-[0.7rem] font-700 uppercase tracking-wider">
          Review
        </span>
      );
    case "done":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-lime px-2 py-0.5 text-[0.7rem] font-700 uppercase tracking-wider">
          Done
        </span>
      );
    case "error":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-peach px-2 py-0.5 text-[0.7rem] font-700 uppercase tracking-wider">
          Error
        </span>
      );
    default:
      return null;
  }
}

function trimUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname === "/" ? "" : u.pathname.length > 30 ? u.pathname.slice(0, 27) + "..." : u.pathname;
    return u.hostname + path;
  } catch {
    return url.length > 40 ? url.slice(0, 37) + "..." : url;
  }
}

function QueueItem({
  job,
  isSelected,
  isHighlighted,
  onSelect,
  onCancel,
  onRemove,
  onToggleAutoImport,
}: {
  job: JobState;
  isSelected: boolean;
  isHighlighted: boolean;
  onSelect: () => void;
  onCancel: () => void;
  onRemove: () => void;
  onToggleAutoImport: (value: boolean) => void;
}) {
  const canCancel = job.phase === "queued" || job.phase === "loading" || job.phase === "review";
  const showAutoImportToggle = job.phase === "queued" || job.phase === "loading";
  const isDone = job.phase === "done" || job.phase === "error" || job.phase === "cancelled";
  const title = job.recipeTitle || trimUrl(job.url);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onSelect(); }}
      className={`group w-full cursor-pointer rounded-[12px] border-3 border-solid p-3 text-left transition-colors ${
        isSelected
          ? "border-black bg-white shadow-neo-xs"
          : isHighlighted
            ? "border-black/20 bg-white/90"
            : "border-transparent bg-paper/60 opacity-70 hover:border-black/20 hover:opacity-100"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="h-20 w-20 shrink-0 overflow-hidden rounded-[8px] bg-[#e5e5e5]">
          {job.thumbnailUrl ? (
            <img src={job.thumbnailUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6 text-[#999]">
                <path d="M4 4h16v16H4V4z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" />
                <path d="M4 20l4-4 3 3 5-6 4 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="m-0 text-[0.88rem] leading-snug font-700 text-ink">
            {title}
          </p>
          {job.phase === "queued" && job.position > 0 && (
            <p className="m-0 mt-0.5 text-[0.72rem] font-600 text-[#5b5b5b]">
              Position {job.position} of {job.totalInQueue}
            </p>
          )}
          {job.phase === "loading" && (
            <p className="m-0 mt-0.5 text-[0.72rem] font-600 text-[#5b5b5b]">
              {job.steps.metadata?.message || "Starting..."}
            </p>
          )}
          {job.phase === "error" && job.errorMessage && (
            <p className="m-0 mt-0.5 truncate text-[0.72rem] font-600 text-[#8d1e1e]">
              {job.errorMessage}
            </p>
          )}
          {job.phase === "cancelled" && (
            <p className="m-0 mt-0.5 truncate text-[0.72rem] font-600 text-[#8d1e1e]">
              Job cancelled.
            </p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <JobStatusBadge phase={job.phase} />
            {canCancel && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onCancel();
                }}
                className="rounded-[6px] border-2 border-solid border-[#8d1e1e]/40 px-1.5 py-0.5 text-[0.65rem] font-700 uppercase tracking-wider text-[#8d1e1e]/70 transition-colors hover:border-[#8d1e1e] hover:text-[#8d1e1e]"
              >
                Cancel
              </button>
            )}
            {isDone && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove();
                }}
                className="rounded-[6px] border-2 border-solid border-[#8d1e1e]/40 px-1.5 py-0.5 text-[0.65rem] font-700 uppercase tracking-wider text-[#8d1e1e]/70 transition-colors hover:border-[#8d1e1e] hover:text-[#8d1e1e]"
              >
                Clear
              </button>
            )}
          </div>
          {showAutoImportToggle && (
            <label
              className="mt-1.5 flex items-center gap-1.5"
              onClick={(e) => e.stopPropagation()}
            >
              <input
                type="checkbox"
                checked={job.autoImport}
                onChange={(e) => {
                  e.stopPropagation();
                  onToggleAutoImport(e.target.checked);
                }}
                className="h-3.5 w-3.5 accent-[#171717]"
              />
              <span className="text-[0.68rem] font-600 text-[#5b5b5b] uppercase tracking-wide">
                Auto-import
              </span>
            </label>
          )}
        </div>
      </div>
    </div>
  );
}

export function QueueDrawer({
  open,
  onClose,
  jobs,
  selectedJobId,
  selectJob,
  cancelJob,
  removeJob,
  toggleAutoImport,
  addJob,
}: QueueDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const [urlInput, setUrlInput] = useState("");

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    addJob(trimmed);
    setUrlInput("");
  };

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  const activeJobs = jobs.filter((j) => j.phase === "loading");
  const queuedJobs = jobs.filter((j) => j.phase === "queued");
  const reviewJobs = jobs.filter((j) => j.phase === "review");
  const completedJobs = jobs.filter((j) => j.phase === "done" || j.phase === "error" || j.phase === "cancelled");

  const summaryParts = [
    activeJobs.length > 0 ? `${activeJobs.length} processing` : null,
    reviewJobs.length > 0 ? `${reviewJobs.length} review` : null,
    queuedJobs.length > 0 ? `${queuedJobs.length} queued` : null,
    completedJobs.length > 0 ? `${completedJobs.length} done` : null,
  ].filter(Boolean);
  const summaryText = summaryParts.join(" · ");

  const sortedJobs = [
    ...activeJobs,
    ...reviewJobs,
    ...queuedJobs,
    ...completedJobs,
  ];

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-50 bg-black/40 transition-opacity duration-200 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        ref={drawerRef}
        className={`fixed right-0 top-0 z-50 flex h-full w-full flex-col border-l-4 border-solid border-black bg-paper shadow-neo transition-transform duration-200 ease-out md:w-[520px] ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b-4 border-solid border-black px-4 py-3">
          <div className="min-w-0">
            <h2 className="m-0 text-[0.92rem] font-800 uppercase tracking-wider text-ink">
              Queue
            </h2>
            <p className="m-0 mt-0.5 text-[0.72rem] font-600 text-[#5b5b5b]">
              {jobs.length} {jobs.length === 1 ? "item" : "items"}{summaryText ? ` · ${summaryText}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="neo-btn-secondary ml-2 shrink-0 px-3 py-1.5 text-[0.78rem]"
            aria-label="Close queue drawer"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </div>

        {/* URL input */}
        <form onSubmit={handleAdd} className="border-b-3 border-solid border-black/10 px-3 py-3">
          <div className="flex gap-2">
            <input
              type="url"
              placeholder="Paste a URL to add..."
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              className="neo-input min-h-[42px] flex-1 !text-[0.85rem] !py-2 !px-3"
              required
            />
            <button
              type="submit"
              disabled={!urlInput.trim()}
              className="neo-btn min-h-[42px] bg-sun whitespace-nowrap !text-[0.85rem] hover:bg-[#ffe08f] disabled:opacity-100 disabled:bg-[#e5e5e5] disabled:text-[#5b5b5b] disabled:shadow-neo-pressed"
            >
              Add
            </button>
          </div>
        </form>

        {/* Item list */}
        <div className="flex-1 overflow-y-auto p-3">
          {sortedJobs.length === 0 ? (
            <p className="m-0 text-center text-[0.82rem] font-600 text-[#5b5b5b]">
              Nothing in the queue yet.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
            {sortedJobs.map((job) => (
              <QueueItem
                key={job.id}
                job={job}
                isSelected={selectedJobId === job.id}
                isHighlighted={job.phase === "loading"}
                onSelect={() => selectJob(job.id)}
                onCancel={() => cancelJob(job.id)}
                onRemove={() => removeJob(job.id)}
                onToggleAutoImport={(v) => toggleAutoImport(job.id, v)}
              />
            ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}