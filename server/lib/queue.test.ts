import test from "node:test";
import assert from "node:assert/strict";
import { JobQueue } from "./queue.js";

const asset = { id: "source-00000000-0000-0000-0000-000000000000", fileName: "recipe.png", contentType: "image/png" as const, size: 12, previewUrl: "/api/assets/job/source" };
function params(id: string) { return { id, source: { kind: "images" as const, assetIds: [asset.id] }, displayLabel: "1 image", sourceAssets: [asset], customImage: null, extractTranscript: true, autoImport: false, customPrompt: "" }; }
const preparedImport = { payload: { name: "Soup" } as never, ingredientWarnings: [] };

test("queue snapshots exclude server-only context and cleanup cancelled jobs", async () => {
  const queue = new JobQueue(); const cleaned: string[] = []; queue.setCleanupCallback((id) => { cleaned.push(id); }); queue.setProcessCallback(() => {});
  queue.add(params("job-cancelled")); queue.updateJob("job-cancelled", { normalizedContext: { kind: "images", assets: [asset] } });
  const json = JSON.stringify(queue.getSnapshot()); assert.equal(json.includes("normalizedContext"), false); assert.equal(json.includes("Buffer"), false);
  assert.equal(queue.cancel("job-cancelled"), true); await new Promise((resolve) => setTimeout(resolve, 0)); assert.deepEqual(cleaned, ["job-cancelled"]);
});

test("upload-backed terminal jobs expire", async () => {
  const queue = new JobQueue(5); const cleaned: string[] = []; queue.setCleanupCallback((id) => { cleaned.push(id); }); queue.setProcessCallback(() => {});
  queue.add(params("job-expiry")); queue.fail("job-expiry", "failed"); await new Promise((resolve) => setTimeout(resolve, 20)); assert.equal(queue.getJob("job-expiry"), undefined); assert.deepEqual(cleaned, ["job-expiry"]);
});

test("completing a review job does not advance an unrelated active job", () => {
  const queue = new JobQueue(); const started: string[] = []; queue.setProcessCallback((id) => started.push(id));
  queue.add(params("job-review")); queue.add(params("job-active")); queue.add(params("job-waiting"));
  queue.review("job-review");
  queue.updateJob("job-review", { preparedImport });
  assert.equal(queue.beginImport("job-review"), true);
  queue.complete("job-review", "https://mealie.test/recipe"); queue.endImport("job-review");
  assert.equal(queue.getActiveJobId(), "job-active");
  assert.deepEqual(started, ["job-review", "job-active"]);
});

test("an importing job cannot be cancelled or imported twice", () => {
  const queue = new JobQueue(); queue.setProcessCallback(() => {}); queue.add(params("job-import"));
  queue.updateJob("job-import", { preparedImport });
  assert.equal(queue.beginImport("job-import"), true);
  assert.equal(queue.beginImport("job-import"), false);
  assert.equal(queue.cancel("job-import"), false);
});

test("imported jobs cannot be reprompted", () => {
  const queue = new JobQueue(); queue.setProcessCallback(() => {}); queue.add(params("job-imported"));
  queue.updateJob("job-imported", { normalizedContext: { kind: "images", assets: [asset] }, preparedImport });
  queue.complete("job-imported", "https://mealie.test/recipe");
  assert.equal(queue.reprompt("job-imported", "change it"), false);
});

test("remote assets expire and failed manual imports restore retention", async () => {
  const queue = new JobQueue(5); const cleaned: string[] = []; queue.setCleanupCallback((id) => { cleaned.push(id); }); queue.setProcessCallback(() => {});
  const remoteParams = { ...params("job-remote"), source: { kind: "url" as const, url: "https://example.com/recipe" }, sourceAssets: [] };
  queue.add(remoteParams); queue.updateJob("job-remote", { finalImage: { remoteAssetId: "remote-00000000-0000-0000-0000-000000000000", warnings: [] } }); queue.fail("job-remote", "failed");
  queue.add(params("job-manual")); queue.updateJob("job-manual", { preparedImport }); queue.review("job-manual");
  assert.equal(queue.beginImport("job-manual"), true); queue.endImport("job-manual");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(queue.getJob("job-remote"), undefined); assert.equal(queue.getJob("job-manual"), undefined);
  assert.deepEqual(cleaned.sort(), ["job-manual", "job-remote"]);
});

test("custom covers take priority in recipe previews", () => {
  const queue = new JobQueue(); queue.setProcessCallback(() => {});
  const custom = { ...asset, id: "custom-00000000-0000-0000-0000-000000000000", fileName: "cover.png", previewUrl: "/api/assets/job-cover/custom-cover" };
  const job = queue.add({ ...params("job-cover"), customImage: custom });
  assert.equal(job.thumbnailUrl, custom.previewUrl);
});
