import { useState, useEffect } from "react";
import { useQueue } from "./hooks/useQueue";
import { Header } from "./components/Header";
import { UrlForm } from "./components/UrlForm";
import { ProgressCard } from "./components/ProgressCard";
import { QueueDrawer } from "./components/QueueDrawer";
import { Footer } from "./components/Footer";
import { BackgroundIcons } from "./components/BackgroundIcons";
import { getIngredients, getInstructions } from "./lib/formatters";
import {
  buildParsingDiff,
  buildRecipeFacts,
  getNutritionEntries,
} from "./lib/recipe-utils";

export default function App() {
  const q = useQueue();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const selectedJob = q.getSelectedJob();
  const showProgressCard = selectedJob !== null;
  const hasJobs = q.jobs.length > 0;
  const { jobs, selectedJobId, selectJob } = q;

  useEffect(() => {
    if (!selectedJob) return;
    if (selectedJob.phase === "review" && !selectedJob.expandedDetails.parsing && selectedJob.parsingDetails) {
      q.toggleDetails(selectedJob.id, "parsing");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedJob?.phase, selectedJob?.id]);

  useEffect(() => {
    if (selectedJobId) return;
    if (jobs.length === 0) return;
    const active = jobs.find((j) => j.phase === "loading");
    const review = jobs.find((j) => j.phase === "review");
    const queued = jobs.find((j) => j.phase === "queued");
    const pick = active ?? review ?? queued;
    if (pick) selectJob(pick.id);
  }, [jobs, selectedJobId, selectJob]);

  const selectedJobDerived = selectedJob?.parsingDetails
    ? {
        parsingDiff: buildParsingDiff(selectedJob.parsingDetails),
        recipeFacts: buildRecipeFacts(selectedJob.parsingDetails),
        nutritionEntries: getNutritionEntries(selectedJob.parsingDetails),
        previewIngredients: getIngredients(
          selectedJob.parsingDetails.importPayload,
        ),
        previewInstructions: getInstructions(
          selectedJob.parsingDetails.importPayload,
        ),
        showDiffView: Boolean(selectedJob.recipeUrl),
        showImportPreview:
          selectedJob.phase === "review" &&
          Boolean(selectedJob.parsingDetails) &&
          !selectedJob.recipeUrl,
        showManualImportPanel:
          selectedJob.phase === "review" &&
          Boolean(selectedJob.parsingDetails) &&
          !selectedJob.recipeUrl,
        showRepromptPanel:
          (selectedJob.phase === "review" || q.repromptingJobId === selectedJob.id) &&
          Boolean(selectedJob.metadataDetails) &&
          Boolean(selectedJob.transcriptDetails) &&
          !selectedJob.recipeUrl,
      }
    : {
        parsingDiff: null as Parameters<typeof ProgressCard>[0]["parsingDiff"],
        recipeFacts: [] as Parameters<typeof ProgressCard>[0]["recipeFacts"],
        nutritionEntries: [] as Parameters<
          typeof ProgressCard
        >[0]["nutritionEntries"],
        previewIngredients: [] as Parameters<
          typeof ProgressCard
        >[0]["previewIngredients"],
        previewInstructions: [] as Parameters<
          typeof ProgressCard
        >[0]["previewInstructions"],
        showDiffView: false,
        showImportPreview: false,
        showManualImportPanel: false,
        showRepromptPanel: false,
      };

  return (
    <div className="neo-page-bg flex min-h-dvh flex-col px-4 py-6 font-ui text-ink sm:px-5 sm:py-8">
      <BackgroundIcons />
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center gap-6">
        <Header queueCount={q.jobs.length} onQueueClick={() => setDrawerOpen(true)} />

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
          hasJobs={hasJobs}
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
            showRepromptPanel={selectedJobDerived.showRepromptPanel}
            customPrompt={selectedJob.customPrompt}
            customPromptMaxLength={q.customPromptMaxLength}
            repromptLoading={q.repromptingJobId === selectedJob.id}
            onReprompt={(customPrompt) => q.reprompt(selectedJob.id, customPrompt)}
            toggleDetails={(step) => q.toggleDetails(selectedJob.id, step)}
            handleManualImport={() => q.handleManualImport(selectedJob.id)}
            onCancel={() => q.cancelJob(selectedJob.id)}
            reset={() => q.removeJob(selectedJob.id)}
            queuePosition={selectedJob.position}
            queueTotal={selectedJob.totalInQueue}
          />
        )}
      </div>

      <Footer />

      <QueueDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        jobs={q.jobs}
        selectedJobId={q.selectedJobId}
        selectJob={q.selectJob}
        cancelJob={q.cancelJob}
        removeJob={q.removeJob}
        toggleAutoImport={q.toggleAutoImport}
      />
    </div>
  );
}
