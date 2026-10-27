#!/usr/bin/env bash
# EXECUTE_MACHINE_CREATE: starts the machine of one job.
#
#   create.sh <job_id> <workdir>
#
# The last stdout line is the machine name (the {machine} of the other hooks); everything else goes to stderr.
# Exit 0 created; 75 not now (Fly answers that it has no capacity or limits the rate, the API does not answer, or TP_FLY_MAX_MACHINES machines are alive;
# then stderr carries `##team quota machines=<N>` when the cap is the reason); any other code is a permanent fault (no image, wrong app, bad token).
# Repeating it for a job whose machine is alive answers with that machine.
set -Eeuo pipefail
STATE="${TP_FLY_STATE:-${XDG_STATE_HOME:-$HOME/.local/state}/team-platform-fly}"
mkdir -p "$STATE"
# Counting the live machines and creating the next one are one step: two jobs at once must not both see room for the last one. The lock is inherited by node.
exec 9>"$STATE/create.lock"
flock 9
exec node "$(dirname "$0")/create.mjs" "$@"
