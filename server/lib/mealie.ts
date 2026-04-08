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

function humanizeIsoDuration(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(
    /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i
  );
  if (!match) return trimmed;

  const [, daysText, hoursText, minutesText, secondsText] = match;
  const days = daysText ? Number(daysText) : 0;
  const hours = hoursText ? Number(hoursText) : 0;
  const minutes = minutesText ? Number(minutesText) : 0;
  const seconds = secondsText ? Math.round(Number(secondsText)) : 0;

  const parts: string[] = [];
  if (days) parts.push(`${days} day${days === 1 ? "" : "s"}`);
  if (hours) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  if (minutes) parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
  if (seconds && parts.length === 0) parts.push(`${seconds} second${seconds === 1 ? "" : "s"}`);

  return parts.join(" ") || trimmed;
}

function normalizeRecipeTime(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const isoDurationPattern = /^P(?=.+)(?:\d+Y)?(?:\d+M)?(?:\d+W)?(?:\d+D)?(?:T(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?$/i;
  return isoDurationPattern.test(trimmed) ? humanizeIsoDuration(trimmed) : trimmed;
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

// -------------------------------------------------------------------------
// Mealie ingredient types
//
// Mealie's PATCH endpoint requires food/unit to include an `id` that
// references an existing entity.  Sending { name: "..." } without an id
// causes a 500 ValueError in the auto_init DB layer (MANYTOONE lookup).
// Therefore we always resolve foods/units to ID-backed objects first.
//
// quantity: null means "no quantity" (e.g. "salt to taste").
//          0 is avoided — Mealie treats both as falsy for display, but
//          null is semantically correct.
//
// display:  "" lets Mealie auto-generate from structured fields with
//           proper fraction/plural/locale formatting.
// -------------------------------------------------------------------------

interface MealieIdValue {
  id: string;
  name: string;
}

interface MealieIngredientInput {
  quantity: number | null;
  unit: MealieIdValue | null;
  food: MealieIdValue | null;
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
  recipeServings?: number | null;
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

// -------------------------------------------------------------------------
// Food / Unit resolution with caching
//
// Flow: search by name -> if not found, create -> return { id, name }
// Cached per-import to avoid duplicate API calls for the same name.
// -------------------------------------------------------------------------

const foodCache = new Map<string, Promise<MealieIdValue | null>>();
const unitCache = new Map<string, Promise<MealieIdValue | null>>();

interface PaginatedResponse {
  items?: Array<{ id: string; name: string }>;
}

function normalizeLookupKey(value: string): string {
  return value.trim().toLowerCase();
}

async function lookupNamedValue(
  path: string,
  name: string,
  options?: { acceptSingleResult?: boolean }
): Promise<MealieIdValue | null> {
  const acceptSingleResult = options?.acceptSingleResult ?? true;
  const response = await mealieRequest<PaginatedResponse>(
    "GET",
    `${path}?search=${encodeURIComponent(name)}&perPage=50`
  );

  const items = response.items ?? [];

  // Exact (case-insensitive) match
  const exact = items.find(
    (item) => normalizeLookupKey(item.name) === normalizeLookupKey(name)
  );
  if (exact) return { id: exact.id, name: exact.name };

  // Accept first result if only one came back (close-enough match)
  if (acceptSingleResult && items.length === 1) {
    return { id: items[0].id, name: items[0].name };
  }

  return null;
}

async function createNamedValue(path: string, name: string): Promise<MealieIdValue | null> {
  try {
    const created = await mealieRequest<{ id: string; name: string }>("POST", path, { name });
    return { id: created.id, name: created.name };
  } catch {
    // Creation may fail if a race-condition duplicate exists — retry lookup
    return lookupNamedValue(path, name);
  }
}

function getCachedIdValue(
  cache: Map<string, Promise<MealieIdValue | null>>,
  path: string,
  name: string,
  options?: { acceptSingleResult?: boolean }
): Promise<MealieIdValue | null> {
  const key = normalizeLookupKey(name);
  let pending = cache.get(key);
  if (!pending) {
    pending = lookupNamedValue(path, name, options)
      .then((existing) => existing ?? createNamedValue(path, name))
      .catch((err) => {
        console.warn(`[mealie] Failed to resolve ${path} "${name}": ${err instanceof Error ? err.message : err}`);
        // Remove from cache so a retry can succeed next time
        cache.delete(key);
        return null;
      });
    cache.set(key, pending);
  }
  return pending;
}

async function resolveFood(name: string | undefined | null): Promise<MealieIdValue | null> {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  return getCachedIdValue(foodCache, "/api/foods", trimmed);
}

async function resolveUnit(name: string | undefined | null): Promise<MealieIdValue | null> {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  // Units should preserve the recipe's original language/script. Avoid fuzzy
  // single-result matches like "мл" -> "milliliter" and create the exact
  // unit name instead when Mealie does not already have it.
  return getCachedIdValue(unitCache, "/api/units", trimmed, { acceptSingleResult: false });
}

// -------------------------------------------------------------------------
// Build ingredient line from LLM output (for originalText)
// -------------------------------------------------------------------------

function buildOriginalText(ingredient: RecipeIngredient): string {
  const originalText = ingredient.originalText?.trim();
  if (originalText) return originalText;

  // Reconstruct from structured fields
  const parts = [
    typeof ingredient.quantity === "number" ? String(ingredient.quantity) : "",
    ingredient.unit?.name?.trim() ?? "",
    ingredient.food?.name?.trim() ?? "",
  ].filter(Boolean);

  const note = ingredient.note?.trim();
  if (note) parts.push(note);

  return parts.join(" ").trim();
}

// -------------------------------------------------------------------------
// Build note fallback when food/unit resolution fails
// -------------------------------------------------------------------------

function buildFallbackNote(
  originalNote: string,
  unresolvedFood: string | null,
  unresolvedUnit: string | null,
  quantity: number | null
): string {
  // When structured fields can't be resolved to Mealie IDs, preserve the
  // full ingredient info inside the note so nothing is lost.
  const parts: string[] = [];
  if (quantity != null) parts.push(String(quantity));
  if (unresolvedUnit) parts.push(unresolvedUnit);
  if (unresolvedFood) parts.push(unresolvedFood);
  if (originalNote) parts.push(originalNote);
  return parts.join(" ").trim();
}

async function buildRecipeUrl(slug: string): Promise<string> {
  return `${config.mealieUrl}/g/home/r/${slug}`;
}

// -------------------------------------------------------------------------
// Prepare recipe import payload
//
// Simplified flow:
//   1. Take LLM-parsed ingredient (quantity, unit, food, note)
//   2. Resolve food name -> Mealie food { id, name }
//   3. Resolve unit name -> Mealie unit { id, name }
//   4. If resolution fails, move unresolved info into note
//   5. Send display: "" so Mealie auto-formats from structured fields
// -------------------------------------------------------------------------

export async function prepareRecipeImport(
  recipe: ParsedRecipe,
  originalUrl: string
): Promise<PreparedRecipeImport> {
  const ingredientWarnings: string[] = [];
  const recipeIngredient: MealieIngredientInput[] = [];

  for (const ingredient of recipe.recipeIngredient) {
    const originalText = buildOriginalText(ingredient);
    if (!originalText) continue;

    const foodName = ingredient.food?.name?.trim() || null;
    const unitName = ingredient.unit?.name?.trim() || null;
    const quantity =
      typeof ingredient.quantity === "number" && Number.isFinite(ingredient.quantity)
        ? ingredient.quantity
        : null;
    const note = ingredient.note?.trim() || "";

    // Resolve food and unit to Mealie ID-backed entities
    const [resolvedFood, resolvedUnit] = await Promise.all([
      resolveFood(foodName),
      resolveUnit(unitName),
    ]);

    const foodFailed = Boolean(foodName && !resolvedFood);
    const unitFailed = Boolean(unitName && !resolvedUnit);

    // If both food and unit resolution failed, preserve everything in note
    // so the ingredient still shows meaningful text in Mealie.
    let finalNote = note;
    if (foodFailed || unitFailed) {
      const unresolvedFood = foodFailed ? foodName : null;
      const unresolvedUnit = unitFailed ? unitName : null;

      // Only build fallback note if we'd otherwise lose data
      if (foodFailed && unitFailed && !resolvedFood && !resolvedUnit) {
        finalNote = buildFallbackNote(note, unresolvedFood, unresolvedUnit, quantity);
      } else if (foodFailed) {
        // Append unresolved food name to note
        finalNote = [note, unresolvedFood].filter(Boolean).join(" — ");
      } else if (unitFailed) {
        // Append unresolved unit name to note
        finalNote = [unresolvedUnit, note].filter(Boolean).join(" ");
      }
    }

    if (foodFailed) {
      ingredientWarnings.push(
        `Could not resolve food "${foodName}" for "${originalText}". Info preserved in note.`
      );
    }
    if (unitFailed) {
      ingredientWarnings.push(
        `Could not resolve unit "${unitName}" for "${originalText}". Info preserved in note.`
      );
    }

    recipeIngredient.push({
      quantity: resolvedUnit || resolvedFood ? quantity : null,
      unit: resolvedUnit,
      food: resolvedFood,
      note: finalNote,
      display: "",          // Let Mealie auto-generate from structured fields
      title: ingredient.title?.trim() || null,
      originalText,
      referenceId: randomUUID(),
    });
  }

  const recipeServings =
    typeof recipe.recipeServings === "number" && Number.isFinite(recipe.recipeServings)
      ? recipe.recipeServings
      : null;

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
      ...(recipeServings != null ? { recipeServings } : {}),
      prepTime: normalizeRecipeTime(recipe.prepTime),
      cookTime: normalizeRecipeTime(recipe.cookTime),
      totalTime: normalizeRecipeTime(recipe.totalTime),
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
