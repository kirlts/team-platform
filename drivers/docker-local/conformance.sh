#!/usr/bin/env bash
# Preparation for scripts/host-conformance.mjs (optional file of a driver). The script runs it once before the cases, with
#   CONFORMANCE_DIR     a directory of its own for the run (the state of the driver goes here)
#   CONFORMANCE_REPO    a git repository the script prepared as the host repository (branch main with one commit)
#   CONFORMANCE_DRIVER  the directory of this driver
# and reads from its stdout the lines KEY=VALUE that become the environment of the five orders. Everything else goes to stderr.
# The version of the host contract that the driver meets is declared here too (EXECUTE_CONTRACT_VERSION).
set -Eeuo pipefail

# One tag per content of the Dockerfile: two runs on the same daemon (from different checkouts too) build the same image under the same tag, and runs
# of a different Dockerfile do not replace each other's. The state directory, and with it the instance of the driver, is already one per run.
command -v sha256sum >/dev/null 2>&1 || { echo "conformance.sh: sha256sum is not in the PATH" >&2; exit 1; }
IMAGE="team-platform-agent:conformance-$(sha256sum "$CONFORMANCE_DRIVER/Dockerfile" | cut -c1-12)"
command -v docker >/dev/null 2>&1 || { echo "conformance.sh: docker is not in the PATH" >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "conformance.sh: the Docker daemon does not answer" >&2; exit 1; }
# The same Dockerfile as the real image, without Claude Code (CLAUDE_PACKAGE empty): the session is the double of the script, never a call to Anthropic.
docker build -q --build-arg CLAUDE_PACKAGE= -t "$IMAGE" "$CONFORMANCE_DRIVER" >&2

echo "EXECUTE_CONTRACT_VERSION=1"
echo "TP_DOCKER_IMAGE=$IMAGE"
echo "TP_DOCKER_REPO=$CONFORMANCE_REPO"
echo "TP_DOCKER_STATE=$CONFORMANCE_DIR/driver-state"
echo "TP_DOCKER_PASS_ENV="
echo "TP_DOCKER_MAX_CONTAINERS="
