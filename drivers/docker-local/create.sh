#!/usr/bin/env bash
# EXECUTE_MACHINE_CREATE: starts the machine of one job.
#
#   create.sh <job_id> <workdir>
#
# The last stdout line is the machine name (the {machine} of the other hooks); everything else goes to stderr.
# Exit 0 created; 75 not now (Docker does not answer, or TP_DOCKER_MAX_CONTAINERS machines are alive; then stderr carries
# `##team quota machines=<N>`); any other code is a permanent fault (the image does not exist, the repository path is wrong).
# Repeating it for a job whose machine is alive answers with that machine.
set -Eeuo pipefail
. "$(dirname "$0")/common.sh"

JOB="${1:?usage: create.sh <job_id> <workdir>}"
NAME="$(tp_machine_name "$JOB")"
tp_valid_machine "$NAME" || tp_fail "job id without valid characters: $JOB"
tp_need_docker
docker image inspect "$TP_DOCKER_IMAGE" >/dev/null 2>&1 || tp_fail "the image $TP_DOCKER_IMAGE does not exist (docker build -t $TP_DOCKER_IMAGE drivers/docker-local)"
if [ -n "${TP_DOCKER_REPO:-}" ]; then
  [ -d "$TP_DOCKER_REPO/.git" ] || [ -f "$TP_DOCKER_REPO/HEAD" ] || tp_fail "TP_DOCKER_REPO is not a git repository: $TP_DOCKER_REPO"
fi

mkdir -p "$TP_DOCKER_STATE"
# The count of live machines and the creation of the next one are one step: two jobs at once must not both see room for the last one.
exec 9>"$TP_DOCKER_STATE/create.lock"
flock 9

if tp_machine_state "$NAME"; then
  [ "$(docker inspect -f '{{.State.Running}}' "$NAME")" = true ] || docker start "$NAME" >&2
  echo "$NAME"
  exit 0
fi

if [ -n "${TP_DOCKER_MAX_CONTAINERS:-}" ]; then
  ALIVE="$(docker ps -q --filter "label=$TP_DRIVER_LABEL" | wc -l)"
  if [ "$ALIVE" -ge "$TP_DOCKER_MAX_CONTAINERS" ]; then
    echo "$ALIVE machines alive of $TP_DOCKER_MAX_CONTAINERS allowed" >&2
    echo "##team quota machines=$TP_DOCKER_MAX_CONTAINERS" >&2
    exit 75
  fi
fi

ARGS=(run -d --name "$NAME" --label "$TP_DRIVER_LABEL" --label "team-platform.job=$(tp_safe "$JOB")"
  --network "$TP_DOCKER_NETWORK" --add-host host.docker.internal:host-gateway)
[ -z "${TP_DOCKER_MEMORY:-}" ] || ARGS+=(--memory "$TP_DOCKER_MEMORY")
[ -z "${TP_DOCKER_CPUS:-}" ] || ARGS+=(--cpus "$TP_DOCKER_CPUS")
[ -z "${TP_DOCKER_REPO:-}" ] || ARGS+=(-v "$TP_DOCKER_REPO:/host-repo")
docker "${ARGS[@]}" "$TP_DOCKER_IMAGE" >&2
echo "$NAME"
