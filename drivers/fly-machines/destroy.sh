#!/usr/bin/env bash
# EXECUTE_MACHINE_DESTROY: removes the machine of a job, always. The worker calls it after success, failure, timeout, abort and a CREATE that failed half way,
# so it is idempotent: a machine that does not exist is already destroyed (exit 0). It removes by the metadata this driver wrote at create and by the exact
# name; never by pattern, and never a machine it did not create (the app is shared with other processes).
#
#   destroy.sh <job_id> <workdir> <machine>
set -uo pipefail
exec node "$(dirname "$0")/destroy.mjs" "$@"
