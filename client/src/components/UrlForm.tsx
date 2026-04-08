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
  isLoading: boolean;
  onSubmit: (e: React.FormEvent) => void;
}

function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <label className="inline-flex items-center gap-2 text-sm text-surface-500 dark:text-surface-400 cursor-pointer select-none py-0.5 has-[input:disabled]:opacity-40 has-[input:disabled]:cursor-not-allowed">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="appearance-none w-4 h-4 border border-surface-300 dark:border-surface-600 rounded bg-surface-100 dark:bg-surface-800 cursor-pointer shrink-0 transition-colors duration-150 checked:bg-primary-500 checked:border-primary-500 relative checked:after:content-[''] checked:after:absolute checked:after:top-[1px] checked:after:left-[4px] checked:after:w-[4px] checked:after:h-[7px] checked:after:border-2 checked:after:border-white checked:after:border-t-0 checked:after:border-l-0 checked:after:rotate-45 disabled:opacity-40 disabled:cursor-not-allowed"
      />
      <span>{label}</span>
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
  isLoading,
  onSubmit,
}: UrlFormProps) {
  return (
    <form className="w-full" onSubmit={onSubmit}>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          className="input-field flex-1"
          type="url"
          placeholder="Paste a YouTube or Instagram video URL..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={isLoading}
          required
          autoFocus
        />
        <button
          className="btn-primary w-full sm:w-auto whitespace-nowrap"
          type="submit"
          disabled={isLoading || !url.trim()}
        >
          {isLoading
            ? "Processing..."
            : autoImport
              ? "Import Recipe"
              : "Generate Recipe"}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mt-3">
        <Toggle
          checked={translate}
          onChange={setTranslate}
          disabled={isLoading}
          label="Translate to English"
        />
        <Toggle
          checked={useCustomPrompt}
          onChange={setUseCustomPrompt}
          disabled={isLoading}
          label="Custom prompt"
        />
        <Toggle
          checked={extractTranscript}
          onChange={setExtractTranscript}
          disabled={isLoading}
          label="Extract transcript"
        />
        <Toggle
          checked={autoImport}
          onChange={setAutoImport}
          disabled={isLoading}
          label="Auto import"
        />
      </div>

      {useCustomPrompt && (
        <div className="mt-3">
          <textarea
            className="input-field min-h-26 resize-y font-inherit leading-relaxed"
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            placeholder='Add extra instructions for the parser. Example: "Prefer metric units" or "Keep steps extra concise".'
            disabled={isLoading}
            maxLength={customPromptMaxLength}
            rows={4}
          />
          <div className="mt-1 text-xs text-surface-400 dark:text-surface-500">
            Extra instructions are added on top of the built-in parser prompt.
            Keep it short.
          </div>
        </div>
      )}
    </form>
  );
}
