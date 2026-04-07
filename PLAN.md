# Mealie Recipe Parser — Plan

## Overview

A self-hosted web application that takes a recipe video link (YouTube, Instagram) and automatically parses it into a structured recipe, importing it into a Mealie instance.

## Stack

| Layer | Choice |
|---|---|
| Frontend | Vite + React + TypeScript |
| Backend | Hono (Node.js) |
| Styling | Plain CSS / CSS Modules |
| Structure | Flat (Hono serves Vite build in production) |
| Video extraction | yt-dlp + ffmpeg |
| Transcription primary | Local Whisper (OpenAI-compatible API) with configurable timeout |
| Transcription fallback | Gemini via OpenRouter (separate `TRANSCRIPTION_MODEL`) |
| LLM parsing | Configurable model via OpenRouter (`OPENAI_MODEL`) |
| Concurrency | Sequential with lock (single job at a time) |
| Temp files | /tmp, cleanup after each job |
| Thumbnails | Download server-side, upload to Mealie |
| Review before import | No — direct import, edit in Mealie |
| Error handling | Show failed step + retry button on frontend |
| Deployment | Docker Compose |

## Environment Variables (`.env`)

```bash
# LLM (Recipe parsing)
OPENAI_API_KEY=sk-or-...
OPENAI_BASE_URL=https://openrouter.ai/api/v1
OPENAI_MODEL=google/gemini-2.5-flash

# Transcription fallback (must support audio input)
TRANSCRIPTION_MODEL=google/gemini-2.5-flash

# Local Whisper server (primary transcription, optional)
WHISPER_API_URL=http://192.168.x.x:8080/v1/audio/transcriptions
WHISPER_TIMEOUT_MS=15000

# Mealie
MEALIE_URL=http://mealie.local:9925
MEALIE_API_TOKEN=mea_...
```

## Project Structure

```
mealie-recipe-parser/
├── src/
│   ├── client/              # Vite React app
│   │   ├── App.tsx
│   │   ├── App.module.css
│   │   ├── main.tsx
│   │   └── index.html
│   └── server/              # Hono backend
│       ├── index.ts         # Hono app entry + static file serving
│       ├── routes/
│       │   └── parse.ts     # SSE endpoint: orchestrates full pipeline
│       └── lib/
│           ├── ytdlp.ts     # yt-dlp wrapper (metadata, subtitles, audio)
│           ├── transcribe.ts # Whisper + Gemini fallback
│           ├── llm.ts       # LLM recipe JSON generation
│           ├── mealie.ts    # Mealie API client
│           └── config.ts    # Env var loading + validation
├── .env.example
├── Dockerfile
├── docker-compose.yml
├── vite.config.ts
├── tsconfig.json
└── package.json
```

## Pipeline

Each step streams an SSE event to the frontend:

```
1. → { step: "metadata",   status: "loading" }
   yt-dlp --dump-json → title, description, thumbnail URL
   → { step: "metadata",   status: "done", data: { title, thumbnailUrl } }

2. → { step: "transcript", status: "loading" }
   Try: yt-dlp --write-auto-subs --skip-download (YouTube only)
   Fallback: yt-dlp -x --audio-format mp3 → try local Whisper (with WHISPER_TIMEOUT_MS)
             → on timeout/error: send audio to TRANSCRIPTION_MODEL via OpenRouter
   → { step: "transcript", status: "done" }

3. → { step: "parsing",    status: "loading" }
   LLM: transcript + description + title → Mealie recipe JSON (retry up to 2x on invalid JSON)
   → { step: "parsing",    status: "done" }

4. → { step: "importing",  status: "loading" }
   POST /api/recipes { name }              → get slug
   Download thumbnail → PUT /api/recipes/{slug}/image
   PATCH /api/recipes/{slug}               → full recipe data
   → { step: "importing",  status: "done", data: { recipeUrl } }
```

On any step failure: stream `{ step, status: "error", error: "..." }` and stop.
Frontend shows the failed step and a retry button.

## Mealie API

- **Auth:** `Authorization: Bearer <MEALIE_API_TOKEN>` (long-lived token from Mealie UI)
- **Create shell:** `POST /api/recipes` with `{ "name": "..." }` → returns slug
- **Upload image:** `PUT /api/recipes/{slug}/image` multipart with `image` field
- **Full update:** `PATCH /api/recipes/{slug}` with full recipe object

### Recipe JSON Schema (key fields)

```json
{
  "name": "string",
  "description": "string",
  "orgURL": "string",
  "recipeServings": 4,
  "prepTime": "PT20M",
  "cookTime": "PT40M",
  "totalTime": "PT1H",
  "recipeIngredient": [
    { "quantity": 2, "unit": { "name": "cup" }, "food": { "name": "flour" }, "note": "sifted", "originalText": "2 cups sifted flour" }
  ],
  "recipeInstructions": [
    { "title": "", "text": "Step text here." }
  ],
  "recipeCategory": [{ "name": "Dinner" }],
  "tags": [{ "name": "Italian" }],
  "nutrition": {
    "calories": "320 kcal",
    "proteinContent": "18 g"
  }
}
```

## Frontend UX

1. **Input state:** URL text field + "Import Recipe" button
2. **Loading state:**
   - Recipe title + thumbnail shown as soon as metadata is fetched
   - Step progress indicator:
     - Fetching video info...
     - Extracting transcript...
     - Generating recipe...
     - Importing to Mealie...
3. **Error state:** Shows which step failed + error message + Retry button
4. **Done state:** Auto-redirect to the recipe in Mealie

## Docker

```dockerfile
FROM node:22-alpine
RUN apk add --no-cache python3 py3-pip ffmpeg && pip3 install yt-dlp
```

```yaml
services:
  mealie-recipe-parser:
    build: .
    ports:
      - "3000:3000"
    env_file: .env
    restart: unless-stopped
```

## Todo List

- [ ] Project scaffolding: Vite React + Hono backend, TypeScript, flat structure
- [ ] Environment config: .env.example with all variables documented
- [ ] Backend: config.ts — env var loading and validation
- [ ] Backend: ytdlp.ts — metadata fetch, subtitle extraction, audio download
- [ ] Backend: transcribe.ts — local Whisper with timeout + Gemini fallback
- [ ] Backend: llm.ts — LLM recipe JSON generation with retry logic
- [ ] Backend: mealie.ts — Mealie API client (create, upload image, patch)
- [ ] Backend: parse.ts — SSE route orchestrating the full pipeline
- [ ] Backend: index.ts — Hono app entry, static serving, job lock
- [ ] Frontend: App.tsx — URL input, progress steps, error handling, redirect
- [ ] Frontend: App.module.css — minimal clean styling
- [ ] Vite config with API proxy for dev
- [ ] Dockerfile + docker-compose.yml
