#!/usr/bin/env bash
# EXECUTE_MACHINE_RUN: copies the job directory into the machine and runs `bash run.sh` there as the invoking user (Claude Code refuses
# to run unattended with root). Its stdout is the NDJSON of the session and nothing else; the preparation talks on stderr. The exit code is
# the one of the session.
#
#   run.sh <job_id> <workdir> <machine>
#
# Inside the machine the job directory is /job, Claude's configuration is /job/claude (CLAUDE_CONFIG_DIR, where collect.sh finds the
# transcript) and HOME is /job/home. With TP_DOCKER_REPO the session starts in /job/repo, a clone of the host repository on the branch
# tp/<message id> (TEAM_BRANCH of env.sh), whose origin is the host repository itself: pushing the branch is how the change reaches deliver.sh.
set -Eeuo pipefail
. "$(dirname "$0")/common.sh"

JOB="${1:?usage: run.sh <job_id> <workdir> <machine>}"
WORKDIR="${2:?missing workdir}"
MACHINE="${3:-$(tp_machine_name "$JOB")}"
tp_valid_machine "$MACHINE" || tp_fail "not a machine of this driver: $MACHINE"
[ -f "$WORKDIR/run.sh" ] || { echo "run.sh: $WORKDIR/run.sh does not exist" >&2; exit 2; }
tp_need_docker
tp_machine_state "$MACHINE" || { echo "run.sh: the machine $MACHINE does not exist" >&2; exit 2; }

ME="$(id -u):$(id -g)"
{
  docker exec -u 0 "$MACHINE" sh -c 'rm -rf /job && mkdir -p /job'
  docker cp "$WORKDIR/." "$MACHINE:/job"
  docker exec -u 0 "$MACHINE" chown -R "$ME" /job
} >&2

BRANCH="$(set -a; . "$WORKDIR/env.sh"; printf '%s' "${TEAM_BRANCH:-}")"
AGENT="$(set -a; . "$WORKDIR/env.sh"; printf '%s' "${TEAM_AGENT_EMAIL:-agent@team-platform.invalid}")"

ENVS=(-e HOME=/job/home -e CLAUDE_CONFIG_DIR=/job/claude -e GIT_AUTHOR_NAME="${GIT_AUTHOR_NAME:-Team Platform agent}" -e GIT_AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL:-$AGENT}"
  -e GIT_COMMITTER_NAME="${GIT_COMMITTER_NAME:-Team Platform agent}" -e GIT_COMMITTER_EMAIL="${GIT_COMMITTER_EMAIL:-$AGENT}")
# By name only: docker reads the value from this process, so a secret never reaches a command line.
for V in $TP_DOCKER_PASS_ENV; do [ -z "${!V:-}" ] || ENVS+=(-e "$V"); done

if [ -n "${TP_DOCKER_REPO:-}" ]; then
  [ -n "$BRANCH" ] || tp_fail "env.sh has no TEAM_BRANCH"
  docker exec -u "$ME" -e HOME=/job/home -e BRANCH="$BRANCH" -e BASE="${TP_DOCKER_BASE_REF:-}" "$MACHINE" bash -ec '
    mkdir -p "$HOME" /job/claude
    git config --global --add safe.directory "*"
    git clone -q --no-hardlinks /host-repo /job/repo
    cd /job/repo
    if git fetch -q origin "refs/heads/$BRANCH:refs/remotes/origin/$BRANCH" 2>/dev/null; then git checkout -q -B "$BRANCH" "origin/$BRANCH"
    else git checkout -q -b "$BRANCH" ${BASE:+"$BASE"}; fi
  ' >&2
  ENVS+=(-e TEAM_REPO_DIR=/job/repo)
else
  docker exec -u "$ME" "$MACHINE" mkdir -p /job/home /job/claude >&2
fi

exec docker exec -u "$ME" "${ENVS[@]}" "$MACHINE" bash /job/run.sh
