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

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <p className="neo-overline">{children}</p>;
}

function FactGrid({
  items,
}: {
  items: Array<{ label: string; value: string }>;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {items.map((item) => (
        <div
          key={item.label}
          className="neo-subpanel bg-[#fff2bd] p-3 shadow-neo-xs"
        >
          <span className="block font-display text-[1.1rem] leading-none font-800 tracking-[-0.05em] text-ink">
            {item.value}
          </span>
          <span className="mt-1 block text-[0.72rem] font-700 uppercase tracking-[0.08em] text-[#454545]">
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
    <div className="neo-subpanel p-3 shadow-neo-xs">
      <span className="block text-[0.72rem] font-800 uppercase tracking-[0.08em] text-[#454545]">
        {label}
      </span>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm font-600 break-anywhere">
        <span className="rounded-full border-2 border-ink bg-[#ffd6d0] px-2.5 py-1 text-ink">
          {before}
        </span>
        <span aria-hidden="true">-&gt;</span>
        <span className="rounded-full border-2 border-ink bg-[#ddffc3] px-2.5 py-1 text-ink">
          {after}
        </span>
      </div>
    </div>
  );
}

function PreviewRow({
  sectionTitle,
  label,
  text,
}: {
  sectionTitle?: string | null;
  label?: string;
  text: string;
}) {
  return (
    <div className="neo-subpanel p-3 shadow-neo-xs">
      {sectionTitle && (
        <p className="m-0 font-display text-[1rem] leading-none font-800 tracking-[-0.04em] text-ink">
          {sectionTitle}
        </p>
      )}
      {label && (
        <p className="m-0 mt-2 text-[0.72rem] font-800 uppercase tracking-[0.08em] text-[#4a4a4a]">
          {label}
        </p>
      )}
      <p className="m-0 mt-2 text-[0.98rem] leading-6 font-500 text-ink break-anywhere">
        {text}
      </p>
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
    <details className="neo-details neo-subpanel overflow-hidden">
      <summary className="px-4 py-3 text-sm font-800 uppercase tracking-[0.08em] text-ink">
        {label}
      </summary>
      <div className="p-4">
        <textarea
          className="neo-textarea min-h-44 font-mono text-[0.82rem]"
          readOnly
          value={value}
          aria-label={ariaLabel}
        />
      </div>
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
    <div className="neo-mt-4 p-4 sm:p-5">
      <div className="grid gap-4">
        {details.ingredientWarnings.length > 0 && (
          <div className="neo-subpanel bg-[#fff2bd] p-4 shadow-neo-xs">
            <SectionHeading>Ingredient parser warnings</SectionHeading>
            <div className="mt-2 grid gap-1.5">
              {details.ingredientWarnings.map((warning) => (
                <p
                  key={warning}
                  className="m-0 text-sm leading-6 font-500 text-ink"
                >
                  {warning}
                </p>
              ))}
            </div>
          </div>
        )}

        {(recipeFacts.length > 0 || nutritionEntries.length > 0) && (
          <div className="grid gap-3">
            <SectionHeading>Recipe details</SectionHeading>
            {recipeFacts.length > 0 && <FactGrid items={recipeFacts} />}

            {nutritionEntries.length > 0 && (
              <div className="grid gap-3">
                <SectionHeading>Nutrition</SectionHeading>
                <FactGrid items={nutritionEntries} />
              </div>
            )}
          </div>
        )}

        {previewIngredients.length > 0 && (
          <div className="grid gap-3">
            <SectionHeading>Ingredients preview</SectionHeading>
            <div className="grid gap-2">
              {previewIngredients.map((ingredient, index) => (
                <PreviewRow
                  key={`ingredient-preview-${index}`}
                  sectionTitle={getSectionTitle(ingredient)}
                  text={formatIngredientPreview(ingredient)}
                />
              ))}
            </div>
          </div>
        )}

        {previewInstructions.length > 0 && (
          <div className="grid gap-3">
            <SectionHeading>Instructions preview</SectionHeading>
            <div className="grid gap-2">
              {previewInstructions.map((instruction, index) => {
                const sectionTitle = getSectionTitle(instruction);
                const instructionText = normalizeEmptyText(instruction.text);

                if (!instructionText) {
                  return null;
                }

                return (
                  <PreviewRow
                    key={`instruction-preview-${index}`}
                    sectionTitle={sectionTitle}
                    label={`Step ${index + 1}`}
                    text={instructionText}
                  />
                );
              })}
            </div>
          </div>
        )}

        {showImportPreview && (
          <div className="grid gap-3">
            <SectionHeading>Mealie import preview</SectionHeading>
            <p className="neo-note">
              This JSON payload is what ReelMeal will send to Mealie during
              import.
            </p>
            <textarea
              className="neo-textarea min-h-36 font-mono text-[0.82rem]"
              readOnly
              value={JSON.stringify(details.importPayload, null, 2)}
              aria-label="Mealie import payload preview"
            />
          </div>
        )}

        {showDiffView && parsingDiff && (
          <>
            <div className="grid gap-3">
              <SectionHeading>Parsing diff summary</SectionHeading>
              <FactGrid items={parsingDiff.summary} />
            </div>

            {parsingDiff.recipeChanges.length > 0 && (
              <div className="grid gap-3">
                <SectionHeading>Recipe-level changes</SectionHeading>
                <div className="grid gap-2">
                  {parsingDiff.recipeChanges.map((change) => (
                    <DiffRow key={change.label} {...change} />
                  ))}
                </div>
              </div>
            )}

            {parsingDiff.ingredientChanges.length > 0 && (
              <div className="grid gap-3">
                <SectionHeading>Ingredient changes</SectionHeading>
                <div className="grid gap-3">
                  {parsingDiff.ingredientChanges.map(
                    (ingredient, ingredientIndex) => (
                      <div
                        key={`${ingredientIndex}-${ingredient.title}`}
                        className="neo-subpanel bg-[#eef7ff] p-4"
                      >
                        <p className="m-0 font-display text-[1.05rem] leading-none font-800 tracking-[-0.04em] text-ink">
                          {ingredient.title}
                        </p>
                        <div className="mt-3 grid gap-2">
                          {ingredient.changes.map((change) => (
                            <DiffRow
                              key={`${ingredient.title}-${change.label}`}
                              {...change}
                            />
                          ))}
                        </div>
                      </div>
                    ),
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
    </div>
  );
}
