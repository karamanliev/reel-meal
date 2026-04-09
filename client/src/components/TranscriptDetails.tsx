import type { TranscriptDetails as TranscriptDetailsType } from "../lib/types";

export function TranscriptDetails({
  details,
}: {
  details: TranscriptDetailsType;
}) {
  return (
    <div className="mt-4 p-4 sm:p-5">
      <p className="m-0 text-sm leading-6 font-500 text-ink">
        <strong className="font-700 text-[#637044]">Source:</strong>{" "}
        {details.source === "subtitles" ? "Subtitles" : "Audio transcription"}
      </p>

      <textarea
        className="neo-textarea mt-4 min-h-42"
        readOnly
        value={details.transcript}
        aria-label="Extracted transcript"
      />
    </div>
  );
}
