#!/usr/bin/env bash
# Test of the `main` lock with toy repositories: the pre-push hook and the rule the server workflow uses.
set -u
AQUI="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d -p "${TMPDIR:-/tmp}")"; trap 'rm -rf "$T"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
FALLAS=0
esperar() { # <expected 0|1> <description> <command...>
  local quiero="$1" que="$2"; shift 2
  "$@" >"$T/salida" 2>&1; local got=$?
  if [ "$got" = "$quiero" ]; then echo "ok   $que"; else echo "FAIL $que (exited $got, expected $quiero)"; sed 's/^/     /' "$T/salida"; FALLAS=$((FALLAS+1)); fi
}
git init -q --bare "$T/remoto.git"
git init -q "$T/c" && cd "$T/c" && git checkout -q -b desarrollo
mkdir -p .githooks scripts && cp "$AQUI/.githooks/pre-push" .githooks/ && cp "$AQUI/scripts/main-solo-desde-desarrollo.sh" scripts/
git config core.hooksPath .githooks; git remote add origin "$T/remoto.git"
git add -A && git commit -qm base && A=$(git rev-parse HEAD)
esperar 1 "without the deploy mark, main is not pushed" git push origin "$A:refs/heads/main"
echo uno >f && git add f && git commit -qm uno && B=$(git rev-parse HEAD)
git push -q origin desarrollo
esperar 0 "with the mark and a desarrollo sha, main advances (deploy)" env DEPLOY_PUBLISHES_MAIN="$A" git push origin "$A:refs/heads/main"
git checkout -q -b ajena "$B" && echo dos >g && git add g && git commit -qm ajena && C=$(git rev-parse HEAD)
esperar 1 "with the mark but a sha that is not in desarrollo, it is rejected" env DEPLOY_PUBLISHES_MAIN="$C" git push origin "$C:refs/heads/main"
esperar 1 "the mark of another sha is no use" env DEPLOY_PUBLISHES_MAIN="$A" git push origin "$C:refs/heads/main"
esperar 1 "deleting main is rejected" env DEPLOY_PUBLISHES_MAIN=0000000000000000000000000000000000000000 git push origin :refs/heads/main
esperar 0 "main fast-forwards to another desarrollo sha" env DEPLOY_PUBLISHES_MAIN="$B" git push origin "$B:refs/heads/main"
# The server rule, on the same repository.
git fetch -q origin; DES=$(git rev-parse origin/desarrollo)
esperar 0 "server: an ancestor of desarrollo is valid" bash scripts/main-solo-desde-desarrollo.sh "$B" "$DES" "$A"
esperar 1 "server: a commit outside desarrollo is invalid" bash scripts/main-solo-desde-desarrollo.sh "$C" "$DES" "$B"
[ "$(bash scripts/main-solo-desde-desarrollo.sh "$C" "$DES" "$B" 2>/dev/null)" = "$B" ] && echo "ok   servidor: el último válido es el de desarrollo del que partió" || { echo "FALLA último válido"; FALLAS=$((FALLAS+1)); }
git checkout -q "$A" && git checkout -q -b otra && echo x >h && git add h && git commit -qm reescribe && D=$(git rev-parse HEAD)
esperar 1 "server: rewriting main (not a fast-forward of the previous one) is invalid" bash scripts/main-solo-desde-desarrollo.sh "$D" "$D" "$B"
[ "$FALLAS" = 0 ] && echo "todo en verde" || { echo "$FALLAS fallas"; exit 1; }
