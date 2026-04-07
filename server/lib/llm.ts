import OpenAI from "openai";
import { config } from "./config.js";

// -------------------------------------------------------------------------
// Mealie recipe schema types (subset used for generation)
// -------------------------------------------------------------------------

export interface RecipeIngredient {
  quantity?: number | null;
  unit?: { name: string } | null;
  food?: { name: string } | null;
  note?: string | null;
  originalText: string;
}

export interface RecipeInstruction {
  title?: string;
  text: string;
}

export interface RecipeNutrition {
  calories?: string;
  proteinContent?: string;
  fatContent?: string;
  carbohydrateContent?: string;
  fiberContent?: string;
  sugarContent?: string;
  sodiumContent?: string;
}

export interface RecipeCategory {
  name: string;
}

export interface RecipeTag {
  name: string;
}

export interface ParsedRecipe {
  name: string;
  description: string;
  recipeServings?: number;
  prepTime?: string;     // ISO 8601 duration e.g. "PT20M"
  cookTime?: string;
  totalTime?: string;
  recipeIngredient: RecipeIngredient[];
  recipeInstructions: RecipeInstruction[];
  recipeCategory?: RecipeCategory[];
  tags?: RecipeTag[];
  nutrition?: RecipeNutrition;
}

// -------------------------------------------------------------------------
// System prompt
// -------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a culinary assistant that converts recipe content into structured JSON.

Given a video title, description, and transcript, extract the recipe and output a valid JSON object following the schema below. Output ONLY the JSON object — no markdown fences, no explanation.

Schema:
{
  "name": "string — recipe name",
  "description": "string — short 1-2 sentence description",
  "recipeServings": number or null,
  "prepTime": "ISO 8601 duration string e.g. PT15M, or null",
  "cookTime": "ISO 8601 duration string e.g. PT30M, or null",
  "totalTime": "ISO 8601 duration string e.g. PT45M, or null",
  "recipeIngredient": [
    {
      "quantity": number or null,
      "unit": { "name": "string" } or null,
      "food": { "name": "string" } or null,
      "note": "string or null — e.g. 'finely chopped', 'at room temperature'",
      "originalText": "string — the full original ingredient line"
    }
  ],
  "recipeInstructions": [
    {
      "title": "string or empty string",
      "text": "string — full step text"
    }
  ],
  "recipeCategory": [{ "name": "string" }],
  "tags": [{ "name": "string" }],
  "nutrition": {
    "calories": "string e.g. '320 kcal' or null",
    "proteinContent": "string e.g. '12 g' or null",
    "fatContent": "string or null",
    "carbohydrateContent": "string or null",
    "fiberContent": "string or null",
    "sugarContent": "string or null",
    "sodiumContent": "string or null"
  }
}

Rules:
- Use ISO 8601 duration format for times (PT15M = 15 minutes, PT1H30M = 1 hour 30 minutes).
- If a value is not mentioned, use null (not empty string, not 0).
- Parse ingredients carefully: separate quantity, unit, food name, and any preparation notes.
- Ingredient field rules:
  - originalText must be the full natural ingredient line.
  - quantity must contain only the numeric amount.
  - unit.name must contain only the measurement unit.
  - food.name must contain only the ingredient name, never quantity or unit text.
  - note should contain only preparation details, optional qualifiers, or parenthetical text.
  - Do not duplicate quantity or unit inside food, note, or originalText beyond the normal ingredient line.
  - If the structure is uncertain, preserve a clean originalText and use null for uncertain structured fields instead of guessing.
- Keep instruction steps atomic — one action per step.
- Choose appropriate categories (e.g. "Dinner", "Breakfast", "Dessert", "Soup") and tags (e.g. "Italian", "Vegetarian", "Quick", "Gluten-Free").
- If nutrition info is not mentioned, omit the nutrition field entirely.
- The transcript may be noisy — use the description and title to fill gaps.
- LANGUAGE: Keep ALL text (name, description, ingredients, instructions, notes) in the original language of the recipe. Do NOT translate anything.`;

const SYSTEM_PROMPT_TRANSLATE = SYSTEM_PROMPT.replace(
  "- LANGUAGE: Keep ALL text (name, description, ingredients, instructions, notes) in the original language of the recipe. Do NOT translate anything.",
  "- LANGUAGE: Translate ALL text (name, description, ingredients, instructions, notes, categories, tags) into English."
);

// -------------------------------------------------------------------------
// Main parsing function
// -------------------------------------------------------------------------

const client = new OpenAI({
  apiKey: config.openaiApiKey,
  baseURL: config.openaiBaseUrl,
});

export async function parseRecipeFromTranscript(params: {
  title: string;
  description: string;
  transcript: string;
  translate?: boolean;
}): Promise<ParsedRecipe> {
  const { title, description, transcript, translate = false } = params;
  const systemPrompt = translate ? SYSTEM_PROMPT_TRANSLATE : SYSTEM_PROMPT;

  // Trim transcript to avoid hitting context limits (keep ~12k chars)
  const trimmedTranscript =
    transcript.length > 12000
      ? transcript.slice(0, 12000) + "\n[transcript truncated]"
      : transcript;

  const userMessage = `Video Title: ${title}

Video Description:
${description || "(no description available)"}

Transcript:
${trimmedTranscript}`;

  const MAX_RETRIES = 2;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const extraInstruction =
        attempt > 1
          ? "\n\nIMPORTANT: Your previous response was not valid JSON. Output ONLY a raw JSON object, no markdown, no explanation, no code fences."
          : "";

      const response = await client.chat.completions.create({
        model: config.openaiModel,
        messages: [
          { role: "system", content: systemPrompt + extraInstruction },
          { role: "user", content: userMessage },
        ],
        temperature: 0.2,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error("LLM returned empty content");

      const recipe = parseJsonResponse(content);
      validateRecipe(recipe);
      return recipe;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[llm] Attempt ${attempt}/${MAX_RETRIES} failed: ${lastError.message}`);
    }
  }

  throw lastError ?? new Error("Recipe parsing failed after all retries");
}

/**
 * Strip markdown code fences if present, then parse JSON.
 */
function parseJsonResponse(content: string): ParsedRecipe {
  let cleaned = content.trim();

  // Remove ```json ... ``` or ``` ... ``` fences
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

  // Find the first { and last } to extract JSON object
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error(`Response does not contain a JSON object: ${cleaned.slice(0, 200)}`);
  }

  return JSON.parse(cleaned.slice(start, end + 1)) as ParsedRecipe;
}

/**
 * Basic validation — ensure required fields are present.
 */
function validateRecipe(recipe: unknown): asserts recipe is ParsedRecipe {
  if (typeof recipe !== "object" || recipe === null) {
    throw new Error("Parsed recipe is not an object");
  }

  const r = recipe as Record<string, unknown>;

  if (typeof r["name"] !== "string" || !r["name"]) {
    throw new Error("Recipe missing required field: name");
  }

  if (!Array.isArray(r["recipeIngredient"])) {
    throw new Error("Recipe missing required field: recipeIngredient (must be array)");
  }

  if (!Array.isArray(r["recipeInstructions"])) {
    throw new Error("Recipe missing required field: recipeInstructions (must be array)");
  }
}
