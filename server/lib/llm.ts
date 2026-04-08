import OpenAI from "openai";
import { config } from "./config.js";

// -------------------------------------------------------------------------
// Mealie recipe schema types (subset used for generation)
// -------------------------------------------------------------------------

export interface RecipeIngredient {
  title?: string | null;
  quantity?: number | null;
  unit?: { name: string } | null;
  food?: { name: string } | null;
  note?: string | null;
  originalText: string;
}

export interface RecipeInstruction {
  title?: string | null;
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
  recipeServings?: number | null;
  prepTime?: string | null;
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
  "prepTime": "human-readable duration string like '15 minutes' or '1 hour 30 minutes', or null",
  "cookTime": "human-readable duration string like '30 minutes', or null",
  "totalTime": "human-readable duration string like '45 minutes' or '18 hours 40 minutes', or null",
  "recipeIngredient": [
    {
      "title": "string or null — section title ONLY on the first ingredient of an explicitly named group like 'Poolish' or 'Dough'",
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
- Use human-readable duration strings for times, such as "15 minutes", "35 min", or "1 hour 30 minutes".
- If a value is not mentioned, use null (not empty string, not 0).
- Only include recipeServings if the source EXPLICITLY states servings. Do not infer it.
- Prefer fewer, more meaningful instruction steps over many tiny ones.
  - Combine consecutive actions that naturally belong together in real cooking.
  - Usually a normal recipe should land around 6-10 steps, but adapt to recipe complexity.
  - Do NOT split trivial motions into separate steps.
  - Keep a separate step only when the transition is meaningfully distinct in the source.
- Choose appropriate categories (e.g. "Dinner", "Breakfast", "Dessert", "Soup") and tags (e.g. "Italian", "Vegetarian", "Quick", "Gluten-Free").
- If nutrition info is not explicitly mentioned, omit the nutrition field entirely.
- The transcript may be noisy — use the description and title to fill gaps.

Grouping rules:
- Create ingredient or instruction section titles ONLY when the source explicitly names distinct recipe components or phases, such as "Poolish", "Dough", "Sauce", "Filling", "Meat", or "Assembly".
- Do NOT invent groups for ordinary recipes that do not clearly need them.
- Preserve only what is explicit: if only ingredients are grouped, only group ingredients; if only instructions are grouped, only group instructions.
- For a grouped section, set "title" ONLY on the first ingredient or first instruction in that section.
- All following items in the same section must use "title": null.

Ingredient parsing rules — these are CRITICAL for correct import:
- Each ingredient MUST be split into exactly these fields: quantity, unit, food, note.
- quantity: a single number (integer or decimal). Use null if no amount is given.
  - NEVER use 0 as a substitute for "no quantity". Use null.
  - "3-4" → pick the middle: 3.5. Ranges go in note.
  - Fractions: "½" → 0.5, "1½" → 1.5, "¼" → 0.25.
- unit.name: ONLY the measurement unit word, nothing else.
  - Examples: "г", "кг", "мл", "л", "бр", "ч.л.", "с.л.", "щипка", "cup", "tbsp", "tsp", "oz".
  - If there is no unit (e.g. "3 яйца"), set unit to null. "яйца" is a food, not a unit.
  - Countable foods (eggs, onions, cloves) do NOT need a unit — set unit to null.
- food.name: ONLY the ingredient name in its base/dictionary form.
  - NEVER include quantity, unit, or preparation details in food.name.
  - Good: "пилешко филе", "лук", "чесън", "масло", "брашно", "яйца"
  - Bad: "200г пилешко филе" (has quantity+unit), "нарязан лук" (has prep), "3 яйца" (has quantity)
- note: preparation details, qualifiers, or clarifications ONLY.
  - Good: "нарязан на кубчета", "finely chopped", "at room temperature", "по желание"
  - If there is nothing to note, use null (not empty string).
- originalText: the FULL natural ingredient line as a human would read it.
  - Example: "200 г пилешко филе, нарязано на кубчета"
- NEVER duplicate quantity or unit text inside food.name or note.
- If the ingredient structure is truly unclear, set quantity/unit/food to null and put everything in originalText + note so no information is lost.

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
