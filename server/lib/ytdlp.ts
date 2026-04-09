import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, readdir, rm, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { config } from "./config.js";

const execFileAsync = promisify(execFile);

export interface VideoMetadata {
  title: string;
  description: string;
  thumbnailUrl: string;
  duration: number; // seconds
  uploader: string;
  webpageUrl: string;
  hasSubtitles: boolean;
  subtitleLanguage: string | null;
}

export interface SubtitleResult {
  text: string;
  source: "subtitles";
}

function getSubtitleLanguages(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];

  return Object.entries(value as Record<string, unknown>)
    .filter(([, formats]) => Array.isArray(formats) && formats.length > 0)
    .map(([language]) => language)
    .filter(Boolean);
}

function expandLanguageVariants(code: string): string[] {
  const normalized = code.trim().toLowerCase().replace(/_/g, "-");
  if (!normalized) return [];

  const variants = new Set<string>();
  const withoutSuffix = normalized.replace(/-(orig|auto)$/i, "");
  variants.add(normalized);
  variants.add(withoutSuffix);

  const primary = withoutSuffix.split("-")[0];
  if (primary) variants.add(primary);

  return [...variants].filter(Boolean);
}

function findMatchingSubtitleLanguage(
  availableLanguages: string[],
  preferredLanguage: string | null
): string | null {
  if (!preferredLanguage) return null;

  const preferredVariants = new Set(expandLanguageVariants(preferredLanguage));
  for (const language of availableLanguages) {
    const languageVariants = expandLanguageVariants(language);
    if (languageVariants.some((variant) => preferredVariants.has(variant))) {
      return language;
    }
  }

  return null;
}

function selectManualSubtitleLanguage(data: Record<string, unknown>): string | null {
  const manualSubtitleLanguages = getSubtitleLanguages(data.subtitles);
  if (manualSubtitleLanguages.length === 0) return null;

  const languageCandidates = [data.language, data.release_language, data.language_preference]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  for (const candidate of languageCandidates) {
    const matchedLanguage = findMatchingSubtitleLanguage(manualSubtitleLanguages, candidate);
    if (matchedLanguage) return matchedLanguage;
  }

  return null;
}

export interface AudioResult {
  filePath: string;
  cleanup: () => Promise<void>;
}

function ytdlp(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const finalArgs = config.ytdlpCookiesFile
    ? ["--cookies", config.ytdlpCookiesFile, ...args]
    : args;
  return execFileAsync("yt-dlp", finalArgs, { maxBuffer: 50 * 1024 * 1024 });
}

/**
 * Create a temp directory and return its path with a cleanup function.
 */
async function createTempDir(prefix: string): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  return {
    dir,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

/**
 * Create a temp directory, run `fn` with its path, and always clean up afterward.
 * On success returns `fn`'s result; on error cleans up then re-throws.
 */
async function withTempDir<T>(
  prefix: string,
  fn: (dir: string) => Promise<T>
): Promise<T> {
  const { dir, cleanup } = await createTempDir(prefix);
  try {
    return await fn(dir);
  } finally {
    await cleanup().catch(() => {});
  }
}

function isGenericTitle(title: string, uploader: string): boolean {
  if (!title) return true;
  const lower = title.toLowerCase();
  return (
    /^video\s+\d+$/i.test(title) ||
    lower.startsWith("video by ") ||
    lower.startsWith("post by ") ||
    lower === uploader
  );
}

function isInstagramPostUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return /instagram\.com\/p\//i.test(value);
}

function extractTitleFromDescription(description: string): string | null {
  const lines = description
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  if (!lines.length) return null;

  const firstLine = lines[0];
  const recipePhraseMatch = firstLine.match(/(?:these|this|my|our)\s+(.+?)(?:[.!?]|$)/i);
  if (recipePhraseMatch) {
    const cleaned = recipePhraseMatch[1]
      .replace(/\s+all\s+for\s+.+$/i, "")
      .replace(/\s+by\s+@\S+.*$/i, "")
      .replace(/\s+/g, " ")
      .trim();

    if (cleaned.length >= 6 && cleaned.length <= 90) return cleaned;
  }

  let title = firstLine;
  if (lines[1] && title.length < 60 && !/[.!?]$/.test(title)) {
    const combined = `${title} ${lines[1]}`.replace(/\s+/g, " ").trim();
    if (combined.length <= 110) {
      title = combined;
    }
  }

  return title;
}

async function enrichInstagramPostMetadata(
  url: string,
  data: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const hasUsefulDescription = typeof data.description === "string" && data.description.trim().length > 0;
  const uploader = String(data.uploader ?? data.channel ?? "").trim().toLowerCase();
  const hasUsefulTitle = !isGenericTitle(String(data.title ?? "").trim(), uploader);

  if (hasUsefulDescription && hasUsefulTitle) return data;
  if (!isInstagramPostUrl(data.webpage_url ?? url)) return data;

  const { stdout } = await ytdlp(["-J", url]);
  const playlistData = JSON.parse(stdout) as Record<string, unknown>;

  if (playlistData._type !== "playlist") return data;

  return {
    ...playlistData,
    ...data,
    title: hasUsefulTitle ? data.title : playlistData.title ?? data.title,
    description: hasUsefulDescription ? data.description : playlistData.description ?? data.description,
    uploader: data.uploader ?? playlistData.uploader,
    channel: data.channel ?? playlistData.channel,
    webpage_url: data.webpage_url ?? playlistData.webpage_url,
  };
}

