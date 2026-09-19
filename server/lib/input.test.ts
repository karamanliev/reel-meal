import test from "node:test";
import assert from "node:assert/strict";
import { assertModelInputLength, buildTextModelInput, isExactHttpUrl, MAX_MODEL_INPUT_CHARS } from "./input.js";

test("detects only complete HTTP URLs", () => {
  assert.equal(isExactHttpUrl("https://example.com"), true);
  assert.equal(isExactHttpUrl(" http://example.com/path "), true);
  assert.equal(isExactHttpUrl("Try https://example.com"), false);
  assert.equal(isExactHttpUrl("ftp://example.com"), false);
});

test("accepts the complete input limit and rejects overflow without truncating", () => {
  const accepted = "a".repeat(MAX_MODEL_INPUT_CHARS);
  assert.equal(assertModelInputLength(accepted).length, MAX_MODEL_INPUT_CHARS);
  assert.throws(() => assertModelInputLength(`${accepted}a`), /exceeds/);
});

test("counts model labels and custom instructions in the complete text limit", () => {
  assert.throws(() => buildTextModelInput({ sourceType: "text", title: "Pasted recipe", description: "", attributionUrl: "", extractionMethod: "pasted-text", body: "x".repeat(MAX_MODEL_INPUT_CHARS), customPrompt: "Translate to English" }), /exceeds/);
});
