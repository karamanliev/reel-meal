import { useRecipeParser } from "./hooks/useRecipeParser";
import { Header } from "./components/Header";
import { UrlForm } from "./components/UrlForm";
import { ProgressCard } from "./components/ProgressCard";

export default function App() {
  const parser = useRecipeParser();

  return (
    <div className="neo-page-bg min-h-dvh px-4 py-6 pb-16 font-ui text-ink sm:px-5 sm:py-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-6">
        <Header />

        <main className="w-full flex flex-col gap-6">
          <UrlForm
            url={parser.url}
            setUrl={parser.setUrl}
            translate={parser.translate}
            setTranslate={parser.setTranslate}
            extractTranscript={parser.extractTranscript}
            setExtractTranscript={parser.setExtractTranscript}
            autoImport={parser.autoImport}
            setAutoImport={parser.setAutoImport}
            useCustomPrompt={parser.useCustomPrompt}
            setUseCustomPrompt={parser.setUseCustomPrompt}
            customPrompt={parser.customPrompt}
            setCustomPrompt={parser.setCustomPrompt}
            customPromptMaxLength={parser.customPromptMaxLength}
            isLoading={parser.isLoading}
            onSubmit={parser.handleSubmit}
          />

          {parser.showCard && (
            <ProgressCard
              phase={parser.phase}
              steps={parser.steps}
              isLoading={parser.isLoading}
              recipeTitle={parser.recipeTitle}
              thumbnailUrl={parser.thumbnailUrl}
              recipeUrl={parser.recipeUrl}
              errorMessage={parser.errorMessage}
              manualImportError={parser.manualImportError}
              metadataDetails={parser.metadataDetails}
              transcriptDetails={parser.transcriptDetails}
              parsingDetails={parser.parsingDetails}
              expandedDetails={parser.expandedDetails}
              parsingDiff={parser.parsingDiff}
              recipeFacts={parser.recipeFacts}
              nutritionEntries={parser.nutritionEntries}
              previewIngredients={parser.previewIngredients}
              previewInstructions={parser.previewInstructions}
              showDiffView={parser.showDiffView}
              showImportPreview={parser.showImportPreview}
              showManualImportPanel={parser.showManualImportPanel}
              toggleDetails={parser.toggleDetails}
              handleManualImport={parser.handleManualImport}
              reset={parser.reset}
            />
          )}
        </main>
      </div>
    </div>
  );
}
