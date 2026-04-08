import type {
  ParsingDetails as ParsingDetailsType,
  ParsingDiff,
  RecipeFact,
  NutritionEntry,
} from "../lib/types";
import {
  normalizeEmptyText,
  getSectionTitle,
  formatIngredientPreview,
} from "../lib/formatters";

interface ParsingDetailsProps {
  details: ParsingDetailsType;
  parsingDiff: ParsingDiff | null;
  recipeFacts: RecipeFact[];
  nutritionEntries: NutritionEntry[];
  previewIngredients: Record<string, unknown>[];
  previewInstructions: Record<string, unknown>[];
  showDiffView: boolean;
  showImportPreview: boolean;
}

function FactGrid({
  items,
}: {
  items: Array<{ label: string; value: string }>;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {items.map((item) => (
        <div
          key={item.label}
          className="grid gap-0.5 p-3 border border-surface-200 dark:border-surface-700 rounded-lg bg-surface-100 dark:bg-surface-800"
        >
          <span className="text-base font-bold text-surface-900 dark:text-surface-50">
            {item.value}
          </span>
          <span className="text-[0.7rem] text-surface-500 dark:text-surface-400 uppercase tracking-wide">
            {item.label}
          </span>
        </div>
      ))}
    </div>
  );
}

function DiffRow({
  label,
  before,
  after,
}: {
  label: string;
  before: string;
  after: string;
}) {
  return (
    <div className="grid gap-0.5 p-2 border border-surface-200 dark:border-surface-700 rounded-lg bg-surface-50 dark:bg-surface-800/50">
      <span className="text-[0.7rem] font-semibold text-surface-500 uppercase tracking-wide">
        {label}
      </span>
      <span className="flex flex-wrap gap-1.5 items-center text-xs break-anywhere">
        <span className="text-danger-400">{before}</span>
        <span className="text-surface-400" aria-hidden="true">
          -&gt;
        </span>
        <span className="text-fresh-500">{after}</span>
      </span>
    </div>
  );
}

function RawJsonViewer({
  label,
  value,
  ariaLabel,
}: {
  label: string;
  value: string;
  ariaLabel: string;
}) {
  return (
    <details className="border border-surface-200 dark:border-surface-700 rounded-lg bg-surface-100 dark:bg-surface-800 overflow-hidden">
      <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-surface-600 dark:text-surface-400 select-none">
        {label}
      </summary>
      <textarea
        className="w-full min-h-44 resize-y border-t border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-900 text-surface-700 dark:text-surface-300 text-xs leading-snug p-2 font-mono block rounded-none"
        readOnly
        value={value}
        aria-label={ariaLabel}
      />
    </details>
  );
}

