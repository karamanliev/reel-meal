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
}

const STATUS_COLORS: Record<
  string,
  { icon: string; label: string; message: string }
> = {
  idle: {
    icon: "text-surface-300 dark:text-surface-600",
    label: "text-surface-400 dark:text-surface-500",
    message: "text-surface-400 dark:text-surface-500",
  },
  loading: {
    icon: "text-primary-500",
    label: "text-surface-800 dark:text-surface-200",
    message: "text-surface-500 dark:text-surface-400",
  },
  done: {
    icon: "text-fresh-500",
    label: "text-surface-500 dark:text-surface-400",
    message: "text-surface-400 dark:text-surface-500",
  },
  error: {
    icon: "text-danger-500",
    label: "text-danger-500",
    message: "text-danger-500/80",
  },
};

export function ProgressCard(props: ProgressCardProps) {
  return (
    <div className="card overflow-hidden">
      {/* Recipe preview */}
      {(props.recipeTitle || props.thumbnailUrl) && (
        <div className="relative">
          {props.thumbnailUrl && (
            <img
              className="w-full aspect-video object-cover block"
              src={props.thumbnailUrl}
              alt={props.recipeTitle ?? "Recipe thumbnail"}
            />
          )}
          {props.recipeTitle && (
            <h2 className="absolute bottom-0 left-0 right-0 m-0 px-4 pt-8 pb-3 text-lg font-semibold text-white bg-gradient-to-t from-black/75 to-transparent leading-snug">
              {props.recipeTitle}
            </h2>
          )}
        </div>
      )}

      {/* Step progress list */}
      <ol className="list-none m-0 py-2 px-0">
        {STEPS.map((step) => {
          const state = props.steps[step.id];
          const colors = STATUS_COLORS[state.status];
          const hasDetails =
            (step.id === "metadata" && Boolean(props.metadataDetails)) ||
            (step.id === "transcript" && Boolean(props.transcriptDetails)) ||
            (step.id === "parsing" && Boolean(props.parsingDetails));
          const detailsOpen = Boolean(props.expandedDetails[step.id]);

          return (
            <li key={step.id} className="flex items-start gap-3 px-4 py-2.5">
              <span
                className={`shrink-0 mt-0.5 flex items-center justify-center ${colors.icon}`}
                aria-hidden="true"
              >
                <StatusIcon status={state.status} />
              </span>
              <span className="flex flex-col gap-0.5 flex-1 min-w-0">
                <span className={`text-sm font-medium ${colors.label}`}>
                  {step.label}
                </span>
                {state.message && (
                  <span className={`text-xs ${colors.message}`}>
                    {state.message}
                  </span>
                )}
                {hasDetails && (
                  <button
                    type="button"
                    className="self-start mt-1 px-2 py-0.5 text-xs text-surface-500 dark:text-surface-400 bg-transparent border border-surface-200 dark:border-surface-700 rounded cursor-pointer hover:border-surface-400 dark:hover:border-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors duration-150"
                    onClick={() => props.toggleDetails(step.id)}
                  >
                    {detailsOpen ? "Hide details" : "Show details"}
                  </button>
                )}
                {step.id === "metadata" &&
                  detailsOpen &&
                  props.metadataDetails && (
                    <MetadataDetails details={props.metadataDetails} />
                  )}
                {step.id === "transcript" &&
                  detailsOpen &&
                  props.transcriptDetails && (
                    <TranscriptDetails details={props.transcriptDetails} />
                  )}
                {step.id === "parsing" &&
                  detailsOpen &&
                  props.parsingDetails && (
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
              </span>
            </li>
          );
        })}
      </ol>

      {/* Manual import panel */}
      {props.showManualImportPanel && (
        <div className="px-4 py-3 border-t border-surface-200 dark:border-surface-800 flex items-center justify-between gap-4 flex-wrap bg-fresh-500/4">
          <p className="m-0 text-sm text-surface-600 dark:text-surface-400 flex-1 min-w-65">
            Recipe generated. Review the payload above, then import it into
            Mealie when ready.
          </p>
          {props.manualImportError && (
            <p className="m-0 w-full text-xs text-danger-400">
              {props.manualImportError}
            </p>
          )}
          <button
            type="button"
            className="btn-primary text-sm px-4 py-2"
            onClick={props.handleManualImport}
            disabled={props.isLoading}
          >
            Import now
          </button>
        </div>
      )}

      {/* Success banner */}
      {props.phase === "done" && props.recipeUrl && (
        <div className="px-4 py-3 border-t border-surface-200 dark:border-surface-800 flex items-center justify-between gap-4 flex-wrap bg-fresh-500/7">
          <p className="m-0 text-sm text-fresh-600 dark:text-fresh-400">
            Recipe imported successfully.
          </p>
          <a
            href={props.recipeUrl}
            className="text-sm font-semibold text-fresh-600 dark:text-fresh-400 no-underline px-3 py-1.5 border border-fresh-500 rounded-md hover:bg-fresh-500/15 transition-colors duration-150"
          >
            Open recipe &rarr;
          </a>
        </div>
      )}

      {/* Error banner */}
      {props.phase === "error" && (
        <div className="px-4 py-3 border-t border-surface-200 dark:border-surface-800 flex items-center justify-between gap-4 flex-wrap bg-danger-500/7">
          <p className="m-0 text-sm text-danger-500 flex-1">
            {props.errorMessage}
          </p>
          <button
            className="text-sm font-semibold text-danger-500 bg-transparent border border-danger-500 rounded-md px-3.5 py-1.5 cursor-pointer hover:bg-danger-500/15 transition-colors duration-150"
            onClick={props.reset}
          >
            Try Again
          </button>
        </div>
      )}
    </div>
  );
}
