import test from "node:test";
import assert from "node:assert/strict";
import { IncompleteRecipeError, isRetryableGenerationError } from "./generation-errors.js";

test("incomplete recipe results are terminal rather than retryable", () => {
  assert.equal(isRetryableGenerationError(new IncompleteRecipeError("No recipe")), false);
  assert.equal(isRetryableGenerationError(new SyntaxError("Invalid JSON")), true);
});
