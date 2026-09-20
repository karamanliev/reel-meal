import test from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { downloadVideoThumbnail } from "./ytdlp.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

test("yt-dlp thumbnail fallback writes related files without downloading video", async () => {
  let receivedArgs: string[] = [];
  const thumbnail = await downloadVideoThumbnail("https://video.example/watch/123", async (args) => {
    receivedArgs = args;
    const outputIndex = args.indexOf("--output");
    const template = args[outputIndex + 1]!;
    assert.equal(template.startsWith("thumbnail:"), false);
    await writeFile(template.replace("%(ext)s", "png"), png);
    return { stdout: "", stderr: "" };
  });

  assert.equal(receivedArgs.includes("--skip-download"), true);
  assert.equal(receivedArgs.includes("--write-thumbnail"), true);
  assert.equal(receivedArgs.includes("--no-playlist"), true);
  assert.equal(thumbnail.contentType, "image/png");
  assert.deepEqual(thumbnail.buffer, png);
});

test("yt-dlp thumbnail fallback rejects runs that produce no supported image", async () => {
  await assert.rejects(
    downloadVideoThumbnail("https://video.example/watch/empty", async () => ({ stdout: "", stderr: "" })),
    /did not produce a supported thumbnail image/,
  );
});