export function ParsingDetails({
  details,
  parsingDiff,
  recipeFacts,
  nutritionEntries,
  previewIngredients,
  previewInstructions,
  showDiffView,
  showImportPreview,
}: ParsingDetailsProps) {
  return (
    <div className="mt-2 p-3 border border-surface-200 dark:border-surface-700 rounded-lg bg-surface-50 dark:bg-surface-900 grid gap-3 w-full">
      {details.ingredientWarnings.length > 0 && (
        <div className="p-2 border border-warning-400/40 rounded-lg bg-warning-500/8">
          <p className="m-0 text-xs text-surface-600 dark:text-surface-400">
            <strong>Ingredient parser warnings:</strong>
          </p>
          {details.ingredientWarnings.map((warning) => (
            <p
              key={warning}
              className="m-0 text-xs text-surface-600 dark:text-surface-400"
            >
              {warning}
            </p>
          ))}
        </div>
      )}

      {(recipeFacts.length > 0 || nutritionEntries.length > 0) && (
        <div className="grid gap-2">
          <p className="m-0 text-xs text-surface-600 dark:text-surface-400">
            <strong>Recipe details</strong>
          </p>
          {recipeFacts.length > 0 && <FactGrid items={recipeFacts} />}
          {nutritionEntries.length > 0 && (
            <div className="grid gap-2">
              <p className="m-0 text-xs text-surface-600 dark:text-surface-400">
                <strong>Nutrition</strong>
              </p>
              <FactGrid items={nutritionEntries} />
            </div>
          )}
        </div>
      )}

      {previewIngredients.length > 0 && (
        <div className="grid gap-2">
          <p className="m-0 text-xs text-surface-600 dark:text-surface-400">
            <strong>Ingredients preview</strong>
          </p>
          <div className="grid gap-1.5">
            {previewIngredients.map((ingredient, index) => {
              const sectionTitle = getSectionTitle(ingredient);
              return (
                <div
                  key={`ingredient-preview-${index}`}
                  className="grid gap-1 p-2 border border-surface-200 dark:border-surface-700 rounded-lg bg-surface-50 dark:bg-surface-800/50"
                >
                  {sectionTitle && (
                    <p className="m-0 text-xs font-bold text-surface-900 dark:text-surface-100">
                      {sectionTitle}
                    </p>
                  )}
                  <p className="m-0 text-sm leading-relaxed text-surface-700 dark:text-surface-300 break-anywhere">
                    {formatIngredientPreview(ingredient)}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {previewInstructions.length > 0 && (
        <div className="grid gap-2">
          <p className="m-0 text-xs text-surface-600 dark:text-surface-400">
            <strong>Instructions preview</strong>
          </p>
          <div className="grid gap-1.5">
            {previewInstructions.map((instruction, index) => {
              const sectionTitle = getSectionTitle(instruction);
              const instructionText = normalizeEmptyText(instruction.text);
              if (!instructionText) return null;
              return (
                <div
                  key={`instruction-preview-${index}`}
                  className="grid gap-1 p-2 border border-surface-200 dark:border-surface-700 rounded-lg bg-surface-50 dark:bg-surface-800/50"
                >
                  {sectionTitle && (
                    <p className="m-0 text-xs font-bold text-surface-900 dark:text-surface-100">
                      {sectionTitle}
                    </p>
                  )}
                  <p className="m-0 text-[0.7rem] font-semibold text-surface-500 uppercase tracking-wide">
                    Step {index + 1}
                  </p>
                  <p className="m-0 text-sm leading-relaxed text-surface-700 dark:text-surface-300 break-anywhere">
                    {instructionText}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {showImportPreview && (
        <>
          <p className="m-0 text-xs text-surface-600 dark:text-surface-400">
            <strong>Mealie import preview</strong>
          </p>
          <p className="m-0 text-xs text-surface-400 dark:text-surface-500">
            This is the JSON payload that will be sent to Mealie when you
            import.
          </p>
          <textarea
            className="w-full min-h-36 resize-y border border-surface-200 dark:border-surface-700 rounded-lg bg-surface-100 dark:bg-surface-800 text-surface-700 dark:text-surface-300 text-xs leading-snug p-2 font-mono block"
            readOnly
            value={JSON.stringify(details.importPayload, null, 2)}
            aria-label="Mealie import payload preview"
          />
        </>
      )}

      {showDiffView && parsingDiff && (
        <>
          <FactGrid items={parsingDiff.summary} />

          {parsingDiff.recipeChanges.length > 0 && (
            <div className="grid gap-2">
              <p className="m-0 text-xs text-surface-600 dark:text-surface-400">
                <strong>Recipe-level changes</strong>
              </p>
              <div className="grid gap-1.5">
                {parsingDiff.recipeChanges.map((change) => (
                  <DiffRow key={change.label} {...change} />
                ))}
              </div>
            </div>
          )}

          {parsingDiff.ingredientChanges.length > 0 && (
            <div className="grid gap-2">
              <p className="m-0 text-xs text-surface-600 dark:text-surface-400">
                <strong>Ingredient changes</strong>
              </p>
              <div className="grid gap-2">
                {parsingDiff.ingredientChanges.map(
                  (ingredient, ingredientIndex) => (
                    <div
                      key={`${ingredientIndex}-${ingredient.title}`}
                      className="grid gap-1.5 p-3 border border-surface-200 dark:border-surface-700 rounded-lg bg-surface-100 dark:bg-surface-800"
                    >
                      <p className="m-0 text-xs font-semibold text-surface-800 dark:text-surface-200">
                        {ingredient.title}
                      </p>
                      <div className="grid gap-1.5">
                        {ingredient.changes.map((change) => (
                          <DiffRow
                            key={`${ingredient.title}-${change.label}`}
                            {...change}
                          />
                        ))}
                      </div>
                    </div>
                  )
                )}
              </div>
            </div>
          )}
        </>
      )}

      <RawJsonViewer
        label="Raw AI recipe JSON"
        value={JSON.stringify(details.parsedRecipe, null, 2)}
        ariaLabel="AI parsed recipe JSON"
      />

      {showDiffView && (
        <RawJsonViewer
          label="Raw Mealie import payload"
          value={JSON.stringify(details.importPayload, null, 2)}
          ariaLabel="Mealie import payload JSON"
        />
      )}
    </div>
  );
}
