import { useCallback, useEffect, useRef, useState } from "react";
import {
  ACCEPTED_IMAGE_TYPES,
  isExactHttpUrl,
  validateSourceFiles,
} from "../lib/input";
import eggsAndBaconMascot from "../assets/images/egss_n_bacon.png";
import playIcon from "../assets/icons/play.svg?raw";
import { Icon } from "./Icon";

interface Props {
  inputText: string;
  setInputText: (value: string) => void;
  sourceImages: File[];
  setSourceImages: (files: File[]) => void;
  customImage: File | null;
  setCustomImage: (file: File | null) => void;
  customImageUrl: string;
  setCustomImageUrl: (value: string) => void;
  useCustomImage: boolean;
  setUseCustomImage: (value: boolean) => void;
  extractTranscript: boolean;
  setExtractTranscript: (value: boolean) => void;
  autoImport: boolean;
  setAutoImport: (value: boolean) => void;
  useCustomPrompt: boolean;
  setUseCustomPrompt: (value: boolean) => void;
  customPrompt: string;
  setCustomPrompt: (value: string) => void;
  customPromptMaxLength: number;
  onSubmit: (event: React.FormEvent) => void;
  hasJobs: boolean;
  isSubmitting: boolean;
}

interface CoverUrlValidation {
  url: string;
  status: "checking" | "valid" | "invalid";
  error?: string;
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <label data-checked={checked} className="neo-toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="neo-toggle__track" aria-hidden="true">
        <span className="neo-toggle__thumb" />
      </span>
      <span className="neo-toggle__body">
        <span className="neo-toggle__label">{label}</span>
        <span className="neo-toggle__meta">
          {checked ? "Enabled" : "Disabled"}
        </span>
      </span>
    </label>
  );
}

