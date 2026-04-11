import { useState } from "react";
import type { JobState } from "../lib/types";

interface QueueSidebarProps {
  jobs: JobState[];
  selectedJobId: string | null;
  selectJob: (jobId: string | null) => void;
  cancelJob: (jobId: string) => void;
  removeJob: (jobId: string) => void;
  toggleAutoImport: (jobId: string, value: boolean) => void;
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
  onSelect,
  onCancel,
  onRemove,
  onToggleAutoImport,
}: {
  job: JobState;
  isSelected: boolean;
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
          ? "border-black bg-white shadow-neo"
          : "border-transparent bg-paper hover:border-black/30"
      }`}
    >
      <div className="flex items-start gap-2">
        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-[8px] bg-[#e5e5e5]">
          {job.thumbnailUrl ? (
            <img src={job.thumbnailUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 text-[#999]">
                <path d="M4 4h16v16H4V4z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" />
                <path d="M4 20l4-4 3 3 5-6 4 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="m-0 text-[0.85rem] leading-snug font-700 text-ink">
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
        <div className="flex shrink-0 flex-col items-end gap-1">
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
      </div>
    </div>
  );
}

export function QueueSidebar({
  jobs,
  selectedJobId,
  selectJob,
  cancelJob,
  removeJob,
  toggleAutoImport,
}: QueueSidebarProps) {
  const [isMobileExpanded, setIsMobileExpanded] = useState(false);

  if (jobs.length === 0) return null;

  const activeJobs = jobs.filter((j) => j.phase === "loading" || j.phase === "review");
  const queuedJobs = jobs.filter((j) => j.phase === "queued");
  const completedJobs = jobs.filter((j) => j.phase === "done" || j.phase === "error");
  const totalCount = jobs.length;

  const summaryText = [
    activeJobs.length > 0 ? `${activeJobs.length} processing` : null,
    queuedJobs.length > 0 ? `${queuedJobs.length} queued` : null,
    completedJobs.length > 0 ? `${completedJobs.length} done` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col gap-2 lg:w-72">
        <div className="rounded-[16px] border-4 border-solid border-black bg-paper shadow-neo">
          <div className="border-b-3 border-solid border-black px-3 py-2.5">
            <div className="flex items-center justify-between">
              <h2 className="m-0 text-[0.82rem] font-800 uppercase tracking-wider">
                Queue
              </h2>
              <span className="text-[0.7rem] font-700 text-[#5b5b5b]">{totalCount} items</span>
            </div>
          </div>
          <div className="flex max-h-[70vh] flex-col gap-1.5 overflow-y-auto p-2.5">
            {jobs.map((job) => (
              <QueueItem
                key={job.id}
                job={job}
                isSelected={selectedJobId === job.id}
                onSelect={() => selectJob(job.id)}
                onCancel={() => cancelJob(job.id)}
                onRemove={() => removeJob(job.id)}
                onToggleAutoImport={(v) => toggleAutoImport(job.id, v)}
              />
            ))}
          </div>
        </div>
      </aside>

      {/* Mobile bottom sheet */}
      <div className="md:hidden">
        {/* Collapsed handle bar */}
        {!isMobileExpanded && (
          <div
            className="fixed inset-x-0 bottom-0 z-40 border-t-3 border-solid border-black bg-paper shadow-[0_-4px_0_#171717]"
          >
            <button
              type="button"
              onClick={() => setIsMobileExpanded(true)}
              className="flex w-full items-center justify-between px-4 py-3"
            >
              <span className="text-[0.82rem] font-800 uppercase tracking-wider">
                Queue
              </span>
              <span className="text-[0.75rem] font-700 text-[#5b5b5b]">{summaryText}</span>
            </button>
          </div>
        )}

        {/* Expanded overlay */}
        {isMobileExpanded && (
          <>
            <div
              className="fixed inset-0 z-40 bg-black/40"
              onClick={() => setIsMobileExpanded(false)}
            />
            <div className="fixed inset-x-0 bottom-0 z-50 max-h-[60vh] rounded-t-[16px] border-4 border-solid border-black border-b-0 bg-paper shadow-neo">
              <div className="flex items-center justify-between border-b-3 border-solid border-black px-4 py-3">
                <div className="flex items-center gap-2">
                  <h2 className="m-0 text-[0.82rem] font-800 uppercase tracking-wider">
                    Queue
                  </h2>
                  <span className="text-[0.7rem] font-700 text-[#5b5b5b]">
                    {totalCount} items · {summaryText}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsMobileExpanded(false)}
                  className="neo-btn-secondary px-2 py-1 text-[0.75rem]"
                >
                  Close
                </button>
              </div>
              <div className="flex max-h-[50vh] flex-col gap-1.5 overflow-y-auto p-3">
                {jobs.map((job) => (
                  <QueueItem
                    key={job.id}
                    job={job}
                    isSelected={selectedJobId === job.id}
                    onSelect={() => {
                      selectJob(job.id);
                      setIsMobileExpanded(false);
                    }}
                    onCancel={() => cancelJob(job.id)}
                    onRemove={() => removeJob(job.id)}
                    onToggleAutoImport={(v) => toggleAutoImport(job.id, v)}
                  />
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}