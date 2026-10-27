#!/usr/bin/env bash
# EXECUTE_MACHINE_DESTROY: removes the machine of a job, always. The worker calls it after success, failure, timeout, abort and a CREATE that
# failed half way, so it is idempotent: a machine that does not exist is already destroyed (exit 0). It removes by exact name and only a
# container this instance of the driver labelled; never by pattern. It also removes a machine created before instances existed (tp-job-<id>, no
# instance label), because the register of the core, which this instance owns, is what names it; and it reads the default name of the core
# (team-job-<id>, written down before CREATE answered) as the name this driver would have given the job.
#
#   destroy.sh <job_id> <workdir> <machine>
set -uo pipefail
. "$(dirname "$0")/common.sh"

JOB="${1:?usage: destroy.sh <job_id> <workdir> <machine>}"
MACHINE="$(tp_machine_of "$JOB" "${3:-$(tp_machine_name "$JOB")}")"
LEGACY=
if ! tp_valid_machine "$MACHINE"; then
  tp_legacy_machine "$MACHINE" || tp_fail "not a machine of this instance of the driver: $MACHINE"
  LEGACY=1
fi
command -v docker >/dev/null 2>&1 || tp_fail "docker is not in the PATH"
# Absent is asked of `docker ps`, not read from an error message: the wording of the daemon's errors changes between versions.
FOUND="$(docker ps -a -q --no-trunc --filter "name=^/${MACHINE}\$")" || { echo "destroy.sh: docker did not answer" >&2; exit 1; }
[ -n "$FOUND" ] || { echo "destroy.sh: $MACHINE does not exist" >&2; exit 0; }
OUT="$(docker inspect -f '{{index .Config.Labels "team-platform.driver"}}' "$MACHINE")" || { echo "destroy.sh: $MACHINE could not be inspected" >&2; exit 1; }
[ "$OUT" = "docker-local" ] || tp_fail "the container $MACHINE is not a machine of this driver"
# The instance label is the proof that the container is this instance's. A legacy machine (created before instances) has none; any other label is another instance.
INSTANCE="$(docker inspect -f '{{index .Config.Labels "team-platform.instance"}}' "$MACHINE")" || { echo "destroy.sh: $MACHINE could not be inspected" >&2; exit 1; }
if [ -n "$LEGACY" ]; then
  [ -z "$INSTANCE" ] || tp_fail "the container $MACHINE is not a machine of this instance ($TP_DOCKER_INSTANCE)"
else
  [ "$INSTANCE" = "$TP_DOCKER_INSTANCE" ] || tp_fail "the container $MACHINE is not a machine of this instance ($TP_DOCKER_INSTANCE)"
fi
docker rm -f -v "$MACHINE" >&2 || { docker inspect "$MACHINE" >/dev/null 2>&1 && tp_fail "$MACHINE could not be removed"; }
exit 0