function chooseBestTitle(data: Record<string, unknown>): string {
  const rawTitle = String(data.title ?? "").trim();
  const description = String(data.description ?? "");
  const uploader = String(data.uploader ?? data.channel ?? "").trim().toLowerCase();

  if (!isGenericTitle(rawTitle, uploader)) return rawTitle;

  return extractTitleFromDescription(description) || rawTitle || "Untitled Recipe";
}

function decodeVttEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

/**
 * Fetch video metadata (title, description, thumbnail, etc.) without downloading.
 */
export async function fetchMetadata(url: string): Promise<VideoMetadata> {
  const { stdout } = await ytdlp([
    "--dump-json",
    "--no-playlist",
    url,
  ]);

  const initialData = JSON.parse(stdout) as Record<string, unknown>;
  const data = await enrichInstagramPostMetadata(url, initialData);

  // yt-dlp returns an array of thumbnail objects, pick the best one
  const thumbnail =
    data.thumbnail ||
    (Array.isArray(data.thumbnails) && data.thumbnails.length > 0
      ? // prefer the last (usually highest quality) thumbnail
        data.thumbnails[data.thumbnails.length - 1]?.url
      : null);

  const subtitleLanguage = selectManualSubtitleLanguage(data);

  return {
    title: chooseBestTitle(data),
    description: data.description || "",
    thumbnailUrl: thumbnail || "",
    duration: data.duration || 0,
    uploader: data.uploader || data.channel || "",
    webpageUrl: data.webpage_url || url,
    hasSubtitles: Boolean(subtitleLanguage),
    subtitleLanguage,
  };
}

/**
 * Try to extract manually provided subtitles in the same language as the video
 * without downloading the video itself.
 * Returns null if no suitable manual subtitles are available.
 */
export async function extractSubtitles(
  url: string,
  subtitleLanguage: string
): Promise<SubtitleResult | null> {
  try {
    return await withTempDir("recipe-subs-", async (workDir) => {
      await ytdlp([
        "--skip-download",
        "--write-subs",
        "--sub-langs", subtitleLanguage,
        "--sub-format", "vtt/srt/best",
        "--convert-subs", "vtt",
        "--no-playlist",
        "--output", join(workDir, "subs"),
        url,
      ]);

      const files = await readdir(workDir);
      const vttFile = files.find((f) => f.endsWith(".vtt"));

      if (!vttFile) return null;

      const raw = await readFile(join(workDir, vttFile), "utf-8");
      const text = parseVtt(raw);

      if (!text.trim()) return null;

      return { text, source: "subtitles" as const };
    });
  } catch {
    // No suitable manual subtitles available or yt-dlp error
    return null;
  }
}

/**
 * Download audio-only from a video URL.
 * Returns the path to the downloaded MP3 file and a cleanup function.
 */
export async function downloadAudio(url: string): Promise<AudioResult> {
  const { dir: workDir, cleanup } = await createTempDir("recipe-audio-");

  try {
    await ytdlp([
      "--no-playlist",
      "-x",
      "--audio-format", "mp3",
      "--audio-quality", "5", // ~128kbps, good enough for transcription
      "--output", join(workDir, "audio.%(ext)s"),
      url,
    ]);

    const files = await readdir(workDir);
    const audioFile = files.find((f) => f.startsWith("audio."));

    if (!audioFile) {
      throw new Error("yt-dlp did not produce an audio file");
    }

    return { filePath: join(workDir, audioFile), cleanup };
  } catch (err) {
    await cleanup().catch(() => {});
    throw err;
  }
}

/**
 * Download thumbnail image to a temp file.
 * Returns the path and a cleanup function.
 */
export async function downloadThumbnail(
  thumbnailUrl: string
): Promise<{ filePath: string; cleanup: () => Promise<void> }> {
  const { dir: workDir, cleanup } = await createTempDir("recipe-thumb-");

  try {
    const response = await fetch(thumbnailUrl);
    if (!response.ok) {
      throw new Error(`Failed to download thumbnail: ${response.status} ${response.statusText}`);
    }

    const buffer = await response.arrayBuffer();
    const filePath = join(workDir, "thumbnail.jpg");
    await writeFile(filePath, Buffer.from(buffer));

    return { filePath, cleanup };
  } catch (err) {
    await cleanup().catch(() => {});
    throw err;
  }
}

/**
 * Parse a WebVTT subtitle file into plain text.
 * Removes timestamps, cue settings, and duplicate lines.
 */
function parseVtt(vtt: string): string {
  const lines = vtt.split("\n");
  const textLines: string[] = [];
  let lastLine = "";

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip WEBVTT header, NOTE blocks, timestamps, and empty lines
    if (
      trimmed === "WEBVTT" ||
      trimmed.startsWith("NOTE") ||
      trimmed.startsWith("STYLE") ||
      trimmed.includes("-->") ||
      trimmed === ""
    ) {
      continue;
    }

    // Skip pure numeric cue IDs
    if (/^\d+$/.test(trimmed)) continue;

    // Remove VTT tags like <00:00:00.000>, <c>, </c>, etc.
    const cleaned = decodeVttEntities(trimmed.replace(/<[^>]+>/g, "")).trim();

    if (!cleaned) continue;

    // Deduplicate consecutive identical lines (common in auto-captions)
    if (cleaned !== lastLine) {
      textLines.push(cleaned);
      lastLine = cleaned;
    }
  }

  return textLines.join(" ");
}
