# syntax=docker/dockerfile:1

# Etapa 1: panel. Compila panel/ si existe; si no, deja un directorio vacío.
# Se copia todo el contexto porque COPY falla cuando panel/ no existe.
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

# Stage 2: production dependencies of the server, pruned (report docs/investigaciones/mediciones/2026-10-20-imagen-docker.md).
# `--omit=optional` is NOT used: sharp ships its native binary as an optional dependency and would fail to load.
# npm already installs only the binary of the build platform (linuxmusl-x64 or linuxmusl-arm64).
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN mkdir -p node_modules \
 && if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi \
 && npm cache clean --force
RUN <<'PRUNE'
set -eu
cd /app/node_modules

# 1. Reachable only through officeparser and never loaded at runtime:
#    - OCR is off by default (`ocr: false` in officeparser/dist/defaults.js) and tesseract.js is imported
#      lazily inside the OCR worker factory, only when `config.ocr` is true; we never enable it.
#    - pdfjs-dist (and its optional @napi-rs/canvas) is imported lazily by officeparser's PDF parser only.
#      PDFs are routed to @hyzyla/pdfium in src/extract/document-core.js, and officeparser only receives zip files.
rm -rf tesseract.js tesseract.js-core zlibjs idb-keyval is-url node-fetch whatwg-url tr46 \
  webidl-conversions bmp-js regenerator-runtime wasm-feature-detect opencollective-postinstall \
  pdfjs-dist @napi-rs

# 2. Builds of other environments that Node never resolves (see each package.json "exports"/"main").
rm -f officeparser/dist/officeparser.browser*
rm -rf pdf-lib/es pdf-lib/dist pdf-lib/ts3.4 pdf-lib/src
rm -rf @opentelemetry/semantic-conventions/build/esm @opentelemetry/semantic-conventions/build/esnext
rm -f @hyzyla/pdfium/dist/index.cjs @hyzyla/pdfium/dist/index.esm.base64.js @hyzyla/pdfium/dist/index.esm.browser.js \
  @hyzyla/pdfium/dist/index.esm.cdn.js @hyzyla/pdfium/dist/index.esm.worker.js @hyzyla/pdfium/dist/pdfium.wasm.base64-*.js
rm -rf @mixmark-io/domino/test @mixmark-io/domino/.yarn

# 3. Types, source maps, docs and tests: no runtime effect. LICENSE files stay.
rm -rf @types
find . -type f \( -name '*.d.ts' -o -name '*.d.cts' -o -name '*.d.mts' -o -name '*.map' -o -name 'yarn.lock' \) -delete
find . -type f -name '*.md' ! -iname 'LICENSE*' -delete
for dir in test tests __tests__ docs examples benchmarks; do
  rm -rf ./*/"$dir" ./@*/*/"$dir"
done
PRUNE

# Final stage: plain Alpine with only the node binary from the official image. The official image
# also carries npm and yarn (about 23 MB) that the server never runs. Same Alpine release as node:24-alpine.
# ffmpeg from the Alpine repository (report 06, section 1.2); the image includes the ffmpeg binary under its package license.
FROM alpine:3.24
LABEL org.opencontainers.image.title="team-platform" \
      org.opencontainers.image.licenses="MIT"
RUN apk add --no-cache ffmpeg libstdc++ \
 && addgroup -g 1000 node \
 && adduser -u 1000 -G node -s /bin/sh -D node
COPY --from=deps /usr/local/bin/node /usr/local/bin/node
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
# Cadencia de arranque: --start-period cubre el arranque medido (2 s con el relleno;
# el núcleo real suma sus migraciones) y --start-interval hace que `up --wait` no espere
# la cadencia normal de 30 s. Son valores de comodidad, no gobiernan la operación.
HEALTHCHECK --start-period=15s --start-interval=1s CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/health" || exit 1
# Forma exec: node es PID 1 y recibe SIGTERM directo.
CMD ["node", "src/server.js"]
