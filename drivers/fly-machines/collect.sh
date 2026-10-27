#!/usr/bin/env bash
# EXECUTE_MACHINE_COLLECT: before the machine is destroyed, brings out what the session left in it.
#
#   collect.sh <job_id> <workdir> <machine>
#
# Copies /job/captures and /job/attachments back into <workdir>/captures and <workdir>/attachments (the worker looks for them there), brings the branch the
# session pushed into TP_FLY_REPO (when it is set), and copies the transcript of the session (/job/claude/projects) into $TP_FLY_STATE/transcripts/<job_id>.
# The last stdout line is that directory, which Team Platform stores as `transcript_ref`. Exit 3 when the session left no transcript. Repeating it replaces the copy.
set -uo pipefail
exec node "$(dirname "$0")/collect.mjs" "$@"
