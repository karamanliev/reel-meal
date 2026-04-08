# Mealie Recipe Parser Agent Memory

## Purpose

This repository is a self-hosted app that turns recipe videos into structured Mealie recipes.

Primary flow:

1. User pastes a YouTube or Instagram URL.
2. Backend fetches metadata with `yt-dlp`.
3. Backend gets transcript from subtitles when possible, otherwise by audio transcription.
4. LLM converts the content into structured recipe JSON.
5. Backend prepares a Mealie-safe import payload.
6. Recipe is either imported immediately or held for manual review/import.

## Current Product State

The app is working end-to-end for the main intended use case.

Implemented features:

- YouTube import support
- Instagram import support via `yt-dlp` cookies
- Manual same-language subtitle extraction for YouTube when available
- Audio download + transcription fallback when subtitles are unavailable
- Optional local Whisper first, remote transcription fallback second
- `SKIP_LOCAL_WHISPER=true` support to force remote transcription
- LLM recipe parsing via OpenAI-compatible API / OpenRouter
- Servings and nutrition extraction only when explicitly present in the source
- Human-readable recipe times for import and UI display
- Optional grouped ingredients and grouped instructions using Mealie section titles
- Optional translation to English
- Optional short custom prompt that adds extra user instructions on top of the built-in parser prompt
- Mealie recipe creation, thumbnail upload, and final patch/update
- Ingredient normalization for Mealie with food/unit ID resolution
- Manual review flow with `Auto import` toggle
- Parsing debug/details UI with diff-first import preview, recipe fact cards, nutrition cards, and grouped preview sections
- Single-job lock to avoid concurrent imports
- Docker + docker-compose deployment

## Important Behavior

### Import modes

- `Auto import` enabled:
  - `/api/parse` runs the full pipeline and imports automatically.
- `Auto import` disabled:
  - `/api/parse` stops after parsing/preparing the Mealie payload.
  - Frontend enters review mode.
  - User can inspect the exact JSON payload.
  - User clicks `Import now`, which sends the prepared payload to `POST /api/import`.

### Transcript modes

- If `extractTranscript=true`, the app uses subtitles only when they are manual and match the video's language metadata.
- Auto-generated subtitles are intentionally ignored.
- If suitable subtitles are unavailable, audio is downloaded and transcribed.
- If `extractTranscript=false`, the app tries to parse from metadata/description only.
- Description-only parsing is blocked unless there appears to be enough recipe context.

### Recipe extraction and grouping

- `recipeServings` should only be kept when explicitly stated in the source.
- Yield fields were intentionally removed; the product currently keeps servings only.
- `nutrition` should only be kept when explicitly stated in the source.
- `prepTime`, `cookTime`, and `totalTime` should be stored as human-readable text like `35 minutes`, not ISO duration strings.
- If the model still returns ISO duration text, import preparation normalizes it to readable text before sending to Mealie.
- Instruction steps should prefer fewer, more meaningful chunks instead of many tiny atomic steps.
- Grouped ingredients/instructions should only be used when the source explicitly names recipe components or phases.
- For Mealie section semantics, only the first ingredient/instruction item in a section should carry the `title`; following items in the same section should leave `title` empty.

### Custom prompt behavior

- The frontend has a `Custom prompt` checkbox, unchecked by default.
- When enabled, it reveals a textarea for additional parser instructions.
- These instructions do not replace the system prompt; they are appended as supplemental user guidance.
- If the checkbox is turned off after typing, the text is preserved in the UI state and restored when re-enabled.
- The custom prompt is sent only when enabled and non-empty.
- Because `/api/parse` currently uses `EventSource` with a `GET` request, the custom prompt is intentionally limited to a short length.

### Ingredient import strategy

This part was reworked and is important.

- The LLM is trusted to produce structured ingredients: `quantity`, `unit`, `food`, `note`, `originalText`.
- Before importing into Mealie, every `food` and `unit` is resolved to an existing or newly created Mealie entity.
- Imported ingredients should use ID-backed `food` / `unit` objects.
- `display` is intentionally sent as `""` so Mealie auto-generates it.
- Missing quantity should be `null`, not `0`.
- Unit names should preserve the source recipe's language/script instead of being normalized into English.
- Unit resolution is intentionally stricter than food resolution: units use exact-name matching only, so `мл` does not get silently matched to `milliliter`.
- When food/unit resolution fails, information is preserved in `note` and warnings are surfaced.

### Mealie API quirk that mattered

- Search endpoints for foods/units return paginated results under `items`, not `data`.
- A prior bug came from reading `response.data`, which made resolution fail silently.

