#!/usr/bin/env bash
# EXECUTE_MACHINE_DESTROY: removes the machine of a job, always. The worker calls it after success, failure, timeout, abort and a CREATE that
# failed half way, so it is idempotent: a machine that does not exist is already destroyed (exit 0). It removes by exact name and only a
# container this driver labelled; never by pattern.
#
#   destroy.sh <job_id> <workdir> <machine>
set -uo pipefail
. "$(dirname "$0")/common.sh"

JOB="${1:?usage: destroy.sh <job_id> <workdir> <machine>}"
MACHINE="${3:-$(tp_machine_name "$JOB")}"
tp_valid_machine "$MACHINE" || tp_fail "not a machine of this driver: $MACHINE"
command -v docker >/dev/null 2>&1 || tp_fail "docker is not in the PATH"
if ! OUT="$(docker inspect -f '{{index .Config.Labels "team-platform.driver"}}' "$MACHINE" 2>&1)"; then
  case "$OUT" in *"No such"*) echo "destroy.sh: $MACHINE does not exist" >&2; exit 0 ;; esac
  echo "destroy.sh: $OUT" >&2; exit 1
fi
[ "$OUT" = "docker-local" ] || tp_fail "the container $MACHINE is not a machine of this driver"
docker rm -f -v "$MACHINE" >&2 || { docker inspect "$MACHINE" >/dev/null 2>&1 && tp_fail "$MACHINE could not be removed"; }
exit 0
