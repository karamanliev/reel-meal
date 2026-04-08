import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import OpenAI from "openai";
import { config } from "./config.js";

/**
 * Transcribe an audio file.
 *
 * Strategy:
 * 1. If WHISPER_API_URL is configured, try the local Whisper server with a timeout.
 * 2. On timeout or any error, fall back to the remote TRANSCRIPTION_MODEL via OpenRouter.
 */
export async function transcribeAudio(audioFilePath: string): Promise<string> {
  if (config.skipLocalWhisper) {
    console.log("[transcribe] SKIP_LOCAL_WHISPER is enabled, using remote transcription.");
  } else if (config.whisperApiUrl) {
    try {
      console.log(`[transcribe] Trying local Whisper at ${config.whisperApiUrl}...`);
      const text = await transcribeWithWhisper(audioFilePath, config.whisperApiUrl);
      console.log("[transcribe] Local Whisper succeeded.");
      return text;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`[transcribe] Local Whisper failed (${reason}), falling back to remote...`);
    }
  }

  console.log(`[transcribe] Using remote transcription model: ${config.transcriptionModel}`);
  return transcribeWithGemini(audioFilePath);
}

/**
 * Transcribe using an OpenAI-compatible Whisper server.
 * Throws if the request takes longer than WHISPER_TIMEOUT_MS.
 */
async function transcribeWithWhisper(
  audioFilePath: string,
  whisperUrl: string
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, config.whisperTimeoutMs);

  try {
    // Build the base URL by stripping the path suffix
    const baseUrl = whisperUrl.replace(/\/v1\/audio\/transcriptions\/?$/, "");

    const client = new OpenAI({
      apiKey: "whisper", // local server typically doesn't need a real key
      baseURL: baseUrl + "/v1",
      timeout: config.whisperTimeoutMs,
    });

    const audioBuffer = await readFile(audioFilePath);
    const audioFile = new File([audioBuffer], basename(audioFilePath), {
      type: "audio/mpeg",
    });

    const response = await client.audio.transcriptions.create(
      {
        model: "whisper-1",
        file: audioFile,
        response_format: "text",
      },
      { signal: controller.signal }
    );

    if (typeof response === "string") return response;
    return (response as { text: string }).text;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Transcribe audio using a Gemini-family model via OpenRouter.
 * Sends the audio file as a base64-encoded inline data part.
 */
async function transcribeWithGemini(audioFilePath: string): Promise<string> {
  const client = new OpenAI({
    apiKey: config.openaiApiKey,
    baseURL: config.openaiBaseUrl,
  });

  const audioBuffer = await readFile(audioFilePath);
  const base64Audio = audioBuffer.toString("base64");

  // OpenRouter supports audio input via the content parts API
  const response = await client.chat.completions.create({
    model: config.transcriptionModel,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Please transcribe this audio file verbatim. Output only the transcription text, nothing else.",
          },
          {
            type: "input_audio",
            input_audio: {
              data: base64Audio,
              format: "mp3",
            },
          },
        ],
      },
    ],
  });

  const text = response.choices[0]?.message?.content;
  if (!text) throw new Error("Transcription model returned an empty response");
  return text;
}
