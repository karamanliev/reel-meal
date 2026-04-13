import { useState, useRef, useEffect } from "react";
import eggsAndBaconMascot from "../assets/images/egss_n_bacon.png";
import plusIcon from "../assets/icons/plus.svg?raw";
import playIcon from "../assets/icons/play.svg?raw";
import { Icon } from "./Icon";

interface UrlFormProps {
  url: string;
  setUrl: (url: string) => void;
  translate: boolean;
  setTranslate: (v: boolean) => void;
  extractTranscript: boolean;
  setExtractTranscript: (v: boolean) => void;
  autoImport: boolean;
  setAutoImport: (v: boolean) => void;
  useCustomPrompt: boolean;
  setUseCustomPrompt: (v: boolean) => void;
  customPrompt: string;
  setCustomPrompt: (v: string) => void;
  customPromptMaxLength: number;
  onSubmit: (e: React.FormEvent) => void;
  hasJobs: boolean;
}

function ToggleButton({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label data-checked={checked} className="neo-toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="neo-toggle__track" aria-hidden="true">
        <span className="neo-toggle__thumb" />
      </span>
      <span className="neo-toggle__body">
        <span className="neo-toggle__label">{label}</span>
        <span className="neo-toggle__meta">{checked ? "Enabled" : "Disabled"}</span>
      </span>
    </label>
  );
}

export function UrlForm({
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
  customPromptMaxLength,
  onSubmit,
  hasJobs,
}: UrlFormProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const hasCollapsedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!hasJobs && hasCollapsedRef.current) {
      setIsExpanded(true);
    } else if (hasJobs && !hasCollapsedRef.current) {
      setIsExpanded(false);
      hasCollapsedRef.current = true;
    }
  }, [hasJobs]);

  useEffect(() => {
    if (isExpanded) {
      // Delay focus until after the expand animation completes
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 310);
      return () => clearTimeout(timer);
    }
  }, [isExpanded]);

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    onSubmit(e);
    setIsExpanded(false);
    hasCollapsedRef.current = true;
  };

  const submitLabel = hasJobs
    ? "Add to queue"
    : autoImport
      ? "Import recipe"
      : "Generate recipe";

  const toggleHelpText = hasJobs
    ? "These settings will apply to the next recipe in queue."
    : "Use the toggles to control translation, transcript extraction, custom prompting, and direct import.";

  const formContent = (
    <div className="relative bg-pink px-5 py-5 sm:px-7 sm:py-7 lg:min-h-[520px]">
      <p className="max-w-3xl neo-copy text-ink font-300">
        Paste a YouTube, Instagram, or TikTok link. ReelMeal extracts the
        recipe, normalizes the output, and gets it ready for Mealie.
        Multiple URLs are processed one at a time.
      </p>

      <div className="mt-6 flex max-w-4xl flex-col gap-3 lg:flex-row lg:items-center">
        <input
          ref={inputRef}
          className="neo-input min-h-[58px] flex-1"
          type="url"
          placeholder="https://youtube.com/watch?v=..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
        />
          <button
                  className="neo-btn min-h-[58px] w-full whitespace-nowrap bg-sun text-[1.08rem] hover:bg-[#ffe08f] disabled:opacity-100 disabled:bg-[#e5e5e5] disabled:text-[#5b5b5b] disabled:shadow-neo-pressed lg:w-auto lg:min-w-48"
                  type="submit"
                  disabled={!url.trim()}
                >
                  <Icon src={playIcon} className="h-4 w-4" />
                  {submitLabel}
                </button>
      </div>

      <p className="mt-8 max-w-2xl text-[0.98rem] leading-6 font-300 text-ink">
        {toggleHelpText}
      </p>

      <div className="mt-6 grid md:grid-cols-2 gap-3 max-w-2xl">
        <ToggleButton checked={translate} onChange={setTranslate} label="Translate to English" />
        <ToggleButton checked={useCustomPrompt} onChange={setUseCustomPrompt} label="Use a custom prompt" />
        <ToggleButton checked={extractTranscript} onChange={setExtractTranscript} label="Extract transcript" />
        <ToggleButton checked={autoImport} onChange={setAutoImport} label="Auto-import to Mealie" />
      </div>

      {useCustomPrompt && (
        <div className="mt-7 max-w-xl">
          <div className="flex items-center justify-between gap-3">
            <p className="neo-overline !text-[#fffdfd]">Custom parser instructions</p>
            <span className="text-[0.78rem] font-ui font-700" style={{ color: "#fffdfd" }}>
              {customPrompt.length}/{customPromptMaxLength}
            </span>
          </div>
          <textarea
            className="neo-textarea mt-3 min-h-32"
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            placeholder='Add extra instructions, like "prefer metric units" or "keep steps concise".'
            maxLength={customPromptMaxLength}
            rows={4}
          />
          <p className="m-0 mt-3 text-[0.92rem] font-600 italic opacity-80" style={{ color: "#fffdfd" }}>
            These instructions are appended to the built-in parser prompt.
          </p>
        </div>
      )}

      <img
        src={eggsAndBaconMascot}
        alt=""
        className="pointer-events-none absolute right-[-45px] top-[215px] lg:top-[145px] hidden h-[305px] lg:block lg:h-[375px]"
      />
    </div>
  );

  // Clean slate: no jobs ever — just the form, no toggle header
  if (!hasJobs) {
    return (
      <form className="w-full relative z-10" onSubmit={handleFormSubmit}>
        <div className="overflow-hidden rounded-[24px] border-4 border-solid border-black shadow-neo">
          {formContent}
        </div>
      </form>
    );
  }

  // Has jobs: card with compact header + expandable form content
  return (
    <div className="w-full relative z-10 overflow-hidden rounded-[24px] border-4 border-solid border-black shadow-neo">
      {/* Compact header — always visible, acts as expand/collapse toggle */}
      <button
        type="button"
        onClick={() => setIsExpanded((v) => !v)}
        className="w-full flex items-center gap-3 bg-pink px-5 py-4 sm:px-7 cursor-pointer select-none"
      >
        <Icon src={plusIcon} className="h-7 w-7 sm:h-8 sm:w-8 shrink-0" />
        <div className="text-left min-w-0">
          <p className="m-0 font-display text-[1.1rem] font-800 text-ink sm:text-[1.2rem]">
            Add another recipe
          </p>
          <p className="m-0 text-[0.82rem] font-400 text-ink/70">
            New recipes are queued automatically.
          </p>
        </div>
        {/* Chevron */}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`ml-auto h-5 w-5 shrink-0 text-ink transition-transform duration-300 ${isExpanded ? "rotate-180" : "rotate-0"}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Expandable content via grid trick */}
      <form
        onSubmit={handleFormSubmit}
        className="grid transition-[grid-template-rows] duration-300 ease-in-out"
        style={{ gridTemplateRows: isExpanded ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden min-h-0">
          {formContent}
        </div>
      </form>
    </div>
  );
}