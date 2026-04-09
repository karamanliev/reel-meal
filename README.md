# ReelMeal

Turn YouTube, Instagram, and TikTok cooking videos into Mealie recipes.

Paste a link, let ReelMeal pull the metadata and transcript, then send the cleaned-up recipe straight into your Mealie instance.

## Screenshots

<p align="center">
  <img src="./screenshot_desktop.png" alt="ReelMeal desktop screenshot" width="78%" />
  <img src="./screenshot_mobile.png" alt="ReelMeal mobile screenshot" width="20%" />
</p>

## What it does

- pulls title, description, thumbnail, and transcript from supported video links
- parses the result into a structured recipe with an LLM
- optionally translates to English
- optionally imports the recipe directly into Mealie
- lets you add a short custom parser prompt per run

## Stack

- React + Vite frontend
- Hono backend
- `yt-dlp` + `ffmpeg` for media extraction
- OpenAI-compatible API for parsing and transcription fallback
- Mealie for final recipe import

## Requirements

- Node.js 22+
- `ffmpeg`
- `yt-dlp`
- a Mealie instance
- an OpenAI-compatible API key

## Quick start

```bash
cp .env.example .env
npm install
npm install --prefix client
npm run dev
```

Open:

- frontend: `http://localhost:5173`
- backend: `http://localhost:3000`

## Docker

Build it yourself:

```bash
docker compose up --build
```

Or run the published image from GitHub Container Registry:

```bash
docker run --rm -p 3000:3000 --env-file .env ghcr.io/karamanliev/reel-meal:latest
```

If you prefer Compose with the published image:

```yaml
services:
  reel-meal:
    image: ghcr.io/karamanliev/reel-meal:latest
    ports:
      - "3000:3000"
    env_file:
      - .env
    restart: unless-stopped
```

## Environment

Required:

- `OPENAI_API_KEY`
- `MEALIE_URL`
- `MEALIE_API_TOKEN`

Common optional settings:

- `OPENAI_BASE_URL`
- `OPENAI_MODEL`
- `TRANSCRIPTION_MODEL`
- `WHISPER_API_URL`
- `WHISPER_TIMEOUT_MS`
- `SKIP_LOCAL_WHISPER`
- `PORT`

See `.env.example` for the full list.

## Instagram notes

Instagram often needs cookies. If a link works in your browser but not in ReelMeal, export a `cookies.txt` file for `yt-dlp` and place it in the project root.

Example:

```bash
yt-dlp --cookies-from-browser chrome --cookies cookies.txt "https://www.instagram.com/reel/abc123/"
```

Swap `chrome` for `firefox`, `edge`, or `chromium` if needed.

## Build

```bash
npm run build
npm start
```

## Supported sources

- YouTube
- Instagram reels and posts
- TikTok
- other sites supported by `yt-dlp`
