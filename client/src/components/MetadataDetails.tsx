import type { MetadataDetails as MetadataDetailsType } from "../lib/types";
import { formatVideoDuration } from "../lib/formatters";

export function MetadataDetails({
  details,
}: {
  details: MetadataDetailsType;
}) {
  return (
    <div className="mt-2 p-3 border border-surface-200 dark:border-surface-700 rounded-lg bg-surface-50 dark:bg-surface-900 grid gap-1.5 w-full">
      <p className="m-0 text-xs text-surface-600 dark:text-surface-400 break-anywhere">
        <strong>Title:</strong> {details.title}
      </p>
      {details.uploader && (
        <p className="m-0 text-xs text-surface-600 dark:text-surface-400">
          <strong>Uploader:</strong> {details.uploader}
        </p>
      )}
      {typeof details.duration === "number" && (
        <p className="m-0 text-xs text-surface-600 dark:text-surface-400">
          <strong>Duration:</strong> {formatVideoDuration(details.duration)}
        </p>
      )}
      <p className="m-0 text-xs text-surface-600 dark:text-surface-400">
        <strong>Manual same-language subtitles:</strong>{" "}
        {details.hasSubtitles ? "Yes" : "No"}
      </p>
      {details.subtitleLanguage && (
        <p className="m-0 text-xs text-surface-600 dark:text-surface-400">
          <strong>Subtitle language:</strong> {details.subtitleLanguage}
        </p>
      )}
      {details.webpageUrl && (
        <p className="m-0 text-xs text-surface-600 dark:text-surface-400">
          <strong>Video URL:</strong> {details.webpageUrl}
        </p>
      )}
      {details.thumbnailSourceUrl && (
        <p className="m-0 text-xs text-surface-600 dark:text-surface-400">
          <strong>Thumbnail source:</strong> {details.thumbnailSourceUrl}
        </p>
      )}
      {details.description && (
        <textarea
          className="w-full min-h-36 resize-y border border-surface-200 dark:border-surface-700 rounded-lg bg-surface-100 dark:bg-surface-800 text-surface-700 dark:text-surface-300 text-xs leading-snug p-2 font-mono block"
          readOnly
          value={details.description}
          aria-label="Video description"
        />
      )}
    </div>
  );
}
