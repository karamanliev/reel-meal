import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { assertModelInputLength } from "./input.js";
import { safeFetchBuffer } from "./safe-fetch.js";

export interface WebpageExtraction {
  title: string;
  description: string;
  body: string;
  canonicalUrl: string;
  extractionMethod: "json-ld" | "readability";
  selectedRecipe: string | null;
  imageUrl: string | null;
}

function flattenJsonLd(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (!value || typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  return [object, ...flattenJsonLd(object["@graph"] ?? [])];
}

function hasType(object: Record<string, unknown>, type: string): boolean {
  const raw = object["@type"];
  return (Array.isArray(raw) ? raw : [raw]).some((item) => typeof item === "string" && item.toLowerCase() === type.toLowerCase());
}

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join("\n");
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return text(object.text ?? object.name ?? object.itemListElement);
  }
  return "";
}

function imageUrl(value: unknown, base: string): string | null {
  const candidate = typeof value === "string" ? value : Array.isArray(value) ? imageUrl(value[0], base) : value && typeof value === "object" ? text((value as Record<string, unknown>).url ?? (value as Record<string, unknown>).contentUrl) : "";
  if (!candidate) return null;
  try { return new URL(candidate, base).href; } catch { return null; }
}

export function extractWebpageDocument(html: string, pageUrl: string): WebpageExtraction {
  const dom = new JSDOM(html, { url: pageUrl, runScripts: "outside-only" });
  const document = dom.window.document;
  const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href || pageUrl;
  const pageTitle = document.querySelector('meta[property="og:title"]')?.getAttribute("content")?.trim() || document.title.trim();
  const candidates: Record<string, unknown>[] = [];
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try { candidates.push(...flattenJsonLd(JSON.parse(script.textContent ?? "")).filter((item) => hasType(item, "Recipe"))); } catch { /* ignore malformed blocks */ }
  }
  const ranked = candidates
    .map((recipe, index) => ({ recipe, index, score: (text(recipe.name) === pageTitle ? 6 : 0) + (text(recipe.recipeIngredient).length ? 4 : 0) + (text(recipe.recipeInstructions).length ? 4 : 0) + (recipe.mainEntityOfPage ? 2 : 0) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const selected = ranked.find(({ recipe }) => text(recipe.recipeIngredient) && text(recipe.recipeInstructions))?.recipe;
  if (selected) {
    const ingredients = text(selected.recipeIngredient);
    const instructions = text(selected.recipeInstructions);
    if (ingredients && instructions) {
      const normalized = assertModelInputLength(JSON.stringify({
        name: text(selected.name), description: text(selected.description), recipeYield: selected.recipeYield,
        prepTime: selected.prepTime, cookTime: selected.cookTime, totalTime: selected.totalTime,
        author: text(selected.author), nutrition: selected.nutrition, recipeIngredient: selected.recipeIngredient,
        recipeInstructions: selected.recipeInstructions,
      }));
      return { title: text(selected.name) || pageTitle || "Recipe", description: text(selected.description), body: normalized, canonicalUrl: canonical, extractionMethod: "json-ld", selectedRecipe: text(selected.name) || null, imageUrl: imageUrl(selected.image, pageUrl) ?? imageUrl(document.querySelector('meta[property="og:image"]')?.getAttribute("content"), pageUrl) };
    }
  }
  const article = new Readability(document.cloneNode(true) as Document).parse();
  const body = article?.textContent ? assertModelInputLength(article.textContent) : "";
  if (!body || body.length < 100) throw new Error("This page has no readable static recipe content. JavaScript-only, paywalled, and login-only pages are unsupported.");
  return { title: article?.title || pageTitle || "Recipe page", description: article?.excerpt || "", body, canonicalUrl: canonical, extractionMethod: "readability", selectedRecipe: null, imageUrl: imageUrl(document.querySelector('meta[property="og:image"]')?.getAttribute("content"), pageUrl) };
}

export async function extractRecipeWebpage(url: string): Promise<WebpageExtraction> {
  const response = await safeFetchBuffer(url, { maxBytes: 5 * 1024 * 1024, timeoutMs: 12_000, contentTypes: ["text/html", "application/xhtml+xml"] });
  return extractWebpageDocument(response.buffer.toString("utf8"), response.finalUrl);
}
