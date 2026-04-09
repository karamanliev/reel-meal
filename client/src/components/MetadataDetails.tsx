import type { MetadataDetails as MetadataDetailsType } from "../lib/types";
import { formatVideoDuration } from "../lib/formatters";

function MetadataRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <p className="m-0 text-sm leading-6 font-500 text-ink break-anywhere">
      <strong className="font-700 text-[#637044]">{label}:</strong> {children}
    </p>
  );
}

function MetadataLink({ label, href }: { label: string; href: string }) {
  return (
    <p className="m-0 text-sm leading-6 font-500 text-ink min-w-0 flex items-baseline gap-1.5">
      <strong className="font-700 text-[#637044]">{label}:</strong>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        title={href}
        className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-700 underline decoration-2 underline-offset-3 text-danger"
      >
        {href}
      </a>
    </p>
  );
}

export function MetadataDetails({ details }: { details: MetadataDetailsType }) {
  return (
    <div className="mt-4 p-4 sm:p-5">
      <div className="grid gap-2.5">
        <MetadataRow label="Title">{details.title}</MetadataRow>
        {details.uploader && (
          <MetadataRow label="Uploader">{details.uploader}</MetadataRow>
        )}
        {typeof details.duration === "number" && (
          <MetadataRow label="Duration">
            {formatVideoDuration(details.duration)}
          </MetadataRow>
        )}
        <MetadataRow label="Manual same-language subtitles">
          {details.hasSubtitles ? "Yes" : "No"}
        </MetadataRow>
        {details.subtitleLanguage && (
          <MetadataRow label="Subtitle language">
            {details.subtitleLanguage}
          </MetadataRow>
        )}
        {details.webpageUrl && (
          <MetadataLink label="Video URL" href={details.webpageUrl} />
        )}
        {details.thumbnailSourceUrl && (
          <MetadataLink
            label="Thumbnail source"
            href={details.thumbnailSourceUrl}
          />
        )}
      </div>

      {details.description && (
        <div className="mt-4">
          <p className="neo-overline">Video description</p>
          <textarea
            className="neo-textarea mt-3 min-h-36"
            readOnly
            value={details.description}
            aria-label="Video description"
          />
        </div>
      )}
    </div>
  );
}
