#!/usr/bin/env bash
# EXAMPLE of EXECUTE_DELIVER_COMMAND. It delivers nothing: it only checks that the branch tp/<id> exists in the host repository. Each host
# replaces the body between `##team phase deploy` and the last line with its own way to production (a deploy script, a pull request, a push
# to the branch a platform deploys from) and keeps the contract:
#
#   deliver.sh <message_id> <job_id> <branch> <workdir>
#
#   exit 0   it is in production; the last stdout line is the reference (here the commit)
#   exit 75  not now. The line `##team wait before-machine` says the wait is worth repeating (another delivery running); `##team wait in-machine`
#            says the cause will repeat in every try (a missing tool, a wrong setting) and the job fails at once as infrastructure
#   exit 76  it waits for the review of a person; the last stdout line is the reason
#   other    the change failed; stdout and stderr are the reason Claude gets back
# Lines `##team phase verify` and `##team phase deploy` move the progress. Everything that is not the reference goes to stderr. It must be
# able to run twice on the same branch.
set -uo pipefail

MESSAGE="${1:?usage: deliver.sh <message_id> <job_id> <branch> <workdir>}"
BRANCH="${3:?missing branch}"

case "$BRANCH" in
  tp/[0-9A-Za-z._-]*) ;;
  *) echo "the branch «$BRANCH» is not a message branch (tp/<id>)" >&2; exit 2 ;;
esac
case "$BRANCH" in *..*|*' '*|*';'*|*'$'*|*"'"*|*'`'*) echo "the branch «$BRANCH» has characters that are not valid" >&2; exit 2 ;; esac

# A host setting that is missing is the same in every try: `in-machine` so that the job does not wait for what will not change.
if [ -z "${TP_DOCKER_REPO:-}" ] || ! git -C "$TP_DOCKER_REPO" rev-parse --git-dir >/dev/null 2>&1; then
  echo "TP_DOCKER_REPO does not point to a git repository: ${TP_DOCKER_REPO:-<empty>}" >&2
  echo '##team wait in-machine'
  exit 75
fi

echo '##team phase verify'
SHA="$(git -C "$TP_DOCKER_REPO" rev-parse --verify --quiet "refs/heads/$BRANCH^{commit}")" || {
  echo "the branch $BRANCH does not exist in $TP_DOCKER_REPO: the session did not push its change" >&2
  exit 1
}

echo '##team phase deploy'
# The host's way to production goes here. This example stops at the check.
git -C "$TP_DOCKER_REPO" rev-parse --short "$SHA"
exit 0
