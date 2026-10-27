#!/usr/bin/env bash
# Runs inside the machine through exec. Packs something to bring out as base64 text in /tp/dl/<kind>.b64 and prints «<bytes> <sha256>» of that text, or «-»
# when there is nothing to bring. collect.mjs then reads the text in slices (an exec answer is limited to 10 MiB).
#
#   pack.sh job                 captures/ and attachments/ of the job directory (a tar.gz)
#   pack.sh transcript          claude/projects of the job directory (a tar.gz)
#   pack.sh branch <branch>     the commits the session pushed to the branch, as a git bundle
set -Eeuo pipefail
KIND="${1:?usage: pack.sh job|transcript|branch <branch>}"
mkdir -p /tp/dl
OUT="/tp/dl/$KIND.b64"
case "$KIND" in
  job)
    DIRS=(); for d in captures attachments; do [ -d "/job/$d" ] && DIRS+=("$d"); done
    [ "${#DIRS[@]}" -gt 0 ] || { echo '-'; exit 0; }
    tar czf - -C /job "${DIRS[@]}" | base64 -w0 > "$OUT" ;;
  transcript)
    [ -d /job/claude/projects ] || { echo '-'; exit 0; }
    tar czf - -C /job/claude projects | base64 -w0 > "$OUT" ;;
  branch)
    BRANCH="${2:?missing branch}"
    [ -d /tp/origin.git ] || { echo '-'; exit 0; }
    git --git-dir=/tp/origin.git rev-parse --verify --quiet "refs/heads/$BRANCH" >/dev/null || { echo '-'; exit 0; }
    # shellcheck disable=SC2046
    git --git-dir=/tp/origin.git bundle create /tp/dl/branch.bundle "refs/heads/$BRANCH" --not $(cat /tp/base-shas) >&2 || { echo '-'; exit 0; }
    base64 -w0 /tp/dl/branch.bundle > "$OUT" ;;
  *) echo "pack.sh: unknown kind $KIND" >&2; exit 2 ;;
esac
echo "$(wc -c < "$OUT") $(sha256sum "$OUT" | cut -d' ' -f1)"
