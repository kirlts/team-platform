#!/usr/bin/env bash
# EXECUTE_MACHINE_RUN: copies the job directory into the machine and runs `bash run.sh` there as an unprivileged user (Claude Code refuses to run unattended
# with root). Its stdout is the NDJSON of the session and nothing else, line by line as the session writes it; the preparation talks on stderr. The exit code
# is the one of the session.
#
#   run.sh <job_id> <workdir> <machine>
#
# The session runs apart from the connection (the Machines API answers an exec only when its command ends, and cuts it after about 65 s), and this hook follows
# it with long polls (machine/poll.mjs). That makes it repeatable: when the worker restarts with the session alive, the next RUN finds it launched and follows it from
# its first line, without starting another. Inside the machine the job directory is /job, Claude's configuration is /job/claude (collect.sh finds the transcript
# there) and HOME is /job/home. With TP_FLY_REPO the session starts in /job/repo, a clone of the host repository on the branch tp/<message id> (TEAM_BRANCH of
# env.sh) whose origin is a repository of the machine; collect.sh brings the branch back.
set -uo pipefail
exec node "$(dirname "$0")/run.mjs" "$@"
