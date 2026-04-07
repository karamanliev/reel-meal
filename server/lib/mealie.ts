import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import type { ParsedRecipe, RecipeIngredient } from "./llm.js";

// -------------------------------------------------------------------------
// Mealie API client
// -------------------------------------------------------------------------

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    Authorization: `Bearer ${config.mealieApiToken}`,
    ...extra,
  };
}

function toIsoDurationOrNull(value?: string): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const isoDurationPattern = /^P(?=.+)(?:\d+Y)?(?:\d+M)?(?:\d+W)?(?:\d+D)?(?:T(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?$/i;
  return isoDurationPattern.test(trimmed) ? trimmed.toUpperCase() : null;
}

async function mealieRequest<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const url = `${config.mealieUrl}${path}`;

  const init: RequestInit = {
    method,
    headers: headers({ "Content-Type": "application/json" }),
  };

  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }

  const res = await fetch(url, init);

  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    const bodyPreview = body === undefined ? "(no body)" : JSON.stringify(body).slice(0, 1500);
    throw new Error(
      `Mealie API ${method} ${path} → ${res.status} ${res.statusText}: ${text} | payload=${bodyPreview}`
    );
  }

  // 204 No Content
  if (res.status === 204) return undefined as T;

  return res.json() as Promise<T>;
}

interface MealieNamedValue {
  name: string;
  id?: string | null;
}

interface MealieIngredientInput {
  quantity: number;
  unit: MealieNamedValue | null;
  food: MealieNamedValue | null;
  note: string;
  display: string;
  title: string | null;
  originalText: string | null;
  referenceId: string;
}

interface MealieInstructionInput {
  id: string;
  title: string;
  summary: string;
  text: string;
  ingredientReferences: string[];
}

export interface RecipeImportPayload {
  name: string;
  description: string;
  recipeServings: number;
  prepTime: string | null;
  cookTime: string | null;
  totalTime: string | null;
  recipeIngredient: MealieIngredientInput[];
  recipeInstructions: MealieInstructionInput[];
  recipeCategory: Array<{ name: string; slug: string }>;
  tags: Array<{ name: string; slug: string }>;
  nutrition?: ParsedRecipe["nutrition"];
  orgURL: string;
}

export interface PreparedRecipeImport {
  payload: RecipeImportPayload;
  ingredientWarnings: string[];
}

interface IngredientParserConfidence {
  average?: number;
}

interface IngredientParserResponse {
  ingredient?: {
    quantity?: number | null;
    unit?: MealieNamedValue | null;
    food?: MealieNamedValue | null;
    note?: string | null;
    display?: string | null;
  };
  confidence?: IngredientParserConfidence;
}

const foodCache = new Map<string, Promise<MealieNamedValue | null>>();
const unitCache = new Map<string, Promise<MealieNamedValue | null>>();

interface PaginatedNamedValuesResponse {
  data?: Array<{ id: string; name: string }>;
}

