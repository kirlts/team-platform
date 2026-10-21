# syntax=docker/dockerfile:1

# Stage 1: panel. Builds panel/ if it exists; otherwise leaves an empty directory.
# The whole context is copied because COPY fails when panel/ does not exist.
FROM node:24-alpine AS panel
WORKDIR /ctx
COPY . /ctx
RUN mkdir -p /out \
 && if [ -f panel/package.json ]; then \
      cd panel \
      && if [ -f package-lock.json ]; then npm ci; else npm install; fi \
      && npm run build \
      && cp -r dist/. /out/; \
    fi

# Stage 2: the server's production dependencies.
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN mkdir -p node_modules \
 && if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi \
 && npm cache clean --force

# Final stage. ffmpeg from Alpine's repository (report 06, section 1.2).
# The image includes the ffmpeg binary with its package's license.
FROM node:24-alpine
LABEL org.opencontainers.image.title="team-platform" \
      org.opencontainers.image.licenses="MIT"
RUN apk add --no-cache ffmpeg
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/data \
    PANEL_DIR=/app/panel/dist
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY templates ./templates
COPY --from=panel /out ./panel/dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
# Startup cadence: --start-period covers the measured startup (2 s with the filler;
# the real core adds its migrations) and --start-interval keeps `up --wait` from waiting for
# the normal 30 s cadence. These are convenience values; they do not govern operation.
HEALTHCHECK --start-period=15s --start-interval=1s CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/health" || exit 1
# Exec form: node is PID 1 and receives SIGTERM directly.
CMD ["node", "src/server.js"]
