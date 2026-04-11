import { useQueue } from "./hooks/useQueue";
import { Header } from "./components/Header";
import { UrlForm } from "./components/UrlForm";
import { ProgressCard } from "./components/ProgressCard";
import { QueueSidebar } from "./components/QueueSidebar";
import { BackgroundIcons } from "./components/BackgroundIcons";
import { getIngredients, getInstructions } from "./lib/formatters";
import {
  buildParsingDiff,
  buildRecipeFacts,
  getNutritionEntries,
} from "./lib/recipe-utils";

export default function App() {
  const q = useQueue();
  const selectedJob = q.getSelectedJob();
  const showSidebar = q.jobs.length > 0;
  const showProgressCard = selectedJob !== null;

  const selectedJobDerived = selectedJob?.parsingDetails
    ? {
        parsingDiff: buildParsingDiff(selectedJob.parsingDetails),
        recipeFacts: buildRecipeFacts(selectedJob.parsingDetails),
        nutritionEntries: getNutritionEntries(selectedJob.parsingDetails),
        previewIngredients: getIngredients(selectedJob.parsingDetails.importPayload),
        previewInstructions: getInstructions(selectedJob.parsingDetails.importPayload),
        showDiffView: Boolean(selectedJob.recipeUrl),
        showImportPreview:
          selectedJob.phase === "review" &&
          Boolean(selectedJob.parsingDetails) &&
          !selectedJob.recipeUrl,
        showManualImportPanel:
          selectedJob.phase === "review" &&
          Boolean(selectedJob.parsingDetails) &&
          !selectedJob.recipeUrl,
      }
    : {
        parsingDiff: null as Parameters<typeof ProgressCard>[0]["parsingDiff"],
        recipeFacts: [] as Parameters<typeof ProgressCard>[0]["recipeFacts"],
        nutritionEntries: [] as Parameters<typeof ProgressCard>[0]["nutritionEntries"],
        previewIngredients: [] as Parameters<typeof ProgressCard>[0]["previewIngredients"],
        previewInstructions: [] as Parameters<typeof ProgressCard>[0]["previewInstructions"],
        showDiffView: false,
        showImportPreview: false,
        showManualImportPanel: false,
      };

  return (
    <div className="neo-page-bg min-h-dvh px-4 py-6 font-ui text-ink sm:px-5 sm:py-8">
      <BackgroundIcons />
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-6">
        <Header />

        <div className="flex w-full gap-5">
          {showSidebar && (
            <QueueSidebar
              jobs={q.jobs}
              selectedJobId={q.selectedJobId}
              selectJob={q.selectJob}
              cancelJob={q.cancelJob}
              removeJob={q.removeJob}
              toggleAutoImport={q.toggleAutoImport}
            />
          )}

          <main className="min-w-0 flex-1 flex flex-col gap-6 pb-16 md:pb-0">
            <UrlForm
              url={q.url}
              setUrl={q.setUrl}
              translate={q.translate}
              setTranslate={q.setTranslate}
              extractTranscript={q.extractTranscript}
              setExtractTranscript={q.setExtractTranscript}
              autoImport={q.autoImport}
              setAutoImport={q.setAutoImport}
              useCustomPrompt={q.useCustomPrompt}
              setUseCustomPrompt={q.setUseCustomPrompt}
              customPrompt={q.customPrompt}
              setCustomPrompt={q.setCustomPrompt}
              customPromptMaxLength={q.customPromptMaxLength}
              onSubmit={q.handleSubmit}
            />

            {showProgressCard && selectedJob && (
              <ProgressCard
                phase={selectedJob.phase}
                steps={selectedJob.steps}
                isLoading={selectedJob.phase === "loading"}
                recipeTitle={selectedJob.recipeTitle}
                thumbnailUrl={selectedJob.thumbnailUrl}
                recipeUrl={selectedJob.recipeUrl}
                errorMessage={selectedJob.errorMessage}
                manualImportError={selectedJob.manualImportError}
                metadataDetails={selectedJob.metadataDetails}
                transcriptDetails={selectedJob.transcriptDetails}
                parsingDetails={selectedJob.parsingDetails}
                expandedDetails={selectedJob.expandedDetails}
                parsingDiff={selectedJobDerived.parsingDiff}
                recipeFacts={selectedJobDerived.recipeFacts}
                nutritionEntries={selectedJobDerived.nutritionEntries}
                previewIngredients={selectedJobDerived.previewIngredients}
                previewInstructions={selectedJobDerived.previewInstructions}
                showDiffView={selectedJobDerived.showDiffView}
                showImportPreview={selectedJobDerived.showImportPreview}
                showManualImportPanel={selectedJobDerived.showManualImportPanel}
                toggleDetails={(step) => q.toggleDetails(selectedJob.id, step)}
                handleManualImport={() => q.handleManualImport(selectedJob.id)}
                reset={() => q.removeJob(selectedJob.id)}
                queuePosition={selectedJob.position}
                queueTotal={selectedJob.totalInQueue}
              />
            )}
          </main>
        </div>
      </div>
    </div>
  );
}