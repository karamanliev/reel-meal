import type { TranscriptDetails as TranscriptDetailsType } from "../lib/types";

export function TranscriptDetails({
  details,
}: {
  details: TranscriptDetailsType;
}) {
  return (
    <div className="mt-2 p-3 border border-surface-200 dark:border-surface-700 rounded-lg bg-surface-50 dark:bg-surface-900 grid gap-1.5 w-full">
      <p className="m-0 text-xs text-surface-600 dark:text-surface-400">
        <strong>Source:</strong>{" "}
        {details.source === "subtitles" ? "Subtitles" : "Audio transcription"}
      </p>
      <textarea
        className="w-full min-h-36 resize-y border border-surface-200 dark:border-surface-700 rounded-lg bg-surface-100 dark:bg-surface-800 text-surface-700 dark:text-surface-300 text-xs leading-snug p-2 font-mono block"
        readOnly
        value={details.transcript}
        aria-label="Extracted transcript"
      />
    </div>
  );
}
