export const MAX_SOURCE_IMAGES = 10;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_SOURCE_IMAGE_BYTES = 50 * 1024 * 1024;
export const MAX_MODEL_INPUT_CHARS = 100_000;
export const MAX_CUSTOM_PROMPT_CHARS = 400;
export const MAX_MULTIPART_BYTES = 62 * 1024 * 1024;

export type SubmittedSource =
  | { kind: "url"; url: string }
  | { kind: "text"; text: string }
  | { kind: "images"; assetIds: string[] };

export type ResolvedSourceType = "video" | "webpage" | "text" | "images";

export function isExactHttpUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function normalizeModelText(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
}

export function assertModelInputLength(value: string): string {
  const normalized = normalizeModelText(value);
  if (!normalized) throw new Error("Recipe source is empty.");
  if (normalized.length > MAX_MODEL_INPUT_CHARS) {
    throw new Error(
      `Recipe source exceeds the ${MAX_MODEL_INPUT_CHARS.toLocaleString()} character limit. Content is not truncated.`,
    );
  }
  return normalized;
}

export function buildTextModelInput(params: {
  sourceType: string;
  title: string;
  description: string;
  attributionUrl: string;
  extractionMethod: string;
  body: string;
  customPrompt?: string;
}): string {
  const custom = params.customPrompt?.trim()
    ? `\n\nAdditional User Instructions:\n${params.customPrompt.trim()}\n\nApply these additional instructions only if they do not conflict with the schema or rules above.`
    : "";
  return assertModelInputLength(`Source type: ${params.sourceType}\nTitle: ${params.title}\nDescription: ${params.description || "(none)"}\nAttribution URL: ${params.attributionUrl || "(none)"}\nExtraction method: ${params.extractionMethod}\n\nSource content:\n${params.body}${custom}`);
}
