import test from "node:test";
import assert from "node:assert/strict";
import { JobQueue } from "./queue.js";

const asset = { id: "source-00000000-0000-0000-0000-000000000000", fileName: "recipe.png", contentType: "image/png" as const, size: 12, previewUrl: "/api/assets/job/source" };
function params(id: string) { return { id, source: { kind: "images" as const, assetIds: [asset.id] }, displayLabel: "1 image", sourceAssets: [asset], customImage: null, extractTranscript: true, autoImport: false, customPrompt: "" }; }

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
