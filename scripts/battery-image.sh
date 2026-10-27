#!/usr/bin/env bash
# Runs a command of the battery INSIDE the pinned image (the `battery` stage of the Dockerfile) on the commit checked out in a directory.
# The battery of a publication used to run on the machine that published, with its Node and its tools, and a record said «green» for an
# environment nobody could name. Here the environment is the one the Dockerfile declares: the node image pinned by digest, bash, git
# without identity or hooks, no Docker daemon, no Chromium.
#
#   scripts/battery-image.sh [--tree <dir>] -- <command...>
#
#   --tree   the checkout whose HEAD is tested (default: the current directory). Only what git tracks at HEAD enters the image.
#
# What it does: exports HEAD with `git archive` into a directory under $TMPDIR; builds the `battery` stage with that as the context (the
# layers depend on the lockfiles only, so a second run does not install anything); runs the command in a container with the commit
# mounted read-only, copied to /app and made a git repository of one commit (the tests list files with `git ls-files`; the commit is not the
# original, the tree is). The output of the command is the output of this script, with these lines first, which `battery-record.mjs result`
# reads: `battery-image: node vX.Y.Z`, `battery-image: image sha256:<digest of the pinned base>`, `battery-image: tree <tree sha>`.
# The exit code is the command's.
#
# The container is bounded like the scope that launches it (rule of the coordinator, 2026-10-27, after a load of 60 cut the SSH of a chain):
# BATTERY_MEMORY (default 8g) and BATTERY_CPUS (default 6, the 600% of `systemd-run -p CPUQuota=600%`) are limits of the machine, not tuned
# values; run the script under `systemd-run --user --scope -q -p CPUQuota=600% -p MemoryMax=8G`, one battery at a time.
# Settings (all optional): BATTERY_MEMORY, BATTERY_CPUS,
# BATTERY_IMAGE_TAG (default team-platform-battery:<hash of Dockerfile and lockfiles>), TMPDIR (default $HOME/.cache: /tmp is memory).
set -u -o pipefail

TREE="$PWD"
while [ $# -gt 0 ]; do
  case "$1" in
    --tree) TREE="$(cd "$2" && pwd)" || exit 2; shift 2 ;;
    --) shift; break ;;
    -h|--help) sed -n '2,/^set -u/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) break ;;
  esac
done
[ $# -gt 0 ] || { echo "battery-image: no command given" >&2; exit 2; }
CMD="$*"

export TMPDIR="${TMPDIR:-$HOME/.cache}"; mkdir -p "$TMPDIR"
command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1 || { echo "battery-image: Docker does not answer: the battery of a publication runs in the image" >&2; exit 125; }

SRC="$(mktemp -d "$TMPDIR/battery-src-XXXXXX")"
trap 'rm -rf "$SRC"' EXIT
git -C "$TREE" archive HEAD | tar -x -C "$SRC" || { echo "battery-image: cannot export HEAD of $TREE" >&2; exit 125; }
TREE_SHA="$(git -C "$TREE" rev-parse 'HEAD^{tree}')"

HASH="$(cat "$SRC/Dockerfile" "$SRC/package-lock.json" "$SRC/panel/package-lock.json" "$SRC/packages/client/package-lock.json" 2>/dev/null | sha256sum | cut -c1-12)"
TAG="${BATTERY_IMAGE_TAG:-team-platform-battery:$HASH}"
if ! docker image inspect "$TAG" >/dev/null 2>&1; then
  echo "battery-image: building $TAG" >&2
  docker build -q --target battery -t "$TAG" "$SRC" >/dev/null || { echo "battery-image: the build of the battery stage failed" >&2; exit 125; }
fi
BASE="$(sed -n 's#^FROM node:24-alpine@\(sha256:[0-9a-f]\{64\}\) AS battery$#\1#p' "$SRC/Dockerfile")"

# Inside: copy the commit (node_modules stay the image's), make it a repository of one commit with no identity in the configuration of the
# user, and run the command. `exec` so that the exit code is the command's.
INNER='set -e
cp -a /src/. /app/
cd /app
git init -q
git add -A
git -c user.name=battery -c user.email=battery@localhost commit -q -m "tree $BATTERY_TREE"
echo "battery-image: node $(node --version)"
echo "battery-image: image $BATTERY_BASE"
echo "battery-image: tree $BATTERY_TREE"
set +e
exec bash -c "$BATTERY_CMD"'
docker run --rm --memory "${BATTERY_MEMORY:-8g}" --cpus "${BATTERY_CPUS:-6}" -v "$SRC:/src:ro" \
  -e "BATTERY_CMD=$CMD" -e "BATTERY_TREE=$TREE_SHA" -e "BATTERY_BASE=$BASE" \
  "$TAG" bash -c "$INNER"
exit $?
