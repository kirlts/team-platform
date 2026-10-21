#!/bin/sh
# Generates a VP9/WebM video fixture with ffmpeg (lavfi), for the judge's run of the panel (HALLAZGOS H-58).
#
# Why WebM: the headless Chromium that takes the captures (panel/scripts/capturas.mjs, TEST.md HP-020) does not decode
# H.264, so the thumbnail of an MP4 video comes out blank in the capture. VP9 in WebM decodes in it.
#
# The video has SCREENS different screens of SECONDS_PER_SCREEN seconds each (blocks of gray that change at every screen,
# so the frame deduplication of src/extract/video.js keeps one frame per screen) and a tone track in Opus, like a screen
# recording with a voice.
#
# Usage:  bench/fixtures/make-webm.sh [output.webm]            (default: bench/fixtures/pantallas.webm, not versioned)
#         SCREENS=12 SECONDS_PER_SCREEN=3 bench/fixtures/make-webm.sh /ruta/video.webm
set -eu

OUT="${1:-$(dirname "$0")/pantallas.webm}"
SCREENS="${SCREENS:-6}"
SECONDS_PER_SCREEN="${SECONDS_PER_SCREEN:-4}"
WIDTH="${WIDTH:-1280}"
HEIGHT="${HEIGHT:-720}"
DURATION=$((SCREENS * SECONDS_PER_SCREEN))

command -v ffmpeg >/dev/null 2>&1 || { echo "Falta ffmpeg." >&2; exit 1; }

# Screen number: floor(T / SECONDS_PER_SCREEN). Blocks of 80 px whose gray depends on the block and on the screen.
SCREEN="floor(T/${SECONDS_PER_SCREEN})"
LUMA="mod((floor(X/80)*31+floor(Y/80)*17+1)*(${SCREEN}+1)*37+${SCREEN}*101,256)"

ffmpeg -v error -y \
  -f lavfi -i "color=c=black:s=${WIDTH}x${HEIGHT}:r=5:d=${DURATION},format=yuv420p,geq=lum='${LUMA}':cb=128:cr=128" \
  -f lavfi -i "sine=frequency=330:duration=${DURATION}" \
  -c:v libvpx-vp9 -b:v 0 -crf 40 -deadline realtime -cpu-used 8 -pix_fmt yuv420p \
  -c:a libopus -b:a 48k -shortest "$OUT"

echo "$OUT: ${DURATION} s, ${SCREENS} pantallas, VP9 y Opus en WebM."
