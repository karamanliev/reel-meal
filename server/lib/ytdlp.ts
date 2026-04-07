import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, unlink, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";

const execFileAsync = promisify(execFile);

export interface VideoMetadata {
  title: string;
  description: string;
  thumbnailUrl: string;
  duration: number; // seconds
  uploader: string;
  webpageUrl: string;
  hasSubtitles: boolean;
}

export interface SubtitleResult {
  text: string;
  source: "subtitles";
}

export interface AudioResult {
  filePath: string;
  cleanup: () => Promise<void>;
}

function ytdlp(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("yt-dlp", args, { maxBuffer: 50 * 1024 * 1024 });
}

function chooseBestTitle(data: Record<string, unknown>): string {
  const rawTitle = String(data.title ?? "").trim();
  const description = String(data.description ?? "");
  const uploader = String(data.uploader ?? data.channel ?? "").trim().toLowerCase();
  const lowerTitle = rawTitle.toLowerCase();

  const genericTitle =
    !rawTitle ||
    lowerTitle.startsWith("video by ") ||
    lowerTitle.startsWith("post by ") ||
    lowerTitle === uploader;

  if (!genericTitle) return rawTitle;

  const lines = description
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !line.startsWith("#"));

  if (!lines.length) return rawTitle || "Untitled Recipe";

  let title = lines[0];
  if (lines[1] && title.length < 60 && !/[.!?]$/.test(title)) {
    const combined = `${title} ${lines[1]}`.replace(/\s+/g, " ").trim();
    if (combined.length <= 110) {
      title = combined;
    }
  }

  return title;
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

  const data = JSON.parse(stdout);

  // yt-dlp returns an array of thumbnail objects, pick the best one
  const thumbnail =
    data.thumbnail ||
    (Array.isArray(data.thumbnails) && data.thumbnails.length > 0
      ? // prefer the last (usually highest quality) thumbnail
        data.thumbnails[data.thumbnails.length - 1]?.url
      : null);

  // Check if subtitles are available (auto-generated or manual)
  const hasSubtitles =
    (data.subtitles && Object.keys(data.subtitles).length > 0) ||
    (data.automatic_captions && Object.keys(data.automatic_captions).length > 0);

  return {
    title: chooseBestTitle(data),
    description: data.description || "",
    thumbnailUrl: thumbnail || "",
    duration: data.duration || 0,
    uploader: data.uploader || data.channel || "",
    webpageUrl: data.webpage_url || url,
    hasSubtitles: Boolean(hasSubtitles),
  };
}

/**
 * Try to extract subtitles/captions from a video (YouTube auto-captions, etc.)
 * without downloading the video itself.
 * Returns null if no subtitles are available.
 */
export async function extractSubtitles(url: string): Promise<SubtitleResult | null> {
  const workDir = await mkdtemp(join(tmpdir(), "recipe-subs-"));

  try {
    await ytdlp([
      "--skip-download",
      "--write-auto-subs",
      "--write-subs",
      "--sub-langs", "en.*,en",
      "--sub-format", "vtt/srt/best",
      "--convert-subs", "vtt",
      "--no-playlist",
      "--output", join(workDir, "subs"),
      url,
    ]);

    // Find the downloaded subtitle file
    const files = await readdir(workDir);
    const vttFile = files.find((f) => f.endsWith(".vtt"));

    if (!vttFile) return null;

    const raw = await readFile(join(workDir, vttFile), "utf-8");
    const text = parseVtt(raw);

    if (!text.trim()) return null;

    return { text, source: "subtitles" };
  } catch {
    // No subtitles available or yt-dlp error
    return null;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

/**
 * Download audio-only from a video URL.
 * Returns the path to the downloaded MP3 file and a cleanup function.
 */
export async function downloadAudio(url: string): Promise<AudioResult> {
  const workDir = await mkdtemp(join(tmpdir(), "recipe-audio-"));
  const outputTemplate = join(workDir, "audio.%(ext)s");

  try {
    await ytdlp([
      "--no-playlist",
      "-x",
      "--audio-format", "mp3",
      "--audio-quality", "5", // ~128kbps, good enough for transcription
      "--output", outputTemplate,
      url,
    ]);

    // Find the output file
    const files = await readdir(workDir);
    const audioFile = files.find((f) => f.startsWith("audio."));

    if (!audioFile) {
      throw new Error("yt-dlp did not produce an audio file");
    }

    const filePath = join(workDir, audioFile);

    return {
      filePath,
      cleanup: async () => {
        await rm(workDir, { recursive: true, force: true });
      },
    };
  } catch (err) {
    // Clean up on error
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
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
  const workDir = await mkdtemp(join(tmpdir(), "recipe-thumb-"));
  const filePath = join(workDir, "thumbnail.jpg");

  const response = await fetch(thumbnailUrl);
  if (!response.ok) {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
    throw new Error(`Failed to download thumbnail: ${response.status} ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile(filePath, Buffer.from(buffer))
  );

  return {
    filePath,
    cleanup: async () => {
      await rm(workDir, { recursive: true, force: true });
    },
  };
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
    const cleaned = trimmed
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&nbsp;/g, " ")
      .trim();

    if (!cleaned) continue;

    // Deduplicate consecutive identical lines (common in auto-captions)
    if (cleaned !== lastLine) {
      textLines.push(cleaned);
      lastLine = cleaned;
    }
  }

  return textLines.join(" ");
}
