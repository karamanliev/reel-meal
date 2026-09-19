import test from "node:test";
import assert from "node:assert/strict";
import { extractWebpageDocument } from "./webpage.js";

test("extracts Recipe JSON-LD from direct objects, arrays, and graphs", () => {
  const html = `<!doctype html><title>Best Soup</title><script type="application/ld+json">{"@graph":[{"@type":"Recipe","name":"Other","recipeIngredient":["water"],"recipeInstructions":[{"text":"Boil."}]},{"@type":"Recipe","name":"Best Soup","description":"Good","recipeIngredient":["1 cup water","1 carrot"],"recipeInstructions":[{"text":"Boil water."},{"text":"Add carrot."}],"image":"/soup.jpg"}]}</script>`;
  const result = extractWebpageDocument(html, "https://example.com/recipe");
  assert.equal(result.extractionMethod, "json-ld"); assert.equal(result.title, "Best Soup"); assert.equal(result.imageUrl, "https://example.com/soup.jpg");
});

test("uses Readability and rejects unreadable static pages", () => {
  const readable = extractWebpageDocument(`<html><head><title>Bread</title></head><body><article><h1>Bread</h1><p>${"Mix flour and water, knead the dough, then bake until golden. ".repeat(8)}</p></article></body></html>`, "https://example.com/bread");
  assert.equal(readable.extractionMethod, "readability");
  assert.throws(() => extractWebpageDocument("<html><body><div>Login</div></body></html>", "https://example.com/private"), /no readable/);
});

test("skips a higher-ranked incomplete Recipe node", () => {
  const html = `<!doctype html><title>Soup</title><script type="application/ld+json">{"@graph":[{"@type":"Recipe","name":"Soup","recipeIngredient":["water"]},{"@type":"Recipe","name":"Complete Soup","recipeIngredient":["water"],"recipeInstructions":[{"text":"Boil."}]}]}</script>`;
  const result = extractWebpageDocument(html, "https://example.com/soup");
  assert.equal(result.extractionMethod, "json-ld"); assert.equal(result.title, "Complete Soup");
});
