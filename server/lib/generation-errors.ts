export class IncompleteRecipeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IncompleteRecipeError";
  }
}

export function isRetryableGenerationError(error: unknown): boolean {
  return !(error instanceof IncompleteRecipeError);
}
