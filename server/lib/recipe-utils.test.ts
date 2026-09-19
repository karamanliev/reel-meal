import test from "node:test";
import assert from "node:assert/strict";
import { getNutritionEntries, NUTRITION_HEADING, SPARKY_NUTRITION_NOTE } from "../../client/src/lib/recipe-utils.js";

test("client nutrition helpers expose only the four supported fields and basis copy", () => {
  const entries = getNutritionEntries({ parsedRecipe: {}, importPayload: { nutrition: { calories: "100 kcal", proteinContent: "5.0 g", carbohydrateContent: "10.0 g", fatContent: "2.0 g", fiberContent: "4 g", sodiumContent: "20 mg" } }, ingredientWarnings: [], nutritionWarnings: [] });
  assert.deepEqual(entries.map((entry) => entry.label), ["Calories", "Protein", "Carbs", "Fat"]);
  assert.equal(NUTRITION_HEADING, "AI estimated nutrition per 100 g");
  assert.match(SPARKY_NUTRITION_NOTE, /1\.5 servings represents 150 g/);
});
