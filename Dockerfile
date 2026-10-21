# syntax=docker/dockerfile:1

# Stage 1: panel. Builds panel/ if it exists; otherwise leaves an empty directory.
# The whole context is copied because COPY fails when panel/ does not exist.
FROM node:24-alpine AS panel
WORKDIR /ctx
COPY . /ctx
ARG BUILD_JOBS=
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

# Stage 3: minimal static ffmpeg and ffprobe (report docs/investigaciones/mediciones/2026-10-20-ffmpeg-minimo.md).
# LGPL-2.1-or-later configuration: no --enable-gpl, no --enable-nonfree, no x264/x265. Only the demuxers,
# decoders, encoders, muxers, filters and protocols that src/extract/ uses; scripts/check-ffmpeg.sh fails the
# build if any decoder of the list is missing. AV1 comes from dav1d (BSD-2-Clause), built static here.
# The tarballs are verified against a pinned SHA-256. ffmpeg.org publishes no checksum files, so the value was
# computed on a tarball whose detached signature (key FCF986EA15E6E293A5644F10B4322F04D67658D8) verified;
# dav1d publishes its own .sha256 next to the tarball.
FROM alpine:3.24 AS ffmpeg
ARG FFMPEG_VERSION=8.1.3
ARG FFMPEG_SHA256=7138d28c96d9d3e3af4ee3d8cad72741f8ffb40da90c1112235dea3ecd3178a3
ARG DAV1D_VERSION=1.5.4
ARG DAV1D_SHA256=686616b7c69eb88d44459391ab25cac13b6647a3b288835c5784e71c1514a5c5
RUN apk add --no-cache build-base curl pkgconf meson ninja xz \
 && if [ "$(uname -m)" = x86_64 ]; then apk add --no-cache nasm; fi
WORKDIR /src
RUN <<'DAV1D'
set -eu
curl -fsSL -o dav1d.tar.xz "https://downloads.videolan.org/pub/videolan/dav1d/${DAV1D_VERSION}/dav1d-${DAV1D_VERSION}.tar.xz"
echo "${DAV1D_SHA256}  dav1d.tar.xz" | sha256sum -c -
tar -xf dav1d.tar.xz
cd "dav1d-${DAV1D_VERSION}"
meson setup build --prefix=/opt/dav1d --libdir=lib --buildtype=release --default-library=static \
  -Denable_tools=false -Denable_tests=false -Denable_examples=false
ninja -C build -j "${BUILD_JOBS:-$(nproc)}" install
mkdir -p /out/licenses
cp COPYING /out/licenses/dav1d-COPYING
DAV1D
RUN <<'FFMPEG'
set -eu
curl -fsSL -o ffmpeg.tar.xz "https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz"
echo "${FFMPEG_SHA256}  ffmpeg.tar.xz" | sha256sum -c -
tar -xf ffmpeg.tar.xz
cd "ffmpeg-${FFMPEG_VERSION}"
ASM=--disable-x86asm
if [ "$(uname -m)" = x86_64 ]; then ASM=--enable-x86asm; fi
export PKG_CONFIG_PATH=/opt/dav1d/lib/pkgconfig
# configure-begin
./configure \
  --prefix=/opt/ffmpeg --enable-small --enable-static --disable-shared --pkg-config-flags=--static \
  --extra-ldflags=-static \
  --disable-everything --disable-autodetect --disable-network --disable-doc --disable-debug \
  --disable-ffplay --disable-avdevice \
  --enable-ffmpeg --enable-ffprobe --enable-libdav1d \
  --enable-demuxer=mov,matroska,ogg,mp3,wav,aac,flac \
  --enable-parser=aac,flac,h264,hevc,vp8,vp9,av1,opus,vorbis,mpegaudio \
  --enable-decoder=h264,hevc,vp8,vp9,libdav1d,aac,alac,opus,vorbis,flac,mp3,mp3float,pcm_s16le,pcm_s24le,pcm_s32le,pcm_u8,pcm_f32le,pcm_alaw,pcm_mulaw \
  --enable-encoder=flac,mjpeg \
  --enable-muxer=flac,image2,null \
  --enable-filter=scale,fps,aresample,aformat,format,null,anull \
  --enable-protocol=file,pipe \
  $ASM
# configure-end
make -j"${BUILD_JOBS:-$(nproc)}"
make install
strip /opt/ffmpeg/bin/ffmpeg /opt/ffmpeg/bin/ffprobe
mkdir -p /out/bin /out/licenses
cp /opt/ffmpeg/bin/ffmpeg /opt/ffmpeg/bin/ffprobe /out/bin/
cp COPYING.LGPLv2.1 /out/licenses/ffmpeg-COPYING.LGPLv2.1
FFMPEG
COPY scripts/check-ffmpeg.sh /usr/local/bin/check-ffmpeg.sh
RUN FFMPEG_BIN=/out/bin/ffmpeg FFPROBE_BIN=/out/bin/ffprobe sh /usr/local/bin/check-ffmpeg.sh

# Stage 4: runtime base shared by the test target and the shipped image: plain Alpine with only the node binary from
# the official image (it also carries npm and yarn, about 23 MB, that the server never runs; same Alpine release as
# node:24-alpine), the two static ffmpeg binaries and the NOTICE with the third-party binaries (UD-020).
FROM alpine:3.24 AS base
RUN apk add --no-cache libstdc++ \
 && addgroup -g 1000 node \
 && adduser -u 1000 -G node -s /bin/sh -D node
COPY --from=deps /usr/local/bin/node /usr/local/bin/node
COPY --from=ffmpeg /out/bin/ffmpeg /out/bin/ffprobe /usr/local/bin/
COPY --from=ffmpeg /out/licenses/ /usr/share/licenses/ffmpeg/
COPY NOTICE /usr/share/licenses/NOTICE

# Test target (not shipped): `docker build --target extract-test -t team-platform:extract-test .` and
# `docker run --rm team-platform:extract-test` run the extractor tests against the image binaries.
FROM node:24-alpine AS test-deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci && npm cache clean --force

FROM base AS extract-test
# A full ffmpeg, under /usr/bin, only to generate test inputs (libx264, aac and the lavfi sources);
# the code under test uses the minimal one in /usr/local/bin, which comes first on PATH.
RUN apk add --no-cache ffmpeg
ENV NODE_ENV=test FIXTURE_FFMPEG=/usr/bin/ffmpeg TEAM_FFMPEG_MINIMAL=1
WORKDIR /app
COPY --from=test-deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY templates ./templates
COPY scripts/check-ffmpeg.sh ./scripts/check-ffmpeg.sh
CMD ["sh", "-c", "sh scripts/check-ffmpeg.sh && node --test src/extract/*.test.js src/extract/lib/*.test.js"]

# Final stage.
FROM base
LABEL org.opencontainers.image.title="team-platform" \
      org.opencontainers.image.licenses="MIT"
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