function Preview({
  file,
  onRemove,
  label,
}: {
  file: File;
  onRemove: () => void;
  label: string;
}) {
  const urlRef = useRef("");
  const attachPreview = useCallback((node: HTMLImageElement | null) => {
    if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = ""; }
    if (node) { const next = URL.createObjectURL(file); urlRef.current = next; node.src = next; }
  }, [file]);

  return (
    <div className="relative overflow-hidden rounded-xl border-3 border-black bg-white">
      <img ref={attachPreview} alt={label} className="h-28 w-full object-cover" />
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label}`}
        className="absolute right-1.5 top-1.5 inline-flex h-7 w-7 items-center justify-center rounded-[6px] border-2 border-solid border-[#8d1e1e]/50 bg-white text-lg font-800 leading-none text-[#8d1e1e] transition-colors hover:border-[#8d1e1e] hover:bg-[#fde8e8]"
      >
        <span aria-hidden="true">×</span>
      </button>
      <p className="m-0 truncate px-2 py-1 text-xs font-700">{file.name}</p>
    </div>
  );
}

export function UrlForm(props: Props) {
  const [expanded, setExpanded] = useState(!props.hasJobs);
  const [error, setError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [coverDragActive, setCoverDragActive] = useState(false);
  const [coverUrlValidation, setCoverUrlValidation] = useState<CoverUrlValidation | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const sourceInput = useRef<HTMLInputElement>(null);
  const customInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!props.hasJobs || expanded) {
      const timer = setTimeout(
        () => textarea.current?.focus(),
        props.hasJobs ? 310 : 0,
      );
      return () => clearTimeout(timer);
    }
  }, [props.hasJobs, expanded]);

  const trimmedCoverUrl = props.customImageUrl.trim();
  const coverUrlHasValidSyntax = isExactHttpUrl(trimmedCoverUrl);

  useEffect(() => {
    if (!props.useCustomImage || props.customImage || !coverUrlHasValidSyntax) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setCoverUrlValidation({ url: trimmedCoverUrl, status: "checking" });
      void fetch("/api/image-url/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmedCoverUrl }),
        signal: controller.signal,
      }).then(async (response) => {
        const result = await response.json().catch(() => ({})) as { valid?: boolean; error?: string };
        if (response.ok && result.valid) setCoverUrlValidation({ url: trimmedCoverUrl, status: "valid" });
        else setCoverUrlValidation({ url: trimmedCoverUrl, status: "invalid", error: result.error || "This URL is not a supported image." });
      }).catch((requestError: unknown) => {
        if (requestError instanceof Error && requestError.name === "AbortError") return;
        setCoverUrlValidation({ url: trimmedCoverUrl, status: "invalid", error: "Image URL could not be checked." });
      });
    }, 400);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [coverUrlHasValidSyntax, props.customImage, props.useCustomImage, trimmedCoverUrl]);

  const detectedUrl = isExactHttpUrl(props.inputText);
  const hasSource = Boolean(props.inputText.trim() || props.sourceImages.length);
  const validationError = props.sourceImages.length
    ? validateSourceFiles(props.sourceImages)
    : props.inputText.length > 100_000
      ? "Text must be 100,000 characters or fewer."
      : "";
  const activeCoverUrlValidation = coverUrlValidation?.url === trimmedCoverUrl ? coverUrlValidation : null;
  const coverUrlIsValid = Boolean(props.useCustomImage && trimmedCoverUrl && coverUrlHasValidSyntax && activeCoverUrlValidation?.status === "valid");
  const coverUrlIsChecking = Boolean(props.useCustomImage && trimmedCoverUrl && coverUrlHasValidSyntax && activeCoverUrlValidation?.status !== "valid" && activeCoverUrlValidation?.status !== "invalid");
  const coverUrlError = props.useCustomImage && trimmedCoverUrl && !coverUrlHasValidSyntax
    ? "Custom cover must be one complete HTTP or HTTPS image URL."
    : props.useCustomImage && activeCoverUrlValidation?.status === "invalid"
      ? activeCoverUrlValidation.error || "This URL is not a supported image."
      : "";
  const displayedError = error || validationError;
  const hasValidationError = Boolean(displayedError || coverUrlError);
  const hasDetectedCustomImage = Boolean(props.customImage) || coverUrlIsValid;

  const addSourceFiles = (incoming: File[]) => {
    if (!incoming.length) return;
    if (
      props.inputText.trim() &&
      !window.confirm("Replace the current text or URL with image files?")
    ) {
      return;
    }

    const combined = props.inputText.trim()
      ? incoming
      : [...props.sourceImages, ...incoming];
    const validation = validateSourceFiles(combined);
    if (validation) {
      setError(validation);
      return;
    }

    props.setInputText("");
    props.setSourceImages(combined);
    setError("");
  };

  const changeText = (value: string) => {
    if (
      value.trim() &&
      props.sourceImages.length &&
      !window.confirm("Replace the current image source with text or a URL?")
    ) {
      return;
    }
    if (value.trim()) props.setSourceImages([]);
    props.setInputText(value);
    setError(
      value.length > 100_000
        ? "Text must be 100,000 characters or fewer."
        : "",
    );
  };

  const chooseCustom = (file: File | null) => {
    if (
      file &&
      (!ACCEPTED_IMAGE_TYPES.includes(file.type) ||
        file.size > 10 * 1024 * 1024)
    ) {
      setError(
        "Custom image must be JPEG, PNG, WebP, or GIF and no larger than 10 MB.",
      );
      return;
    }
    setCoverUrlValidation(null);
    props.setCustomImage(file);
    if (file) props.setCustomImageUrl("");
    setError("");
  };

  const removeCustomImage = () => {
    setCoverUrlValidation(null);
    props.setCustomImage(null);
    props.setCustomImageUrl("");
  };

  const content = (
    <div className="relative bg-pink px-4 py-4 sm:px-7 sm:py-7 lg:min-h-[540px]">
      <div className="relative z-10 max-w-3xl">
        <p className="neo-copy font-300 text-ink">
          Paste one video or recipe-page URL, paste complete recipe text, or
          add up to 10 recipe images. Shared content is always shown here for
          review before submission.
        </p>
      </div>

      <img
        src={eggsAndBaconMascot}
        alt=""
        className="pointer-events-none absolute bottom-0 right-[-20px] hidden h-[300px] w-auto object-contain object-bottom lg:block xl:h-[325px]"
      />

      <div
        className={`smart-source-shell relative z-10 mt-4 sm:mt-5 ${dragActive ? "smart-source-shell--dragging" : ""}`}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) {
            setDragActive(false);
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragActive(false);
          addSourceFiles([...event.dataTransfer.files]);
        }}
      >
        <textarea
          ref={textarea}
          rows={1}
          className="neo-textarea smart-source-textarea"
          value={props.inputText}
          onChange={(event) => changeText(event.target.value)}
          onPaste={(event) => {
            const images = [...event.clipboardData.files].filter((file) =>
              file.type.startsWith("image/"),
            );
            if (images.length) {
              event.preventDefault();
              addSourceFiles(images);
            }
          }}
          placeholder="Paste a link, image, or text..."
          aria-label="Recipe URL or pasted text"
        />
        <div className="smart-source-toolbar">
          <div className="smart-source-actions">
            <button
              type="button"
              className="neo-btn-secondary smart-source-picker"
              onClick={() => sourceInput.current?.click()}
            >
              <span className="smart-source-picker__content">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  className="h-4 w-4"
                  aria-hidden="true"
                >
                  <path d="M12 5v14M5 12h14" strokeLinecap="round" />
                </svg>
                <span>Add images</span>
              </span>
            </button>
          </div>
          <button
            type="submit"
             disabled={!hasSource || hasValidationError || coverUrlIsChecking || props.isSubmitting}
            className="neo-btn smart-submit-button bg-sun disabled:bg-[#ddd]"
          >
            <Icon src={playIcon} className="h-4 w-4" />
            {props.isSubmitting
              ? "Submitting..."
              : props.hasJobs
              ? "Add to queue"
              : props.autoImport
                ? "Import recipe"
                : "Generate recipe"}
          </button>
        </div>
        <input
          ref={sourceInput}
          type="file"
          className="sr-only"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          onChange={(event) => {
            addSourceFiles([...(event.target.files ?? [])]);
            event.target.value = "";
          }}
        />
      </div>
      <p className="relative z-10 mt-2 text-xs font-600 italic text-ink/50">
        Drop or paste images, or use Add images. JPEG, PNG, WebP, or GIF; up to
        10 files, 10 MB each, 50 MB total.
      </p>

      {props.sourceImages.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
          {props.sourceImages.map((file, index) => (
            <Preview
              key={`${file.name}-${file.lastModified}-${index}`}
              file={file}
              label={`source image ${index + 1}`}
              onRemove={() => {
                setError("");
                props.setSourceImages(
                  props.sourceImages.filter((_, item) => item !== index),
                );
              }}
            />
          ))}
        </div>
      )}

      {displayedError && (
        <p className="mt-3 font-700 text-[#7b1111]" role="alert">
          {displayedError}
        </p>
      )}

      <div className="relative z-10 mt-6 max-w-2xl sm:mt-8">
        <div className="grid gap-2.5 sm:gap-3 md:grid-cols-2">
          <Toggle
            checked={props.useCustomPrompt}
            onChange={props.setUseCustomPrompt}
            label="Use a custom prompt"
          />
          <Toggle
            checked={props.useCustomImage}
            onChange={props.setUseCustomImage}
            label="Use a custom cover"
          />
          {detectedUrl && (
            <Toggle
              checked={props.extractTranscript}
              onChange={props.setExtractTranscript}
              label="Extract video transcript"
            />
          )}
          <Toggle
            checked={props.autoImport}
            onChange={props.setAutoImport}
            label="Auto-import to Mealie"
          />
        </div>
      </div>

      {props.useCustomPrompt && (
        <div className="relative z-10 mt-4 max-w-xl sm:mt-5">
          <div className="flex justify-between">
            <p className="neo-overline !text-white">
              Custom parser instructions
            </p>
            <span className="font-700 text-white">
              {props.customPrompt.length}/{props.customPromptMaxLength}
            </span>
          </div>
          <textarea
            className="neo-textarea mt-2 min-h-28"
            value={props.customPrompt}
            onChange={(event) => props.setCustomPrompt(event.target.value)}
            maxLength={props.customPromptMaxLength}
            placeholder="Prefer metric units, keep steps concise, translate to bulgarian..."
          />
        </div>
      )}

      {props.useCustomImage && (
        <div className="relative z-10 mt-4 max-w-xl sm:mt-5">
          <p className="neo-overline !text-white">Custom recipe cover</p>
          <div
            className={`smart-source-shell cover-source-shell mt-2 ${coverDragActive ? "smart-source-shell--dragging" : ""}`}
            onDragEnter={(event) => { event.preventDefault(); setCoverDragActive(true); }}
            onDragOver={(event) => { event.preventDefault(); setCoverDragActive(true); }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node)) setCoverDragActive(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setCoverDragActive(false);
              const image = [...event.dataTransfer.files].find((file) => file.type.startsWith("image/"));
              if (image) chooseCustom(image);
              else setError("Drop a JPEG, PNG, WebP, or GIF custom cover.");
            }}
          >
            <div className="cover-source-input-row">
              <input
                className="cover-source-input"
                value={props.customImage ? props.customImage.name : props.customImageUrl}
                disabled={hasDetectedCustomImage}
                onChange={(event) => {
                  setCoverUrlValidation(null);
                  if (props.customImage) props.setCustomImage(null);
                  props.setCustomImageUrl(event.target.value);
                  setError("");
                }}
                onPaste={(event) => {
                  const image = [...event.clipboardData.files].find((file) => file.type.startsWith("image/"));
                  if (image) { event.preventDefault(); chooseCustom(image); }
                }}
                placeholder="Paste a direct image URL..."
                aria-label="Custom cover URL or pasted image"
              />
              {hasDetectedCustomImage && (
                <button type="button" className="cover-source-remove" onClick={removeCustomImage}>
                  Clear
                </button>
              )}
            </div>
            <div className="cover-source-file-option">
              <span className="cover-source-file-label">or</span>
              <button
                type="button"
                className="neo-btn-secondary cover-source-file-picker"
                onClick={() => customInput.current?.click()}
              >
                <span className="smart-source-picker__content">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true">
                    <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M5 14v5h14v-5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span>Browse files</span>
                </span>
              </button>
              <span className="cover-source-file-label">from your device</span>
            </div>
          </div>
          <p className="cover-source-hint">
            {coverUrlIsChecking ? "Checking image URL..." : "Paste a direct URL above, or drop or paste one image. JPEG, PNG, WebP, or GIF; maximum 10 MB."}
          </p>
          <input
            ref={customInput}
            type="file"
            className="sr-only"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={(event) => {
              chooseCustom(event.target.files?.[0] ?? null);
              event.target.value = "";
            }}
          />
          {coverUrlError && (
            <p className="mt-2 font-700 text-[#7b1111]" role="alert">
              {coverUrlError}
            </p>
          )}
        </div>
      )}

    </div>
  );

  const submit = (event: React.FormEvent) => {
    props.onSubmit(event);
    if (hasSource && !hasValidationError && !coverUrlIsChecking) setExpanded(false);
  };

  if (!props.hasJobs) {
    return (
      <form
        className="relative z-10 w-full overflow-hidden rounded-[20px] border-3 border-solid border-black shadow-neo-sm sm:rounded-[24px] sm:border-4 sm:shadow-neo"
        onSubmit={submit}
      >
        {content}
      </form>
    );
  }

  return (
    <div className="relative z-10 w-full overflow-hidden rounded-[20px] border-3 border-solid border-black shadow-neo-sm sm:rounded-[24px] sm:border-4 sm:shadow-neo">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center bg-pink px-4 py-3 text-left font-display text-lg font-800 sm:px-6 sm:py-4 sm:text-xl"
        aria-expanded={expanded}
        aria-controls="add-recipe-form"
      >
        Add another recipe
        <span className="ml-auto">{expanded ? "−" : "+"}</span>
      </button>
      <form
        id="add-recipe-form"
        onSubmit={submit}
        className="grid transition-[grid-template-rows] duration-300"
        style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}
        aria-hidden={!expanded}
        inert={!expanded}
      >
        <div className="min-h-0 overflow-hidden">{content}</div>
      </form>
    </div>
  );
}