### Instagram / cookies

- `yt-dlp` calls automatically use `YTDLP_COOKIES_FILE` if set.
- If not set, the app auto-detects `cookies.txt` in the project root.
- `cookies.txt` is intentionally gitignored.

## Architecture

### Backend

- Framework: Hono on Node.js
- Entry: `server/index.ts`
- Main API router: `server/routes/parse.ts`
- Static production serving: Hono serves `client/dist`

### Frontend

- React + TypeScript + Vite
- Main UI lives almost entirely in `client/src/App.tsx`
- Styling is in `client/src/App.module.css`

### Deployment

- Multi-stage Docker build
- `docker-compose.yml` runs the app with `.env` and a writable tmpfs at `/tmp`

## Runtime Pipeline

### `GET /api/parse`

Streams SSE events for these steps:

1. `metadata`
2. `transcript`
3. `parsing`
4. `importing`

Each step emits `loading`, then either `done` or `error`.

Main pipeline inside `server/routes/parse.ts`:

1. `fetchMetadata(url)`
2. optionally `extractSubtitles(url)`
3. otherwise `downloadAudio(url)` + `transcribeAudio(filePath)`
4. `parseRecipeFromTranscript(...)`
5. `prepareRecipeImport(recipe, originalUrl)`
6. if auto-import is on, `runRecipeImport(...)`

### `POST /api/import`

Used only by the manual-review flow.

- Expects a prepared `importPayload`
- Optionally accepts `ingredientWarnings`
- Optionally accepts `thumbnailUrl`
- Reuses the same import helper as the automatic flow

### `GET /api/thumbnail`

- Proxies remote thumbnail URLs through the backend so the frontend can display them reliably.

## Key Files And Folders

### Top level

- `package.json`
  - Root scripts for dev, build, start, and typecheck.
  - Starts backend and client dev servers together.
- `README.md`
  - User-facing setup and run instructions.
- `.env.example`
  - Documents required and optional configuration.
- `Dockerfile`
  - Builds the client, compiles the server, installs `yt-dlp` and `ffmpeg`.
- `docker-compose.yml`
  - Runs the app container with `.env` and tmpfs-backed `/tmp`.
- `.gitignore`
  - Includes `cookies.txt` among ignored runtime files.
- `cookies.txt`
  - Optional local runtime file for authenticated `yt-dlp` access. Not committed.
- `.env`
  - Local runtime configuration. Do not read or copy secret values into agent notes.

### `server/`

- `server/index.ts`
  - Hono app bootstrap.
  - CORS for local Vite dev.
  - Health endpoint.
  - Static serving of frontend build.
  - Startup logging for Mealie URL, model choices, Whisper mode, and cookies detection.

### `server/routes/`

- `server/routes/parse.ts`
  - Main orchestration route.
  - Defines SSE event shape.
  - Enforces single-job lock with `jobRunning`.
  - Handles metadata fetch, transcript extraction/transcription, LLM parse, import prep, and final import.
  - Accepts an optional short `customPrompt` query parameter for supplemental parser instructions.
  - Contains the manual import endpoint.
  - Contains thumbnail proxy endpoint.
  - Contains the metadata-only recipe-context heuristic for when transcript extraction is disabled.

### `server/lib/`

- `server/lib/config.ts`
  - Manually loads `.env` without `dotenv`.
  - Validates required env vars.
  - Parses numeric and boolean env values.
  - Auto-detects `cookies.txt`.
  - Exposes typed runtime config.

- `server/lib/ytdlp.ts`
  - Thin wrapper around `yt-dlp`.
  - Fetches metadata.
  - Extracts subtitles.
  - Downloads audio.
  - Downloads thumbnails to temp files.
  - Adds `--cookies` automatically when configured.
  - Only uses manual subtitles that match the video language metadata.
  - Contains a title-normalization fallback for generic social titles.

- `server/lib/transcribe.ts`
  - Chooses transcription path.
  - Uses local Whisper first when configured, unless `SKIP_LOCAL_WHISPER=true`.
  - Falls back to remote audio-capable model through OpenAI-compatible API.

- `server/lib/llm.ts`
  - Defines parsed recipe types.
  - Holds the system prompt for recipe extraction.
  - Has strict ingredient-structuring rules, especially around quantity/unit/food/note separation.
  - Instructs the model to keep servings/nutrition only when explicit, omit yield, prefer readable times, and only group when sections are explicit in the source.
  - Accepts optional supplemental user instructions without replacing the system prompt.
  - Retries if the LLM returns invalid JSON.
  - Optionally translates output into English.

