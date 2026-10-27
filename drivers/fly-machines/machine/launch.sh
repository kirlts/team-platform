#!/usr/bin/env bash
# Runs inside the machine, as root, through exec. Unpacks the job directory, prepares the repository clone and starts the session apart from the exec call
# (setsid), with its stdout in /tp/out, its stderr in /tp/err and its exit code in /tp/exit, which poll.mjs reads. Repeating it does nothing once the session
# started: /tp/launched is created right before it, so a second RUN of the same job attaches to the session that is alive and never starts another.
set -Eeuo pipefail
. /tp/agent/launch.env
[ ! -d /tp/launched ] || { echo "launch.sh: the session was already launched" >&2; exit 0; }
chown "$LAUNCH_USER": /tp/agent/session.env
rm -rf /tp/origin.git /job/repo

mkdir -p /job
tar xzf /tp/up/job.tgz -C /job
mkdir -p /job/home /job/claude
chown -R "$LAUNCH_USER": /job
: > /tp/out; : > /tp/err
chown "$LAUNCH_USER": /tp/out /tp/err

ENVS=(HOME=/job/home CLAUDE_CONFIG_DIR=/job/claude "GIT_AUTHOR_NAME=$GIT_NAME" "GIT_AUTHOR_EMAIL=$GIT_EMAIL" "GIT_COMMITTER_NAME=$GIT_NAME" "GIT_COMMITTER_EMAIL=$GIT_EMAIL")
if [ -f /tp/up/repo.bundle ]; then
  # The origin of the clone is a bare repository of the machine, the stand-in of the host repository: the session pushes its branch there and collect.sh
  # brings it out. What the bundle already had is noted so that the bundle that comes back holds only the new commits.
  git clone -q --bare /tp/up/repo.bundle /tp/origin.git
  git --git-dir=/tp/origin.git for-each-ref --format='%(objectname)' > /tp/base-shas
  chown -R "$LAUNCH_USER": /tp/origin.git
  runuser -u "$LAUNCH_USER" -- env "${ENVS[@]}" BRANCH="$LAUNCH_BRANCH" BASE="$LAUNCH_BASE" bash -ec '
    git config --global --add safe.directory "*"
    git clone -q --no-hardlinks /tp/origin.git /job/repo
    cd /job/repo
    if git fetch -q origin "refs/heads/$BRANCH:refs/remotes/origin/$BRANCH" 2>/dev/null; then git checkout -q -B "$BRANCH" "origin/$BRANCH"
    else git checkout -q -b "$BRANCH" ${BASE:+"$BASE"}; fi
  ' >&2
  ENVS+=(TEAM_REPO_DIR=/job/repo)
fi

export LAUNCH_USER
ENV_WORDS="$(printf '%q ' "${ENVS[@]}")"
export ENV_WORDS
# The marker and the start are one step: from here on a second RUN attaches, it never launches again.
mkdir /tp/launched
setsid nohup bash -c '
  eval "set -- $ENV_WORDS"
  runuser -u "$LAUNCH_USER" -- env "$@" bash -c ". /tp/agent/session.env; exec bash /job/run.sh" >/tp/out 2>/tp/err </dev/null
  echo $? > /tp/exit.tmp
  mv /tp/exit.tmp /tp/exit
' >/dev/null 2>&1 </dev/null &
echo "launch.sh: session started" >&2
