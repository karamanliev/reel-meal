import test from "node:test";
import assert from "node:assert/strict";
import type { ParsedRecipe } from "./llm.js";
import { prepareRecipeImport } from "./mealie.js";

function recipe(nutrition?: ParsedRecipe["nutrition"]): ParsedRecipe {
  return { name: "Toast", description: "Toast", recipeIngredient: [{ originalText: "bread" }], recipeInstructions: [{ text: "Toast it." }], nutrition };
}

test("Mealie payload contains only the four complete nutrition fields", async () => {
  const prepared = await prepareRecipeImport(recipe({ calories: "187 kcal", proteinContent: "12.4 g", carbohydrateContent: "8.1 g", fatContent: "10.7 g", fiberContent: "3 g" }), "");
  assert.deepEqual(prepared.payload.nutrition, { calories: "187 kcal", proteinContent: "12.4 g", carbohydrateContent: "8.1 g", fatContent: "10.7 g" });
});

test("Mealie payload omits missing or incomplete nutrition", async () => {
  assert.equal("nutrition" in (await prepareRecipeImport(recipe(), "")).payload, false);
  assert.equal("nutrition" in (await prepareRecipeImport(recipe({ calories: "100 kcal" }), "")).payload, false);
});

test("an unrelated single food search result is not substituted for the requested food", async () => {
  const previousFetch = globalThis.fetch;
  const requests: Array<{ method: string; url: string; body?: unknown }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const url = String(input);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    requests.push({ method, url, body });
    if (method === "GET" && url.includes("/api/foods?")) {
      return Response.json({ items: [{ id: "chicken-id", name: "boneless skinless chicken breast" }] });
    }
    if (method === "POST" && url.endsWith("/api/foods")) {
      return Response.json({ id: "turkey-id", name: "turkey thigh" });
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  }) as typeof fetch;

  try {
    const turkeyRecipe: ParsedRecipe = {
      name: "Turkey nuggets",
      description: "",
      recipeIngredient: [{ quantity: 570, unit: null, food: { name: "turkey thigh" }, note: "boneless and skinless", originalText: "570 g boneless, skinless turkey thigh" }],
      recipeInstructions: [{ text: "Bake the nuggets." }],
    };
    const prepared = await prepareRecipeImport(turkeyRecipe, "");
    assert.deepEqual(prepared.payload.recipeIngredient[0].food, { id: "turkey-id", name: "turkey thigh" });
    assert.deepEqual(requests.find((request) => request.method === "POST")?.body, { name: "turkey thigh" });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("a confidently similar food matches despite punctuation, word order, and a minor typo", async () => {
  const previousFetch = globalThis.fetch;
  const requests: Array<{ method: string; url: string }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const url = String(input);
    requests.push({ method, url });
    if (method === "GET" && url.includes("/api/foods?")) {
      return Response.json({ items: [
        { id: "chicken-id", name: "boneless skinless chicken breast" },
        { id: "existing-turkey-id", name: "skinless bonless turkey thigh" },
      ] });
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  }) as typeof fetch;

  try {
    const turkeyRecipe: ParsedRecipe = {
      name: "Turkey nuggets",
      description: "",
      recipeIngredient: [{ quantity: 570, unit: null, food: { name: "boneless, skinless turkey thigh" }, originalText: "570 g boneless, skinless turkey thigh" }],
      recipeInstructions: [{ text: "Bake the nuggets." }],
    };
    const prepared = await prepareRecipeImport(turkeyRecipe, "");
    assert.deepEqual(prepared.payload.recipeIngredient[0].food, { id: "existing-turkey-id", name: "skinless bonless turkey thigh" });
    assert.equal(requests.some((request) => request.method === "POST"), false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
