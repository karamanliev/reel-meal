import type {
  StepName,
  StepState,
  Phase,
  MetadataDetails as MetadataDetailsType,
  TranscriptDetails as TranscriptDetailsType,
  ParsingDetails as ParsingDetailsType,
  ParsingDiff,
  RecipeFact,
  NutritionEntry,
} from "../lib/types";
import { STEPS } from "../lib/types";
import { StatusIcon } from "./StatusIcon";
import { MetadataDetails } from "./MetadataDetails";
import { TranscriptDetails } from "./TranscriptDetails";
import { ParsingDetails } from "./ParsingDetails";
import burgerAndChipsMascot from "../assets/images/burger_n_chips.png";

interface ProgressCardProps {
  phase: Phase;
  steps: Record<StepName, StepState>;
  isLoading: boolean;
  recipeTitle: string | null;
  thumbnailUrl: string | null;
  recipeUrl: string | null;
  errorMessage: string | null;
  manualImportError: string | null;
  metadataDetails: MetadataDetailsType | null;
  transcriptDetails: TranscriptDetailsType | null;
  parsingDetails: ParsingDetailsType | null;
  expandedDetails: Partial<Record<StepName, boolean>>;
  parsingDiff: ParsingDiff | null;
  recipeFacts: RecipeFact[];
  nutritionEntries: NutritionEntry[];
  previewIngredients: Record<string, unknown>[];
  previewInstructions: Record<string, unknown>[];
  showDiffView: boolean;
  showImportPreview: boolean;
  showManualImportPanel: boolean;
  toggleDetails: (step: StepName) => void;
  handleManualImport: () => void;
  reset: () => void;
  queuePosition?: number;
  queueTotal?: number;
}

const STEP_ACCENT: Record<string, { surface: string; chip: string }> = {
  idle: {
    surface: "bg-paper",
    chip: "bg-sun",
  },
  loading: {
    surface: "bg-blue",
    chip: "bg-white",
  },
  done: {
    surface: "bg-lime",
    chip: "bg-white",
  },
  error: {
    surface: "bg-peach",
    chip: "bg-white",
  },
};

