import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { config } from "./config.js";
import type { ParsedRecipe } from "./llm.js";

// -------------------------------------------------------------------------
// Mealie API client
// -------------------------------------------------------------------------

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    Authorization: `Bearer ${config.mealieApiToken}`,
    ...extra,
  };
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
    throw new Error(`Mealie API ${method} ${path} → ${res.status} ${res.statusText}: ${text}`);
  }

  // 204 No Content
  if (res.status === 204) return undefined as T;

  return res.json() as Promise<T>;
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
  recipe: ParsedRecipe,
  originalUrl: string
): Promise<string> {
  // PATCH returns the updated recipe object, we extract the final slug from it
  interface RecipeResponse {
    slug: string;
  }

  const payload = {
    ...recipe,
    orgURL: originalUrl,
  };

  const updated = await mealieRequest<RecipeResponse>(
    "PATCH",
    `/api/recipes/${slug}`,
    payload
  );

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
  recipe: ParsedRecipe;
  originalUrl: string;
  thumbnailFilePath?: string;
}): Promise<ImportResult> {
  const { recipe, originalUrl, thumbnailFilePath } = params;

  // 1. Create shell
  const slug = await createRecipeShell(recipe.name);
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
  const finalSlug = await updateRecipe(slug, recipe, originalUrl);
  console.log(`[mealie] Updated recipe: ${finalSlug}`);

  return {
    slug: finalSlug,
    recipeUrl: `${config.mealieUrl}/recipe/${finalSlug}`,
  };
}
