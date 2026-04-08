# Mealie Recipe Parser

A self-hosted web app that imports recipes from YouTube and Instagram videos into [Mealie](https://mealie.io).

Paste a video URL → the app fetches the transcript, runs it through an LLM, and imports a structured recipe directly into your Mealie instance.

## How it works

1. **Metadata** — `yt-dlp` fetches the video title, description, and thumbnail
2. **Transcript** — YouTube auto-captions are used when available; otherwise the audio is downloaded and transcribed via your local Whisper server (with a configurable timeout) or a Gemini model via OpenRouter as fallback
3. **Recipe parsing** — An LLM (configurable via OpenRouter) converts the transcript + description into a structured Mealie recipe JSON
4. **Import** — The recipe is created in Mealie with the thumbnail uploaded; you're redirected to the recipe when done

## Stack

- **Frontend:** Vite + React + TypeScript
- **Backend:** Hono (Node.js)
- **Video extraction:** yt-dlp + ffmpeg
- **Deployment:** Docker Compose

## Configuration

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

| Variable | Description |
|---|---|
| `OPENAI_API_KEY` | Your OpenRouter (or OpenAI) API key |
| `OPENAI_BASE_URL` | API base URL — default `https://openrouter.ai/api/v1` |
| `OPENAI_MODEL` | Model for recipe parsing — default `google/gemini-2.5-flash` |
| `TRANSCRIPTION_MODEL` | Audio-capable model for transcription fallback — default `google/gemini-2.5-flash` |
| `WHISPER_API_URL` | Optional — URL to a local OpenAI-compatible Whisper server |
| `WHISPER_TIMEOUT_MS` | How long to wait for local Whisper before falling back — default `15000` |
| `SKIP_LOCAL_WHISPER` | Optional — set to `true` to skip local Whisper entirely and always use remote transcription |
| `MEALIE_URL` | URL to your Mealie instance e.g. `http://mealie.local:9925` |
| `MEALIE_API_TOKEN` | Long-lived API token from Mealie → Profile → API Tokens |
| `PORT` | Server port — default `3000` |

## Running

### Docker Compose (recommended)

```bash
docker compose up --build
```

App will be available at `http://your-server:3000`.

### Development

Requires Node.js 22+, Python 3, `yt-dlp`, and `ffmpeg` installed locally.

```bash
# Install dependencies
npm install
npm install --prefix client

# Start server + Vite dev server concurrently
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3000`

## Cookies (Instagram, etc.)

Instagram and some other sites require authentication. The app supports passing cookies to `yt-dlp` automatically.

**Setup:**

1. Log into Instagram in your browser
2. Export cookies using one of these methods:
   - **Without extensions** — run `yt-dlp --cookies-from-browser chrome --cookies cookies.txt <any-instagram-url>` (replace `chrome` with `firefox`/`edge`/`chromium` as needed)
   - **With a browser extension** — use something like "Get cookies.txt LOCALLY" and save the file
3. Place the `cookies.txt` file in the project root — it's auto-detected on startup

The server log will confirm: `yt-dlp cookies: /path/to/cookies.txt`

The file is already in `.gitignore`. You can also set `YTDLP_COOKIES_FILE=/custom/path/cookies.txt` in `.env` to use a different location.

## Supported sources

- YouTube (uses auto-captions when available, skipping audio download entirely)
- Instagram Reels / posts (requires cookies — see above)
- Any source supported by yt-dlp
