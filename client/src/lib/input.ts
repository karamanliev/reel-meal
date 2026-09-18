export const MAX_SOURCE_IMAGES = 10;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
export function isExactHttpUrl(value: string): boolean { const trimmed = value.trim(); if (!trimmed || /\s/.test(trimmed)) return false; try { const url = new URL(trimmed); return ["http:", "https:"].includes(url.protocol); } catch { return false; } }
export function validateSourceFiles(files: File[]): string | null { if (files.length > MAX_SOURCE_IMAGES) return "Choose no more than 10 source images."; if (files.some((file) => !ACCEPTED_IMAGE_TYPES.includes(file.type))) return "Only JPEG, PNG, WebP, and GIF images are supported."; if (files.some((file) => file.size > MAX_IMAGE_BYTES)) return "Each image must be 10 MB or smaller."; if (files.reduce((sum, file) => sum + file.size, 0) > MAX_SOURCE_BYTES) return "Source images must total 50 MB or less."; return null; }
