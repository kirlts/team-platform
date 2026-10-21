#!/bin/sh
# Fails if the ffmpeg and ffprobe on the path (or in FFMPEG_BIN / FFPROBE_BIN) lack any component that
# src/extract/ needs, or if they were configured with GPL or nonfree code (UD-020).
# The lists below are the same as the --enable-* lists of the `ffmpeg` stage of the Dockerfile;
# src/extract/ffmpeg-image.test.js checks that both stay equal.
# Run it inside the image: `docker run --rm --entrypoint sh team-platform:slim -c 'cat > /tmp/c.sh; sh /tmp/c.sh' < scripts/check-ffmpeg.sh`
set -eu
FFMPEG_BIN=${FFMPEG_BIN:-ffmpeg}
FFPROBE_BIN=${FFPROBE_BIN:-ffprobe}

DEMUXERS="mov matroska ogg mp3 wav aac flac"
DECODERS="h264 hevc vp8 vp9 libdav1d aac alac opus vorbis flac mp3 mp3float pcm_s16le pcm_s24le pcm_s32le pcm_u8 pcm_f32le pcm_alaw pcm_mulaw"
ENCODERS="flac mjpeg"
MUXERS="flac image2 null"
FILTERS="scale fps aresample aformat format null anull xstack transpose hflip vflip"
PROTOCOLS="file pipe"

fail=0
missing() { echo "check-ffmpeg: missing $1 '$2'" >&2; fail=1; }

# `-decoders` prints a header, then lines like ` V....D h264   H.264 / AVC`; the name is the second column.
# A demuxer can carry aliases (`matroska,webm`, `mov,mp4,m4a,3gp,3g2,mj2`): every alias counts.
names() { "$FFMPEG_BIN" -hide_banner "$1" 2>/dev/null | awk 'f && NF >= 2 { n = split($2, a, ","); for (i = 1; i <= n; i++) print a[i] } /^ *-+ *$/ { f = 1 }'; }
protocols() { "$FFMPEG_BIN" -hide_banner -protocols 2>/dev/null | awk '/^Input:/ { m = 1; next } /^Output:/ { m = 0 } m && NF == 1 { print $1 }'; }

check() { # check <flag> <label> <names...>
  flag=$1; label=$2; shift 2
  have=$(names "$flag")
  for n in "$@"; do
    printf '%s\n' "$have" | grep -qx "$n" || missing "$label" "$n"
  done
}

check -demuxers demuxer $DEMUXERS
check -decoders decoder $DECODERS
check -encoders encoder $ENCODERS
check -muxers muxer $MUXERS
check -filters filter $FILTERS
have=$(protocols)
for n in $PROTOCOLS; do printf '%s\n' "$have" | grep -qx "$n" || missing protocol "$n"; done

conf=$("$FFMPEG_BIN" -hide_banner -version | tr ' ' '\n')
for flag in --enable-gpl --enable-nonfree --enable-version3; do
  if printf '%s\n' "$conf" | grep -qx -- "$flag"; then echo "check-ffmpeg: built with $flag" >&2; fail=1; fi
done
"$FFPROBE_BIN" -hide_banner -version >/dev/null 2>&1 || { echo "check-ffmpeg: ffprobe does not run" >&2; fail=1; }

if [ "$fail" -ne 0 ]; then exit 1; fi
echo "check-ffmpeg: ok ($("$FFMPEG_BIN" -hide_banner -version | head -1))"
