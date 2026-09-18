import test from "node:test";
import assert from "node:assert/strict";
import { validateImageBuffer } from "./assets.js";

const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from("0000IHDR00000000")]);
test("validates declared MIME against image signatures", () => {
  assert.equal(validateImageBuffer({ buffer: png, declaredType: "image/png", fileName: "recipe.png" }), "image/png");
  assert.throws(() => validateImageBuffer({ buffer: png, declaredType: "image/jpeg", fileName: "recipe.jpg" }), /does not match/);
  assert.throws(() => validateImageBuffer({ buffer: Buffer.from("not an image"), declaredType: "image/png", fileName: "fake.png" }), /signature/);
  assert.throws(() => validateImageBuffer({ buffer: png, declaredType: "application/pdf", fileName: "recipe.pdf" }), /unsupported/);
});
