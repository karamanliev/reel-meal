import eggsAndBaconMascot from "../assets/images/egss_n_bacon.png";

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
        <span className="neo-toggle__meta">
          {checked ? "Enabled" : "Disabled"}
        </span>
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
}: UrlFormProps) {
  return (
    <form className="w-full animate-bounce-in" onSubmit={onSubmit}>
      <div className="overflow-hidden rounded-[24px] border-4 border-solid border-black shadow-neo">
        <div className="relative bg-pink px-5 py-5 sm:px-7 sm:py-7 lg:min-h-[520px]">
          <p className="max-w-3xl neo-copy text-ink font-300">
            Paste a YouTube, Instagram, or TikTok link. ReelMeal extracts the
            recipe, normalizes the output, and gets it ready for Mealie.
            Multiple URLs are processed one at a time.
          </p>

          <div className="mt-6 flex max-w-4xl flex-col gap-3 lg:flex-row lg:items-center">
            <input
              className="neo-input min-h-[58px] flex-1"
              type="url"
              placeholder="https://youtube.com/watch?v=..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
              autoFocus
            />

            <button
              className="neo-btn min-h-[58px] w-full whitespace-nowrap bg-sun text-[1.08rem] hover:bg-[#ffe08f] disabled:opacity-100 disabled:bg-[#e5e5e5] disabled:text-[#5b5b5b] disabled:shadow-neo-pressed lg:w-auto lg:min-w-48"
              type="submit"
              disabled={!url.trim()}
            >
              {autoImport ? "Import recipe" : "Generate recipe"}
            </button>
          </div>

          <p className="mt-8 max-w-2xl text-[0.98rem] leading-6 font-300 text-ink">
            Use the toggles to control translation, transcript extraction,
            custom prompting, and direct import.
          </p>

          <div className="mt-6 grid md:grid-cols-2 gap-3 max-w-2xl">
            <ToggleButton
              checked={translate}
              onChange={setTranslate}
              label="Translate to English"
            />
            <ToggleButton
              checked={useCustomPrompt}
              onChange={setUseCustomPrompt}
              label="Use a custom prompt"
            />
            <ToggleButton
              checked={extractTranscript}
              onChange={setExtractTranscript}
              label="Extract transcript"
            />
            <ToggleButton
              checked={autoImport}
              onChange={setAutoImport}
              label="Auto-import to Mealie"
            />
          </div>

          {useCustomPrompt && (
            <div className="mt-7 max-w-xl">
              <div className="flex items-center justify-between gap-3">
                <p className="neo-overline !text-[#fffdfd]">
                  Custom parser instructions
                </p>
                <span
                  className="text-[0.78rem] font-ui font-700"
                  style={{ color: "#fffdfd" }}
                >
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

              <p
                className="m-0 mt-3 text-[0.92rem] font-600 italic opacity-80"
                style={{ color: "#fffdfd" }}
              >
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
      </div>
    </form>
  );
}
