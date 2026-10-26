#!/usr/bin/env bash
# EXECUTE_MACHINE_COLLECT: before the machine is destroyed, brings out what the session left in it.
#
#   collect.sh <job_id> <workdir> <machine>
#
# Copies /job/captures and /job/attachments back into <workdir>/captures and <workdir>/attachments (the worker looks for them there) and the
# transcript of the session (/job/claude/projects) into $TP_DOCKER_STATE/transcripts/<job_id>. The last stdout line is that directory, which
# Team Platform stores as `transcript_ref`. Exit 3 when the session left no transcript. Repeating it replaces the copy.
set -Eeuo pipefail
. "$(dirname "$0")/common.sh"

JOB="${1:?usage: collect.sh <job_id> <workdir> <machine>}"
WORKDIR="${2:?missing workdir}"
MACHINE="${3:-$(tp_machine_name "$JOB")}"
tp_valid_machine "$MACHINE" || tp_fail "not a machine of this driver: $MACHINE"
tp_need_docker
tp_machine_state "$MACHINE" || { echo "collect.sh: the machine $MACHINE does not exist" >&2; exit 2; }

for SUB in captures attachments; do
  if docker exec "$MACHINE" test -d "/job/$SUB" 2>/dev/null; then
    mkdir -p "$WORKDIR/$SUB"
    docker cp "$MACHINE:/job/$SUB/." "$WORKDIR/$SUB" >&2 || echo "collect.sh: $SUB could not be copied; the worker will discard them" >&2
  fi
done

DEST="$TP_DOCKER_STATE/transcripts/$(tp_safe "$JOB")"
docker exec "$MACHINE" test -d /job/claude/projects 2>/dev/null || { echo "collect.sh: the session left no /job/claude/projects" >&2; exit 3; }
rm -rf "$DEST"
mkdir -p "$DEST"
docker cp "$MACHINE:/job/claude/projects/." "$DEST" >&2
[ -n "$(find "$DEST" -name '*.jsonl' -print -quit)" ] || { echo "collect.sh: no .jsonl transcript in the machine" >&2; exit 3; }
echo "$DEST"