- `server/lib/mealie.ts`
  - Mealie API client and import-preparation logic.
  - Resolves or creates foods and units.
  - Caches food/unit lookups during import.
  - Converts parsed recipe into the payload expected by Mealie.
  - Preserves ingredient section titles for Mealie grouped ingredients.
  - Preserves unresolved ingredient data in `note`.
  - Normalizes recipe times to readable text before import.
  - Creates recipe shell, uploads image, patches final recipe, and returns final recipe URL.

### `client/`

- `client/package.json`
  - Vite/React scripts.
- `client/vite.config.ts`
  - Dev server on `5173`.
  - Proxies `/api` to backend on `3000`.
- `client/index.html`
  - Vite HTML entry.

### `client/src/`

- `client/src/main.tsx`
  - React entry point.
- `client/src/index.css`
  - Very small global reset/base styles.
- `client/src/App.tsx`
  - Main UI and almost all client behavior.
  - URL form and toggles.
  - Includes the optional `Custom prompt` checkbox and textarea for extra parser instructions.
  - SSE connection management.
  - Step state tracking.
  - Metadata/transcript/parsing detail panels.
  - Diff-first parsing/import preview.
  - Shows recipe details, nutrition cards, grouped ingredients/instructions, and subtitle-language metadata in the review UI.
  - Manual review/import flow.
  - Success/error states.

- `client/src/App.module.css`
  - Main styling for the entire interface.
  - Includes form layout, checkbox row spacing, step list, details panels, diff cards, review panel, and banners.

## API Contract Summary

### `GET /api/health`

- Returns basic status and timestamp.

### `GET /api/parse`

Query params:

- `url` required
- `translate=true|false`
- `extractTranscript=true|false`
- `autoImport=true|false`
- `customPrompt=<short text>` optional

Returns:

- SSE stream of pipeline step events

### `POST /api/import`

JSON body:

- `importPayload` required
- `ingredientWarnings` optional
- `thumbnailUrl` optional

Returns:

- `recipeUrl`
- `slug`

### `GET /api/thumbnail`

Query params:

- `url` required

Returns:

- proxied image bytes with cache headers

## Config Variables In Use

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `OPENAI_MODEL`
- `TRANSCRIPTION_MODEL`
- `WHISPER_API_URL`
- `WHISPER_TIMEOUT_MS`
- `SKIP_LOCAL_WHISPER`
- `YTDLP_COOKIES_FILE`
- `MEALIE_URL`
- `MEALIE_API_TOKEN`
- `PORT`

## Constraints And Assumptions

- Only one parse/import job is allowed at a time.
- Temp audio/subtitle/thumbnail work is done under `/tmp` and cleaned up.
- The frontend assumes backend SSE event shape from `server/routes/parse.ts`.
- The client is intentionally simple and concentrated in one large component.
- The current Mealie payload intentionally leaves `recipeCategory` and `tags` empty at import time, even though the LLM can produce them.
- Missing `recipeServings` should stay missing; it is no longer forced to `0` during import preparation.
- Mealie displays stored time strings as-is, so readable times must be stored on import if the UI should show readable values.
- The custom prompt currently rides on the `GET /api/parse` query string, so it should stay short and should not be treated as private input.

## Known Gaps / Possible Next Work

- `README.md` does not yet fully document the manual review / `Auto import` flow.
- The client is mostly a single large component and could be split later if it becomes harder to maintain.
- Ingredient extraction is much better now, but occasional LLM oddities may still happen for noisy transcripts.
- Category/tag import is currently discarded in `prepareRecipeImport()` even though parsed data may exist.
- There are likely opportunities for more validation before `POST /api/import` accepts a prepared payload.
- Subtitle language matching depends on source metadata quality; some videos may still need audio fallback even when subtitles exist.

## Quick Orientation For A New Agent

If you need to change core behavior, start here:

1. `server/routes/parse.ts` for pipeline behavior and API contracts
2. `server/lib/mealie.ts` for anything related to import payload shape or Mealie compatibility
3. `server/lib/llm.ts` for extraction quality and prompt rules
4. `server/lib/transcribe.ts` and `server/lib/ytdlp.ts` for source acquisition/transcription issues
5. `client/src/App.tsx` for UI flow, manual review, and debug display

If a bug mentions ingredients importing incorrectly, inspect `server/lib/mealie.ts` first.

If a bug mentions Instagram failures, inspect cookies handling in `server/lib/config.ts` and `server/lib/ytdlp.ts` first.

If a bug mentions review/import UX, inspect `client/src/App.tsx` first.
