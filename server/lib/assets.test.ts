import test from "node:test";
import assert from "node:assert/strict";
import { validateImageBuffer } from "./assets.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
test("validates declared MIME against image signatures", () => {
  assert.equal(validateImageBuffer({ buffer: png, declaredType: "image/png", fileName: "recipe.png" }), "image/png");
  assert.throws(() => validateImageBuffer({ buffer: png, declaredType: "image/jpeg", fileName: "recipe.jpg" }), /does not match/);
  assert.throws(() => validateImageBuffer({ buffer: Buffer.from("not an image"), declaredType: "image/png", fileName: "fake.png" }), /signature/);
  assert.throws(() => validateImageBuffer({ buffer: png, declaredType: "application/pdf", fileName: "recipe.pdf" }), /unsupported/);
});

test("rejects truncated files that only have a supported signature", () => {
  const truncated = [
    { buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]), type: "image/jpeg", name: "fake.jpg" },
    { buffer: Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from("0000IHDR00000000")]), type: "image/png", name: "fake.png" },
    { buffer: Buffer.from("RIFF0000WEBP", "ascii"), type: "image/webp", name: "fake.webp" },
    { buffer: Buffer.from("GIF89a0000", "ascii"), type: "image/gif", name: "fake.gif" },
  ];
  for (const file of truncated) assert.throws(() => validateImageBuffer({ buffer: file.buffer, declaredType: file.type, fileName: file.name }), /corrupt|incomplete/);
});