export function ProgressCard(props: ProgressCardProps) {
  if (props.phase === "queued") {
    return (
      <div className="neo-card animate-bounce-in bg-sun p-5 sm:p-6">
        <div className="flex items-center gap-4">
          <div className="neo-card-soft flex h-14 w-14 shrink-0 items-center justify-center bg-white">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              className="h-7 w-7 animate-spin-slow"
            >
              <circle
                cx="12"
                cy="12"
                r="9"
                stroke="#171717"
                strokeOpacity="0.18"
                strokeWidth="3"
              />
              <path
                d="M12 3A9 9 0 0 1 21 12"
                stroke="#171717"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <div>
            <h3 className="m-0 font-display text-[1.3rem] leading-none font-800 tracking-[-0.03em] text-ink">
              Waiting in queue
            </h3>
            {props.queuePosition != null && props.queuePosition > 0 && (
              <p className="mt-1.5 text-[0.9rem] font-600 text-ink">
                Position {props.queuePosition} of {props.queueTotal} · Another
                recipe is being processed
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col gap-5">
      {(props.recipeTitle || props.thumbnailUrl) && (
        <div className="neo-card overflow-hidden animate-bounce-in bg-white">
          {props.thumbnailUrl && (
            <div className="border-b-4 border-solid border-black bg-[#f5f5f5]">
              <img
                className="block h-[320px] w-full object-cover sm:h-[420px]"
                src={props.thumbnailUrl}
                alt={props.recipeTitle ?? "Recipe thumbnail"}
              />
            </div>
          )}

          <div className="p-5 sm:p-6">
            <span className="neo-tag bg-sun">Recipe preview</span>
            {props.recipeTitle && (
              <h2 className="mt-4 font-display text-[1.8rem] leading-[0.96] font-800 tracking-[-0.05em] text-ink sm:text-[2.35rem]">
                {props.recipeTitle}
              </h2>
            )}
            <p className="neo-note mt-3">
              ReelMeal has extracted the title and thumbnail for the selected
              clip.
            </p>
          </div>
        </div>
      )}

      {STEPS.map((step) => {
        const state = props.steps[step.id];
        const accent = STEP_ACCENT[state.status];
        const hasDetails =
          (step.id === "metadata" && Boolean(props.metadataDetails)) ||
          (step.id === "transcript" && Boolean(props.transcriptDetails)) ||
          (step.id === "parsing" && Boolean(props.parsingDetails));
        const detailsOpen = Boolean(props.expandedDetails[step.id]);

        return (
          <div
            key={step.id}
            className={`step-card animate-bounce-in rounded-[18px] border-4 border-solid border-black p-4 shadow-neo sm:p-5 ${accent.surface}`}
          >
            <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-3 sm:gap-x-4 sm:gap-y-2">
              <div className="neo-card-soft flex h-12 w-12 shrink-0 items-center justify-center bg-white">
                <StatusIcon status={state.status} />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`neo-tag ${accent.chip}`}>{step.label}</span>
                </div>

                {state.message && (
                  <p className="mt-3 text-[1.02rem] leading-6 font-600 text-ink break-anywhere">
                    {state.message}
                  </p>
                )}
              </div>

              {hasDetails && (
                <div className="col-span-2 sm:col-span-1 sm:col-start-2 sm:justify-self-end">
                  <button
                    type="button"
                    className="neo-btn-secondary w-full px-4 py-2 text-sm sm:w-auto"
                    onClick={() => props.toggleDetails(step.id)}
                  >
                    {detailsOpen ? "Hide details" : "Show details"}
                  </button>
                </div>
              )}
            </div>

            {step.id === "metadata" && detailsOpen && props.metadataDetails && (
              <MetadataDetails details={props.metadataDetails} />
            )}
            {step.id === "transcript" &&
              detailsOpen &&
              props.transcriptDetails && (
                <TranscriptDetails details={props.transcriptDetails} />
              )}
            {step.id === "parsing" && detailsOpen && props.parsingDetails && (
              <ParsingDetails
                details={props.parsingDetails}
                parsingDiff={props.parsingDiff}
                recipeFacts={props.recipeFacts}
                nutritionEntries={props.nutritionEntries}
                previewIngredients={props.previewIngredients}
                previewInstructions={props.previewInstructions}
                showDiffView={props.showDiffView}
                showImportPreview={props.showImportPreview}
              />
            )}
          </div>
        );
      })}

      {props.showManualImportPanel && (
        <div className="neo-card animate-bounce-in bg-blue p-4 sm:p-5">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="min-w-0 flex-1">
              <span className="neo-tag bg-white">Manual import</span>
              <p className="mt-3 text-[1rem] leading-6 font-600 text-ink">
                Recipe generated. Review the payload above, then send it to
                Mealie when you are ready.
              </p>
              {props.manualImportError && (
                <p className="mt-2 text-sm font-700 text-[#8d1e1e]">
                  {props.manualImportError}
                </p>
              )}
            </div>

            <button
              type="button"
              className="neo-btn min-h-[52px] w-full whitespace-nowrap bg-sun text-[1.08rem] hover:bg-[#ffe08f] disabled:opacity-100 disabled:bg-[#e5e5e5] disabled:text-[#5b5b5b] disabled:shadow-neo-pressed xl:w-auto xl:min-w-48"
              onClick={props.handleManualImport}
              disabled={props.isLoading}
            >
              Import now
            </button>
          </div>
        </div>
      )}

      {props.phase === "done" && props.recipeUrl && (
        <div className="neo-card animate-bounce-in bg-lime p-6 sm:p-7">
          <div className="grid grid-cols-1 gap-4 sm:gap-5 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center">
            <div className="w-full md:w-auto">
              <img
                src={burgerAndChipsMascot}
                alt=""
                className="pointer-events-none mx-auto h-32 w-auto object-contain sm:h-40 md:mx-0"
              />
            </div>

            <div className="w-full min-w-0">
              <span className="neo-tag bg-white">Success</span>
              <p className="mt-3 font-display text-[1.6rem] leading-none font-800 tracking-[-0.05em] text-ink sm:text-[1.9rem]">
                Recipe imported successfully.
              </p>
            </div>

            <a
              href={props.recipeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="neo-btn-secondary w-full justify-center no-underline md:w-auto"
            >
              Open recipe
            </a>
          </div>
        </div>
      )}

      {props.phase === "cancelled" && (
        <div className="neo-card animate-bounce-in bg-paper p-4 sm:p-5">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="min-w-0 flex-1">
              <span className="neo-tag bg-sun">Cancelled</span>
              <p className="mt-3 text-[1rem] leading-6 font-600 text-ink">
                Job cancelled.
              </p>
            </div>
            <button className="neo-btn-primary" onClick={props.reset}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      {props.phase === "error" && (
        <div className="neo-card animate-bounce-in bg-peach p-4 sm:p-5">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="min-w-0 flex-1">
              <span className="neo-tag bg-white">Something broke</span>
              <p className="mt-3 text-[1rem] leading-6 font-600 text-ink">
                {props.errorMessage}
              </p>
            </div>
            <button className="neo-btn-primary" onClick={props.reset}>
              Try again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
