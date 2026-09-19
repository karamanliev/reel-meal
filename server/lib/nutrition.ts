import { config } from "./config.js";
import type { ParsedRecipe, RecipeNutrition } from "./llm.js";
import { openAIClient } from "./openai-client.js";

const MAX_ATTEMPTS = 2;
const WARNING_PREFIX = "AI nutrition estimation failed";

export interface NutritionEstimate {
  estimatedCookedWeightGrams: number;
  caloriesPer100g: number;
  proteinPer100g: number;
  carbohydratePer100g: number;
  fatPer100g: number;
}

export interface NutritionEstimationResult {
  nutrition?: RecipeNutrition;
  warning?: string;
}

type Completion = (messages: Array<{ role: "system" | "user"; content: string }>) => Promise<string>;

const SYSTEM_PROMPT = `You estimate nutrition for a normalized recipe. Return ONLY one raw JSON object with numeric fields and no markdown or explanation.

Required schema:
{
  "estimatedCookedWeightGrams": number,
  "caloriesPer100g": number,
  "proteinPer100g": number,
  "carbohydratePer100g": number,
  "fatPer100g": number
}

Calculate calories and macros for 100 g of the finished cooked dish, not the raw ingredient mixture. Estimate finished yield from the ingredients and instructions. Account for water loss, absorbed water, drained liquid, discarded cooking media, bones, peels, marinades, and other indicated yield changes. Prioritize explicit source nutrition when its stated basis can be converted reliably. Per-serving and whole-recipe source values must be converted using reliable serving weight or finished yield rather than copied. Unknown-basis evidence is contextual only. All fields are required, finite, and nonnegative; estimatedCookedWeightGrams must be greater than zero.`;

function compactRecipe(recipe: ParsedRecipe): object {
  return {
    name: recipe.name,
    recipeServings: recipe.recipeServings ?? null,
    ingredients: recipe.recipeIngredient.map((ingredient) => ({
      quantity: ingredient.quantity ?? null,
      unit: ingredient.unit?.name ?? null,
      food: ingredient.food?.name ?? null,
      note: ingredient.note ?? null,
      originalText: ingredient.originalText,
    })),
    instructions: recipe.recipeInstructions.map((instruction) => instruction.text),
    sourceNutritionEvidence: recipe.sourceNutritionEvidence ?? null,
  };
}

export function buildNutritionMessages(recipe: ParsedRecipe, retryError?: string): Array<{ role: "system" | "user"; content: string }> {
  const retry = retryError
    ? `\n\nYour previous response failed validation: ${retryError}. Correct that specific problem and return the complete schema.`
    : "";
  return [
    { role: "system", content: SYSTEM_PROMPT + retry },
    { role: "user", content: JSON.stringify(compactRecipe(recipe)) },
  ];
}

function parseJsonObject(content: string): Record<string, unknown> {
  let cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("response does not contain a JSON object");
  const value: unknown = JSON.parse(cleaned.slice(start, end + 1));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("response is not a JSON object");
  return value as Record<string, unknown>;
}

function numericField(value: unknown, name: string, positive = false): number {
  let numeric: number;
  if (typeof value === "number") numeric = value;
  else if (typeof value === "string" && /^\s*(?:\d+(?:\.\d+)?|\.\d+)\s*$/.test(value)) numeric = Number(value);
  else throw new Error(`${name} must be numeric`);
  if (!Number.isFinite(numeric) || numeric < 0 || (positive && numeric === 0)) {
    throw new Error(`${name} must be ${positive ? "positive" : "nonnegative"} and finite`);
  }
  return numeric;
}

export function validateNutritionEstimate(value: unknown): NutritionEstimate {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("estimate must be an object");
  const estimate = value as Record<string, unknown>;
  return {
    estimatedCookedWeightGrams: numericField(estimate.estimatedCookedWeightGrams, "estimatedCookedWeightGrams", true),
    caloriesPer100g: numericField(estimate.caloriesPer100g, "caloriesPer100g"),
    proteinPer100g: numericField(estimate.proteinPer100g, "proteinPer100g"),
    carbohydratePer100g: numericField(estimate.carbohydratePer100g, "carbohydratePer100g"),
    fatPer100g: numericField(estimate.fatPer100g, "fatPer100g"),
  };
}

export function formatNutritionEstimate(estimate: NutritionEstimate): RecipeNutrition {
  const roundedMacro = (value: number): string => `${(Math.round(value * 10) / 10).toFixed(1)} g`;
  return {
    calories: `${Math.round(estimate.caloriesPer100g)} kcal`,
    proteinContent: roundedMacro(estimate.proteinPer100g),
    carbohydrateContent: roundedMacro(estimate.carbohydratePer100g),
    fatContent: roundedMacro(estimate.fatPer100g),
  };
}

async function complete(messages: Array<{ role: "system" | "user"; content: string }>): Promise<string> {
  const response = await openAIClient.chat.completions.create({
    model: config.openaiModel,
    messages,
    temperature: 0.2,
  });
  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("LLM returned empty content");
  return content;
}

export async function estimateRecipeNutrition(recipe: ParsedRecipe, completion: Completion = complete): Promise<NutritionEstimationResult> {
  let lastError = "unknown validation error";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const content = await completion(buildNutritionMessages(recipe, attempt > 1 ? lastError : undefined));
      const estimate = validateNutritionEstimate(parseJsonObject(content));
      return { nutrition: formatNutritionEstimate(estimate) };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      console.warn(`[nutrition] Attempt ${attempt}/${MAX_ATTEMPTS} failed: ${lastError}`);
    }
  }
  return { warning: `${WARNING_PREFIX}: ${lastError}. Recipe imported without nutrition.` };
}
