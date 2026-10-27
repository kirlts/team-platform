#!/usr/bin/env bash
# Preparation for scripts/host-conformance.mjs (optional file of a driver). The script runs it once before the cases, with
#   CONFORMANCE_DIR     a directory of its own for the run (the state of the driver goes here)
#   CONFORMANCE_REPO    a git repository the script prepared as the host repository (branch main with one commit)
#   CONFORMANCE_DRIVER  the directory of this driver
# and reads from its stdout the lines KEY=VALUE that become the environment of the five orders. Everything else goes to stderr.
#
# Needs the Fly app and its token in the environment of the run: TP_FLY_APP and FLY_API_TOKEN (or TP_FLY_TOKEN_FILE). It creates real machines in that app,
# each with the least size, `auto_destroy` and a life of 15 minutes, and the cases destroy them. The image is built here without Claude Code (the session is the
# double of the script, never a call to Anthropic) and pushed to the registry of the app, under a tag that names the content of the Dockerfile; with
# TP_FLY_IMAGE set, that image is used as it is and nothing is built.
set -Eeuo pipefail

# A `docker` shell function exported by the caller (a wrapper that allocates a terminal, for instance) would be inherited here and would echo the standard
# input of `docker login`, which is the token. The real executable is the one this script needs.
unset -f docker 2>/dev/null || true

: "${TP_FLY_APP:?TP_FLY_APP is not set: the Fly app whose machines the run creates}"
TOKEN="${FLY_API_TOKEN:-}"
[ -n "$TOKEN" ] || { [ -z "${TP_FLY_TOKEN_FILE:-}" ] || TOKEN="$(cat "$TP_FLY_TOKEN_FILE")"; }
[ -n "$TOKEN" ] || { echo "conformance.sh: set FLY_API_TOKEN (or TP_FLY_TOKEN_FILE)" >&2; exit 1; }

IMAGE="${TP_FLY_IMAGE:-}"
if [ -z "$IMAGE" ]; then
  command -v docker >/dev/null 2>&1 || { echo "conformance.sh: docker is not in the PATH (or set TP_FLY_IMAGE to an image that is already published)" >&2; exit 1; }
  docker info >/dev/null 2>&1 || { echo "conformance.sh: the Docker daemon does not answer" >&2; exit 1; }
  IMAGE="registry.fly.io/$TP_FLY_APP:tp-agent-conformance-$(sha256sum "$CONFORMANCE_DRIVER/Dockerfile" | cut -c1-12)"
  # The login goes to a configuration of its own under the run directory, which the script removes at the end: the token never reaches ~/.docker.
  export DOCKER_CONFIG="$CONFORMANCE_DIR/docker-config"
  mkdir -p "$DOCKER_CONFIG"
  printf %s "$TOKEN" | docker login registry.fly.io -u x --password-stdin >&2
  docker build -q --build-arg CLAUDE_PACKAGE= -t "$IMAGE" "$CONFORMANCE_DRIVER" >&2
  docker push -q "$IMAGE" >&2
fi

echo "EXECUTE_CONTRACT_VERSION=1"
echo "TP_FLY_IMAGE=$IMAGE"
echo "TP_FLY_REPO=$CONFORMANCE_REPO"
echo "TP_FLY_STATE=$CONFORMANCE_DIR/driver-state"
echo "TP_FLY_PASS_ENV="
echo "TP_FLY_MAX_MACHINES="
# 15 minutes: the longest case is a deadline of 10 s plus the second try of a session that died (host-conformance.mjs: HOOK_TIMEOUT_MS 120 s each); a machine
# that a failed run leaves behind is removed by Fly after this time.
echo "TP_FLY_MAX_LIFE_S=900"