function normalizeLookupKey(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeIngredientLine(ingredient: RecipeIngredient): string {
  const originalText = ingredient.originalText?.trim();
  if (originalText) return originalText;

  const parts = [
    typeof ingredient.quantity === "number" ? String(ingredient.quantity) : "",
    ingredient.unit?.name?.trim() ?? "",
    ingredient.food?.name?.trim() ?? "",
  ].filter(Boolean);

  const note = ingredient.note?.trim();
  if (note) parts.push(note);

  return parts.join(" ").trim();
}

function buildFallbackIngredient(line: string): MealieIngredientInput {
  return {
    quantity: 0,
    unit: null,
    food: null,
    note: "",
    display: line,
    title: null,
    originalText: line,
    referenceId: randomUUID(),
  };
}

function buildLlmIngredient(line: string, ingredient: RecipeIngredient): MealieIngredientInput {
  return {
    quantity: typeof ingredient.quantity === "number" && Number.isFinite(ingredient.quantity) ? ingredient.quantity : 0,
    unit: ingredient.unit?.name?.trim() ? { name: ingredient.unit.name.trim() } : null,
    food: ingredient.food?.name?.trim() ? { name: ingredient.food.name.trim() } : null,
    note: ingredient.note?.trim() || "",
    display: line,
    title: null,
    originalText: line,
    referenceId: randomUUID(),
  };
}

function foodLooksUnparsed(foodName: string, line: string, unitName?: string | null): boolean {
  const trimmedFood = foodName.trim().toLowerCase();
  const trimmedLine = line.trim().toLowerCase();
  if (!trimmedFood) return true;
  if (trimmedFood === trimmedLine) return true;
  if (unitName && trimmedFood.startsWith(unitName.trim().toLowerCase())) return true;
  return /^(?:\d+(?:[.,]\d+)?|\d+\/\d+|[¼½¾⅓⅔⅛⅜⅝⅞])/.test(trimmedFood);
}

function isWeakIngredientParse(
  parsed: MealieIngredientInput,
  line: string,
  confidence?: IngredientParserConfidence
): boolean {
  if (!parsed.food?.name?.trim()) return true;
  if (foodLooksUnparsed(parsed.food.name, line, parsed.unit?.name)) return true;
  if (typeof confidence?.average === "number" && confidence.average < 0.7) return true;
  return false;
}

async function lookupNamedValue(path: string, name: string): Promise<MealieNamedValue | null> {
  const response = await mealieRequest<PaginatedNamedValuesResponse>(
    "GET",
    `${path}?search=${encodeURIComponent(name)}&perPage=50`
  );

  const match = response.data?.find((item) => normalizeLookupKey(item.name) === normalizeLookupKey(name));
  return match ? { id: match.id, name: match.name } : null;
}

async function createNamedValue(path: string, name: string): Promise<MealieNamedValue | null> {
  try {
    const created = await mealieRequest<{ id: string; name: string }>("POST", path, { name });
    return { id: created.id, name: created.name };
  } catch {
    return lookupNamedValue(path, name);
  }
}

function getCachedNamedValue(
  cache: Map<string, Promise<MealieNamedValue | null>>,
  path: string,
  name: string
): Promise<MealieNamedValue | null> {
  const key = normalizeLookupKey(name);
  let pending = cache.get(key);
  if (!pending) {
    pending = lookupNamedValue(path, name).then((existing) => existing ?? createNamedValue(path, name));
    cache.set(key, pending);
  }
  return pending;
}

async function resolveFood(food: MealieNamedValue | null): Promise<MealieNamedValue | null> {
  if (!food?.name?.trim()) return null;
  if (food.id) return { id: food.id, name: food.name };
  return getCachedNamedValue(foodCache, "/api/foods", food.name.trim());
}

async function resolveUnit(unit: MealieNamedValue | null): Promise<MealieNamedValue | null> {
  if (!unit?.name?.trim()) return null;
  if (unit.id) return { id: unit.id, name: unit.name };
  return getCachedNamedValue(unitCache, "/api/units", unit.name.trim());
}

async function parseIngredientLine(line: string): Promise<{
  ingredient: MealieIngredientInput;
  warning?: string;
}> {
  try {
    const response = await mealieRequest<IngredientParserResponse>("POST", "/api/parser/ingredient", {
      ingredient: line,
    });

    const parsedIngredient = response.ingredient;
    if (!parsedIngredient) {
      return {
        ingredient: buildFallbackIngredient(line),
        warning: `Ingredient parser returned no structured result for: ${line}`,
      };
    }

    const ingredient: MealieIngredientInput = {
      quantity:
        typeof parsedIngredient.quantity === "number" && Number.isFinite(parsedIngredient.quantity)
          ? parsedIngredient.quantity
          : 0,
      unit: parsedIngredient.unit?.name?.trim() ? { name: parsedIngredient.unit.name.trim() } : null,
      food: parsedIngredient.food?.name?.trim() ? { name: parsedIngredient.food.name.trim() } : null,
      note: parsedIngredient.note?.trim() || "",
      display: parsedIngredient.display?.trim() || line,
      title: null,
      originalText: line,
      referenceId: randomUUID(),
    };

    return {
      ingredient,
      warning: isWeakIngredientParse(ingredient, line, response.confidence)
        ? `Ingredient parse may need review: ${line}`
        : undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ingredient: buildFallbackIngredient(line),
      warning: `Ingredient parser failed for: ${line} (${message})`,
    };
  }
}

async function buildRecipeUrl(slug: string): Promise<string> {
  return `${config.mealieUrl}/g/home/r/${slug}`;
}

export async function prepareRecipeImport(
  recipe: ParsedRecipe,
  originalUrl: string
): Promise<PreparedRecipeImport> {
  const ingredientWarnings: string[] = [];
  const recipeIngredient: MealieIngredientInput[] = [];

  for (const ingredient of recipe.recipeIngredient) {
    const line = normalizeIngredientLine(ingredient);
    if (!line) continue;

    const llmIngredient = buildLlmIngredient(line, ingredient);
    const parsed = await parseIngredientLine(line);
    const parserWeak = Boolean(parsed.warning);

    const mergedIngredient: MealieIngredientInput = {
      quantity: parsed.ingredient.quantity > 0 ? parsed.ingredient.quantity : llmIngredient.quantity,
      unit: parsed.ingredient.unit ?? llmIngredient.unit,
      food:
        parsed.ingredient.food && !foodLooksUnparsed(parsed.ingredient.food.name, line, parsed.ingredient.unit?.name)
          ? parsed.ingredient.food
          : llmIngredient.food,
      note: parsed.ingredient.note || llmIngredient.note,
      display: line,
      title: null,
      originalText: line,
      referenceId: randomUUID(),
    };

    const resolvedUnit = await resolveUnit(mergedIngredient.unit);
    const resolvedFood = await resolveFood(mergedIngredient.food);

    if (mergedIngredient.unit && !resolvedUnit) {
      ingredientWarnings.push(`Could not resolve Mealie unit for "${line}". The unit field was left empty.`);
    }

    if (mergedIngredient.food && !resolvedFood) {
      ingredientWarnings.push(`Could not resolve Mealie food for "${line}". The food field was left empty.`);
    }

    mergedIngredient.unit = resolvedUnit;
    mergedIngredient.food = resolvedFood;

    recipeIngredient.push(mergedIngredient);

    if (parserWeak) {
      ingredientWarnings.push(
        llmIngredient.food?.name || llmIngredient.unit?.name
          ? `Mealie ingredient parser was weak for "${line}", so AI ingredient structure was used as fallback.`
          : parsed.warning!
      );
    }
  }

  const recipeInstructions: MealieInstructionInput[] = recipe.recipeInstructions.map((step) => ({
    id: randomUUID(),
    title: step.title?.trim() || "",
    summary: "",
    text: step.text,
    ingredientReferences: [],
  }));

  return {
    payload: {
      name: recipe.name,
      description: recipe.description,
      recipeServings: recipe.recipeServings ?? 0,
      prepTime: toIsoDurationOrNull(recipe.prepTime),
      cookTime: toIsoDurationOrNull(recipe.cookTime),
      totalTime: toIsoDurationOrNull(recipe.totalTime),
      recipeIngredient,
      recipeInstructions,
      recipeCategory: [],
      tags: [],
      nutrition: recipe.nutrition,
      orgURL: originalUrl,
    },
    ingredientWarnings,
  };
}

// -------------------------------------------------------------------------
// Step 1: Create a recipe shell (just the name)
// -------------------------------------------------------------------------

interface CreateRecipeResponse {
  // Mealie returns just the slug string for POST /api/recipes
  // but the actual response might vary — handle both
  slug?: string;
}

export async function createRecipeShell(name: string): Promise<string> {
  // POST /api/recipes returns the slug as a plain string (not JSON object in some versions)
  const url = `${config.mealieUrl}/api/recipes`;
  const res = await fetch(url, {
    method: "POST",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify({ name }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    throw new Error(`Mealie create recipe → ${res.status} ${res.statusText}: ${text}`);
  }

  const text = await res.text();

  // Mealie returns the slug as a bare JSON string: "my-recipe-slug"
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === "string") return parsed;
    if (typeof parsed === "object" && parsed !== null && "slug" in parsed) {
      return (parsed as CreateRecipeResponse).slug!;
    }
  } catch {
    // text might be a plain string without quotes
    return text.trim().replace(/^"|"$/g, "");
  }

  throw new Error(`Unexpected response from Mealie create recipe: ${text}`);
}

// -------------------------------------------------------------------------
// Step 2: Upload thumbnail image
// -------------------------------------------------------------------------

export async function uploadRecipeImage(
  slug: string,
  imageFilePath: string
): Promise<void> {
  const url = `${config.mealieUrl}/api/recipes/${slug}/image`;

  const imageBuffer = await readFile(imageFilePath);
  const fileName = basename(imageFilePath);

  // Determine MIME type from extension
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "jpg";
  const mimeMap: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
  };
  const mimeType = mimeMap[ext] ?? "image/jpeg";

  const formData = new FormData();
  formData.append("image", new Blob([imageBuffer], { type: mimeType }), fileName);
  formData.append("extension", ext);

  const res = await fetch(url, {
    method: "PUT",
    headers: headers(), // no Content-Type — let browser/node set multipart boundary
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    // Non-fatal: log but don't throw — recipe can still be imported without thumbnail
    console.warn(`[mealie] Image upload failed for ${slug}: ${res.status} ${text}`);
  }
}

// -------------------------------------------------------------------------
// Step 3: Patch recipe with full data
// -------------------------------------------------------------------------

export async function updateRecipe(
  slug: string,
  preparedImport: PreparedRecipeImport
): Promise<string> {
  // PATCH returns the updated recipe object, we extract the final slug from it
  interface RecipeResponse {
    slug: string;
  }

  const payload = preparedImport.payload;

  let updated: RecipeResponse;
  try {
    updated = await mealieRequest<RecipeResponse>("PATCH", `/api/recipes/${slug}`, payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes("Recipe already exists")) {
      throw err;
    }

    const uniqueSuffix = Date.now().toString(36).slice(-4);
    const retryPayload = {
      ...payload,
      name: `${payload.name} (${uniqueSuffix})`,
    };

    updated = await mealieRequest<RecipeResponse>("PATCH", `/api/recipes/${slug}`, retryPayload);
  }

  return updated.slug ?? slug;
}

// -------------------------------------------------------------------------
// Convenience: full import flow
// -------------------------------------------------------------------------

export interface ImportResult {
  slug: string;
  recipeUrl: string;
}

export async function importRecipe(params: {
  preparedImport: PreparedRecipeImport;
  thumbnailFilePath?: string;
}): Promise<ImportResult> {
  const { preparedImport, thumbnailFilePath } = params;

  // 1. Create shell
  const slug = await createRecipeShell(preparedImport.payload.name);
  console.log(`[mealie] Created recipe shell: ${slug}`);

  // 2. Upload thumbnail (non-fatal on failure)
  if (thumbnailFilePath) {
    try {
      await uploadRecipeImage(slug, thumbnailFilePath);
      console.log(`[mealie] Uploaded thumbnail for: ${slug}`);
    } catch (err) {
      console.warn(`[mealie] Thumbnail upload skipped: ${err instanceof Error ? err.message : err}`);
    }
  }

  // 3. Update with full recipe data
  const finalSlug = await updateRecipe(slug, preparedImport);
  console.log(`[mealie] Updated recipe: ${finalSlug}`);

  return {
    slug: finalSlug,
    recipeUrl: await buildRecipeUrl(finalSlug),
  };
}
