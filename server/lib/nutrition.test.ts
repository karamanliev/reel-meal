import test from "node:test";
import assert from "node:assert/strict";
import type { ParsedRecipe } from "./llm.js";
import { buildNutritionMessages, estimateRecipeNutrition, formatNutritionEstimate, validateNutritionEstimate } from "./nutrition.js";

const recipe: ParsedRecipe = {
  name: "Soup",
  description: "A soup",
  recipeServings: 4,
  recipeIngredient: [{ quantity: 500, unit: { name: "g" }, food: { name: "tomatoes" }, originalText: "500 g tomatoes" }],
  recipeInstructions: [{ text: "Simmer until reduced." }],
  sourceNutritionEvidence: { values: { calories: "40 kcal", proteinContent: "2 g" }, basis: "per100g" },
};

test("formats complete numeric estimates with required units and rounding", () => {
  const estimate = validateNutritionEstimate({ estimatedCookedWeightGrams: "812.5", caloriesPer100g: 186.6, proteinPer100g: 12.36, carbohydratePer100g: 8.04, fatPer100g: 0 });
  assert.deepEqual(formatNutritionEstimate(estimate), { calories: "187 kcal", proteinContent: "12.4 g", carbohydrateContent: "8.0 g", fatContent: "0.0 g" });
});

test("rejects missing, negative, infinite, nonnumeric, and malformed estimates", () => {
  const valid = { estimatedCookedWeightGrams: 800, caloriesPer100g: 100, proteinPer100g: 5, carbohydratePer100g: 10, fatPer100g: 2 };
  for (const invalid of [
    { ...valid, fatPer100g: undefined },
    { ...valid, proteinPer100g: -1 },
    { ...valid, caloriesPer100g: Infinity },
    { ...valid, carbohydratePer100g: "10 g" },
    { ...valid, estimatedCookedWeightGrams: 0 },
    [],
  ]) assert.throws(() => validateNutritionEstimate(invalid));
});

test("estimator prompt prioritizes source evidence without copying differently based values", () => {
  const messages = buildNutritionMessages(recipe);
  assert.match(messages[0].content, /Prioritize explicit source nutrition/);
  assert.match(messages[0].content, /Per-serving and whole-recipe source values must be converted/);
  assert.deepEqual(JSON.parse(messages[1].content).sourceNutritionEvidence, recipe.sourceNutritionEvidence);
});

test("nutrition retries use the actual validation error and succeed independently", async () => {
  const prompts: string[] = [];
  const responses = ["{\"caloriesPer100g\": 10}", "{\"estimatedCookedWeightGrams\":500,\"caloriesPer100g\":100.4,\"proteinPer100g\":5,\"carbohydratePer100g\":12,\"fatPer100g\":3}"];
  const result = await estimateRecipeNutrition(recipe, async (messages) => { prompts.push(messages[0].content); return responses.shift()!; });
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /estimatedCookedWeightGrams must be numeric/);
  assert.deepEqual(result, { nutrition: { calories: "100 kcal", proteinContent: "5.0 g", carbohydrateContent: "12.0 g", fatContent: "3.0 g" } });
});

test("final estimator failure returns a warning and no nutrition", async () => {
  let calls = 0;
  const result = await estimateRecipeNutrition(recipe, async () => { calls += 1; return "not json"; });
  assert.equal(calls, 2);
  assert.equal(result.nutrition, undefined);
  assert.match(result.warning ?? "", /Recipe imported without nutrition/);
});
