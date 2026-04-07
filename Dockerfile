# =============================================================================
# Mealie Recipe Parser — Dockerfile
# Multi-stage build: build frontend, then produce lean production image
# =============================================================================

# ---------------------------------------------------------------------------
# Stage 1: Build the Vite frontend
# ---------------------------------------------------------------------------
FROM node:22-alpine AS frontend-builder

WORKDIR /app/client

COPY client/package*.json ./
RUN npm ci

COPY client/ ./
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2: Production image
# ---------------------------------------------------------------------------
FROM node:22-alpine AS production

# Install system dependencies:
#   python3 + pip3 → yt-dlp
#   ffmpeg        → audio extraction (required by yt-dlp -x)
RUN apk add --no-cache python3 py3-pip ffmpeg && \
    pip3 install --break-system-packages yt-dlp

WORKDIR /app

# Install server dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy server source and compile
COPY tsconfig.server.json ./
COPY server/ ./server/
RUN npx tsc -p tsconfig.server.json

# Copy built frontend from stage 1
COPY --from=frontend-builder /app/client/dist ./client/dist

# Non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "dist/server/index.js"]
