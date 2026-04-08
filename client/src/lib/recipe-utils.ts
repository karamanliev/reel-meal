import type {
  ParsingDetails,
  RecipeFact,
  NutritionEntry,
  ParsingDiff,
  DiffEntry,
  IngredientDiff,
} from "./types";
import {
  isRecord,
  normalizeEmptyText,
  formatNumber,
  formatTimeValue,
  pickPreferredValue,
  formatDiffValue,
  getNamedValue,
  getIngredients,
  sameJson,
} from "./formatters";

export function buildRecipeFacts(details: ParsingDetails): RecipeFact[] {
  const parsedRecipe = isRecord(details.parsedRecipe)
    ? details.parsedRecipe
    : {};
  const importPayload = isRecord(details.importPayload)
    ? details.importPayload
    : {};

  const facts: RecipeFact[] = [];
  const recipeServings = pickPreferredValue(
    importPayload.recipeServings,
    parsedRecipe.recipeServings
  );
  const prepTime = pickPreferredValue(
    importPayload.prepTime,
    parsedRecipe.prepTime
  );
  const cookTime = pickPreferredValue(
    importPayload.cookTime,
    parsedRecipe.cookTime
  );
  const totalTime = pickPreferredValue(
    importPayload.totalTime,
    parsedRecipe.totalTime
  );

  if (typeof recipeServings === "number") {
    facts.push({ label: "Servings", value: formatNumber(recipeServings) });
  }

  const prepTimeValue = formatTimeValue(prepTime);
  if (prepTimeValue) facts.push({ label: "Prep time", value: prepTimeValue });

  const cookTimeValue = formatTimeValue(cookTime);
  if (cookTimeValue) facts.push({ label: "Cook time", value: cookTimeValue });

  const totalTimeValue = formatTimeValue(totalTime);
  if (totalTimeValue)
    facts.push({ label: "Total time", value: totalTimeValue });

  return facts;
}

export function getNutritionEntries(
  details: ParsingDetails
): NutritionEntry[] {
  const parsedRecipe = isRecord(details.parsedRecipe)
    ? details.parsedRecipe
    : {};
  const importPayload = isRecord(details.importPayload)
    ? details.importPayload
    : {};
  const nutrition = pickPreferredValue(
    importPayload.nutrition,
    parsedRecipe.nutrition
  );
  if (!isRecord(nutrition)) return [];

  const fields: Array<[key: string, label: string]> = [
    ["calories", "Calories"],
    ["proteinContent", "Protein"],
    ["fatContent", "Fat"],
    ["carbohydrateContent", "Carbs"],
    ["fiberContent", "Fiber"],
    ["sugarContent", "Sugar"],
    ["sodiumContent", "Sodium"],
  ];

  return fields
    .map(([key, label]) => ({
      label,
      value: normalizeEmptyText(nutrition[key]),
    }))
    .filter((entry) => entry.value);
}

export function buildParsingDiff(details: ParsingDetails): ParsingDiff {
  const parsedRecipe = isRecord(details.parsedRecipe)
    ? details.parsedRecipe
    : {};
  const importPayload = isRecord(details.importPayload)
    ? details.importPayload
    : {};

  const recipeChanges: DiffEntry[] = [];
  const recipeFields: Array<[key: string, label: string]> = [
    ["recipeServings", "Servings"],
    ["prepTime", "Prep time"],
    ["cookTime", "Cook time"],
    ["totalTime", "Total time"],
    ["recipeCategory", "Categories"],
    ["tags", "Tags"],
    ["nutrition", "Nutrition"],
    ["orgURL", "Source URL"],
  ];

  for (const [key, label] of recipeFields) {
    const before = parsedRecipe[key];
    const after = importPayload[key];
    if (!sameJson(before, after)) {
      const isTimeField =
        key === "prepTime" || key === "cookTime" || key === "totalTime";
      recipeChanges.push({
        label,
        before: isTimeField
          ? formatTimeValue(before) || "not set"
          : formatDiffValue(before),
        after: isTimeField
          ? formatTimeValue(after) || "not set"
          : formatDiffValue(after),
      });
    }
  }

  const parsedIngredients = getIngredients(parsedRecipe);
  const importedIngredients = getIngredients(importPayload);
  const ingredientChanges: IngredientDiff[] = [];

  for (
    let index = 0;
    index < Math.max(parsedIngredients.length, importedIngredients.length);
    index += 1
  ) {
    const parsedIngredient = parsedIngredients[index] ?? {};
    const importedIngredient = importedIngredients[index] ?? {};
    const title =
      (typeof importedIngredient.originalText === "string" &&
        importedIngredient.originalText) ||
      (typeof parsedIngredient.originalText === "string" &&
        parsedIngredient.originalText) ||
      `Ingredient ${index + 1}`;

    const changes: DiffEntry[] = [];

    if (!sameJson(parsedIngredient.quantity, importedIngredient.quantity)) {
      changes.push({
        label: "Quantity",
        before: formatDiffValue(parsedIngredient.quantity),
        after: formatDiffValue(importedIngredient.quantity),
      });
    }

    const parsedUnit = getNamedValue(parsedIngredient.unit);
    const importedUnit = getNamedValue(importedIngredient.unit);
    if (parsedUnit.name !== importedUnit.name) {
      changes.push({
        label: "Unit",
        before: parsedUnit.name || "none",
        after: importedUnit.name || "none",
      });
    } else if (parsedUnit.name && importedUnit.id) {
      changes.push({
        label: "Unit linked",
        before: parsedUnit.name,
        after: `${importedUnit.name} (${importedUnit.id.slice(0, 8)}...)`,
      });
    }

    const parsedFood = getNamedValue(parsedIngredient.food);
    const importedFood = getNamedValue(importedIngredient.food);
    if (parsedFood.name !== importedFood.name) {
      changes.push({
        label: "Food",
        before: parsedFood.name || "none",
        after: importedFood.name || "none",
      });
    } else if (parsedFood.name && importedFood.id) {
      changes.push({
        label: "Food linked",
        before: parsedFood.name,
        after: `${importedFood.name} (${importedFood.id.slice(0, 8)}...)`,
      });
    }

    const parsedNote = normalizeEmptyText(parsedIngredient.note);
    const importedNote = normalizeEmptyText(importedIngredient.note);
    if (parsedNote !== importedNote) {
      changes.push({
        label: "Note",
        before: parsedNote || "empty",
        after: importedNote || "empty",
      });
    }

    if (changes.length > 0) {
      ingredientChanges.push({ title, changes });
    }
  }

  const importedFoodLinks = importedIngredients.filter(
    (ingredient) => getNamedValue(ingredient.food).id
  ).length;
  const importedUnitLinks = importedIngredients.filter(
    (ingredient) => getNamedValue(ingredient.unit).id
  ).length;

  return {
    summary: [
      { label: "Foods linked", value: String(importedFoodLinks) },
      { label: "Units linked", value: String(importedUnitLinks) },
      { label: "Recipe changes", value: String(recipeChanges.length) },
      {
        label: "Ingredients changed",
        value: String(ingredientChanges.length),
      },
    ],
    recipeChanges,
    ingredientChanges,
  };
}
