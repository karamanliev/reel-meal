export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function normalizeEmptyText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

export function normalizeComparableValue(value: unknown): unknown {
  if (value == null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  return value;
}

export function formatNumber(value: number): string {
  return String(value);
}

export function humanizeIsoDuration(value: string): string {
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
  if (hours) parts.push(`${hours} hr`);
  if (minutes) parts.push(`${minutes} min`);
  if (seconds && parts.length === 0) parts.push(`${seconds} sec`);

  return parts.join(" ") || trimmed;
}

export function formatVideoDuration(value: number): string {
  const totalSeconds = Math.max(0, Math.round(value));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];

  if (hours) parts.push(`${hours} hr`);
  if (minutes) parts.push(`${minutes} min`);
  if (seconds && hours === 0) parts.push(`${seconds} sec`);

  return parts.join(" ") || "0 sec";
}

export function formatTimeValue(value: unknown): string {
  return typeof value === "string" && value.trim()
    ? humanizeIsoDuration(value)
    : "";
}

export function hasMeaningfulValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

export function pickPreferredValue(
  primary: unknown,
  fallback: unknown
): unknown {
  return hasMeaningfulValue(primary) ? primary : fallback;
}

export function getNamedValue(
  value: unknown
): { name: string; id: string | null } {
  if (!isRecord(value)) return { name: "", id: null };
  return {
    name: typeof value.name === "string" ? value.name.trim() : "",
    id: typeof value.id === "string" ? value.id : null,
  };
}

export function getSectionTitle(value: unknown): string {
  return normalizeEmptyText(isRecord(value) ? value.title : value);
}

export function formatDiffValue(value: unknown): string {
  if (value == null) return "not set";
  if (typeof value === "string") return value.trim() || "not set";
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function sameJson(a: unknown, b: unknown): boolean {
  return (
    JSON.stringify(normalizeComparableValue(a)) ===
    JSON.stringify(normalizeComparableValue(b))
  );
}

export function formatIngredientPreview(
  ingredient: Record<string, unknown>
): string {
  const display = normalizeEmptyText(ingredient.display);
  if (display) return display;

  const parts = [
    typeof ingredient.quantity === "number"
      ? formatNumber(ingredient.quantity)
      : "",
    getNamedValue(ingredient.unit).name,
    getNamedValue(ingredient.food).name,
    normalizeEmptyText(ingredient.note),
  ].filter(Boolean);

  return (
    parts.join(" ") ||
    normalizeEmptyText(ingredient.originalText) ||
    "Ingredient"
  );
}

export function getIngredients(value: unknown): Record<string, unknown>[] {
  if (!isRecord(value) || !Array.isArray(value.recipeIngredient)) return [];
  return value.recipeIngredient.filter(isRecord);
}

export function getInstructions(value: unknown): Record<string, unknown>[] {
  if (!isRecord(value) || !Array.isArray(value.recipeInstructions)) return [];
  return value.recipeInstructions.filter(isRecord);
}
