#!/usr/bin/env bash
# The only door to `main` (plan 2026, piece C1). Nothing else publishes `main`; the hook `.githooks/pre-push` only lets through
# the push this script makes (its mark is RELEASE_PUBLISHES_MAIN=<sha>).
#
#   scripts/publish-main.sh [--dry-run] [<sha>]
#
#   <sha>       what to publish: `origin/desarrollo` (the default), or a commit that is `desarrollo` or an ancestor of it.
#               `main` only moves forward to it by fast-forward (the rule is in the script next to this one, see its header).
#   --dry-run   does everything except tag and push: the same worktree, the same battery, the same conformance run.
#
# What it does, in this order, on THAT sha and nowhere else (a temporary worktree under .claude/worktrees/, removed when it ends):
#   1. rule      the sha is `desarrollo` or an ancestor, and a fast-forward of `main`.
#   2. release   package.json `version` at the sha is a semver nobody published yet, greater than every published `vX.Y.Z`, and
#                docs/CHANGELOG.md at the sha has its `## [X.Y.Z]` section and an empty `## [Unreleased]` (see «Version», below).
#   3. battery   `npm run test:completa`: rule 12 of docs/RULES.md reserves the complete battery for «before a publication».
#   4. panel     `npm run test:panel` (tsc and vitest of the panel) only if panel/ changed between `origin/main` and the sha.
#                The browser tests are not part of a publication: rule 12 does not name them and they run per change (npm test).
#   5. client    `npm run test:client` only if packages/client/ changed between `origin/main` and the sha.
#   6. conformance   `node scripts/host-conformance.mjs --driver drivers/docker-local`: the contract (docs/CONTRATO-DE-ANFITRION.md)
#                is what an installation depends on, and the reference driver is the one that needs no cloud (principle 4 of the plan).
#   7. push      only if all of the above exited 0: tag `vX.Y.Z` and `<sha>:main`, in one atomic push, with RELEASE_PUBLISHES_MAIN=<sha>.
#
# Not part of a publication, on purpose: `test:image` (it builds the production image; the host that installs builds it), `test:bench`
# (it measures models and spends calls), the browser tests of the panel and the walkthrough (per change, UD-265). The steps run one after
# the other: the conformance and the docker tests of the battery start containers from the same driver, and they were never run side by
# side. The seconds of every step are printed at the end.
#
# Version. `package.json` `version` is the version of the publication and it is raised by a commit to `desarrollo`, before the publication,
# with `node scripts/prepare-release.mjs <patch|minor|major|current>` (it also moves `[Unreleased]` of docs/CHANGELOG.md to the new version).
# patch = fixes and changes nobody installing it has to act on; minor = a new capability or a new optional variable (additive contract);
# major = a change of `contract_version` or of anything that breaks an installation that works. `current` publishes the version
# package.json already has (the first publication, 0.1.0). This script never writes to `desarrollo`: it publishes what is already there.
#
# Exit code: 0 published (or, with --dry-run, everything passed and a publication would go out); 1 refused or a step failed; 2 usage;
# 3 with --dry-run, every step passed but the release data (step 2) is not ready, so a real run would have refused.
#
# Settings (all optional; the tests inject doubles):
#   PUBLISH_REMOTE            the remote (default origin)
#   PUBLISH_TEST_CMD          step 3 (default `npm run test:completa`)
#   PUBLISH_PANEL_CMD         step 4 (default `npm run test:panel`)
#   PUBLISH_CLIENT_CMD        step 5 (default `npm run test:client`)
#   PUBLISH_CONFORMANCE_CMD   step 6 (default `node scripts/host-conformance.mjs --driver drivers/docker-local`)
#   TMPDIR                    where the steps write (default $HOME/.cache: /tmp is memory)
set -u -o pipefail

AQUI="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE="${PUBLISH_REMOTE:-origin}"
DRY=0; WANT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    -h|--help) sed -n '2,/^set -u/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "publish-main: unknown option $1" >&2; exit 2 ;;
    *) [ -z "$WANT" ] || { echo "publish-main: only one sha" >&2; exit 2; }; WANT="$1" ;;
  esac
  shift
done

export TMPDIR="${TMPDIR:-$HOME/.cache}"; mkdir -p "$TMPDIR"
CMD_TEST="${PUBLISH_TEST_CMD:-npm run test:completa}"
CMD_PANEL="${PUBLISH_PANEL_CMD:-npm run test:panel}"
CMD_CLIENT="${PUBLISH_CLIENT_CMD:-npm run test:client}"
CMD_CONF="${PUBLISH_CONFORMANCE_CMD:-node scripts/host-conformance.mjs --driver drivers/docker-local}"

SUMMARY=(); WT=""; TAG_MADE=""
now() { date +%s.%N; }
dt() { awk -v a="$1" -v b="$2" 'BEGIN { printf "%.1f", b - a }'; }
note() { echo "publish-main: $*"; }
finish() { # <code>
  local rc=$1
  if [ -n "$WT" ] && [ -d "$WT" ]; then
    find "$WT" -maxdepth 3 -name node_modules -type l -delete 2>/dev/null
    git -C "$AQUI" worktree remove --force "$WT" >/dev/null 2>&1 || rm -rf "$WT"
    git -C "$AQUI" worktree prune >/dev/null 2>&1
  fi
  if [ "${#SUMMARY[@]}" -gt 0 ]; then
    echo; echo "publish-main: steps"; printf '  %s\n' "${SUMMARY[@]}"
  fi
  exit "$rc"
}
trap 'finish 1' INT TERM
refuse() { note "refused: $1" >&2; finish 1; }

# 1. rule ---------------------------------------------------------------------------------------------------------------------
cd "$AQUI" || exit 1
COMMON="$(cd "$(git rev-parse --path-format=absolute --git-common-dir)/.." && pwd)"
t0=$(now)
git fetch -q "$REMOTE" "+refs/heads/desarrollo:refs/remotes/$REMOTE/desarrollo" || refuse "cannot read desarrollo from $REMOTE"
git fetch -q "$REMOTE" "+refs/heads/main:refs/remotes/$REMOTE/main" 2>/dev/null
DES="$(git rev-parse --verify -q "refs/remotes/$REMOTE/desarrollo^{commit}")" || refuse "no desarrollo in $REMOTE"
PREV="$(git rev-parse --verify -q "refs/remotes/$REMOTE/main^{commit}" || true)"
if [ -n "$WANT" ]; then SHA="$(git rev-parse --verify -q "$WANT^{commit}")" || refuse "$WANT is not a commit"; else SHA="$DES"; fi
bash "$AQUI/scripts/main-solo-desde-desarrollo.sh" "$SHA" "$DES" "${PREV:-}" >/dev/null || refuse "$SHA is not desarrollo ($DES) nor an ancestor of it, or it does not fast-forward main ($PREV)"
SUMMARY+=("rule          ok    $(dt "$t0" "$(now)")s   $SHA")
if [ "$SHA" = "$PREV" ]; then note "main is already at $SHA: nothing to publish"; finish 0; fi
note "publishing ${SHA:0:12} over main ${PREV:0:12}; desarrollo is ${DES:0:12}"

# 2. release data -------------------------------------------------------------------------------------------------------------
t0=$(now)
RELEASE_PROBLEM=""
VERSION="$(git show "$SHA:package.json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s).version||"")))')"
TAG="v$VERSION"
SEMVER='^[0-9]+\.[0-9]+\.[0-9]+$'
release_check() {
  [[ "$VERSION" =~ $SEMVER ]] || { echo "package.json version «$VERSION» is not X.Y.Z"; return; }
  local changelog; changelog="$(git show "$SHA:docs/CHANGELOG.md" 2>/dev/null)" || { echo "no docs/CHANGELOG.md at the sha"; return; }
  grep -q "^## \[$VERSION\]" <<<"$changelog" || { echo "docs/CHANGELOG.md has no «## [$VERSION]» section; run: node scripts/prepare-release.mjs <patch|minor|major|current>"; return; }
  local open; open="$(awk '/^## \[Unreleased\]/{on=1;next} /^## \[/{on=0} on && NF' <<<"$changelog")"
  [ -z "$open" ] || { echo "«## [Unreleased]» of docs/CHANGELOG.md is not empty; everything published belongs to a version"; return; }
  local line own other
  line="$(git ls-remote --tags "$REMOTE" "refs/tags/$TAG" "refs/tags/$TAG^{}" | tail -n 1 | cut -f1)"
  if [ -n "$line" ]; then
    [ "$line" = "$SHA" ] && return # the same publication again
    echo "$TAG was already published at ${line:0:12}; raise package.json version (node scripts/prepare-release.mjs)"; return
  fi
  other="$(git ls-remote --tags "$REMOTE" 'refs/tags/v*' | cut -f2 | sed -e 's#^refs/tags/v##' -e 's#\^{}$##' | grep -E "$SEMVER" | sort -uV | tail -n 1)"
  if [ -n "$other" ] && [ "$(printf '%s\n%s\n' "$other" "$VERSION" | sort -V | tail -n 1)" != "$VERSION" ]; then
    echo "$VERSION is not greater than the published v$other"
  fi
}
RELEASE_PROBLEM="$(release_check)"
if [ -n "$RELEASE_PROBLEM" ]; then
  SUMMARY+=("release       NOT READY  $(dt "$t0" "$(now)")s   $RELEASE_PROBLEM")
  if [ "$DRY" = 0 ]; then refuse "$RELEASE_PROBLEM"; fi
  note "release data not ready (a real run would stop here): $RELEASE_PROBLEM"
else
  SUMMARY+=("release       ok    $(dt "$t0" "$(now)")s   $TAG")
fi

# The worktree of this publication ------------------------------------------------------------------------------------------
mkdir -p "$COMMON/.claude/worktrees"
WT="$COMMON/.claude/worktrees/publish-${SHA:0:8}-$$"
git worktree add -q --detach "$WT" "$SHA" || refuse "cannot create the worktree $WT"
# node_modules: linked when the lockfile at the sha is the one the checkout was installed from, installed (npm ci) otherwise.
prepare_modules() { # <relative dir>
  local rel="$1" dir
  dir="$WT${rel:+/$rel}"
  [ -f "$dir/package-lock.json" ] || return 0
  local home="$COMMON${rel:+/$rel}"
  if [ -d "$home/node_modules" ] && cmp -s "$home/package-lock.json" "$dir/package-lock.json"; then
    ln -s "$home/node_modules" "$dir/node_modules"
  else
    note "installing ${rel:-.} (the lockfile at the sha differs from the one installed in $home)"
    (cd "$dir" && npm ci --no-audit --no-fund >&2) || { SUMMARY+=("install ${rel:-.}  FAILED"); finish 1; }
  fi
}
t0=$(now)
prepare_modules ""; prepare_modules panel; prepare_modules packages/client
SUMMARY+=("modules       ok    $(dt "$t0" "$(now)")s")

run() { # <name> <command>
  local name="$1" cmd="$2" t rc
  t=$(now); echo; echo "==> $name: $cmd"
  (cd "$WT" && bash -c "$cmd"); rc=$?
  if [ "$rc" = 0 ]; then SUMMARY+=("$(printf '%-12s' "$name") ok    $(dt "$t" "$(now)")s   $cmd"); return 0; fi
  SUMMARY+=("$(printf '%-12s' "$name") FAILED (exit $rc)  $(dt "$t" "$(now)")s   $cmd")
  note "$name failed (exit $rc)" >&2; finish 1
}
changed() { # <prefix>
  [ -n "$PREV" ] || return 0
  [ -n "$(git diff --name-only "$PREV" "$SHA" -- "$1")" ]
}

# 3 to 6. the checks ---------------------------------------------------------------------------------------------------------
run battery "$CMD_TEST"
if changed panel/; then run panel "$CMD_PANEL"; else SUMMARY+=("panel        skipped (panel/ did not change since main)"); fi
if changed packages/client/; then run client "$CMD_CLIENT"; else SUMMARY+=("client       skipped (packages/client/ did not change since main)"); fi
run conformance "$CMD_CONF"

# 7. push --------------------------------------------------------------------------------------------------------------------
if [ "$DRY" = 1 ]; then
  note "dry run: would publish $TAG at $SHA; nothing was tagged or pushed"
  [ -z "$RELEASE_PROBLEM" ] && finish 0
  finish 3
fi
if [ -z "$(git tag --list "$TAG")" ]; then
  git tag -a "$TAG" -m "$TAG" "$SHA" || refuse "cannot create the tag $TAG"; TAG_MADE=1
elif [ "$(git rev-parse "$TAG^{commit}")" != "$SHA" ]; then
  refuse "the local tag $TAG points to another commit"
fi
t0=$(now)
if RELEASE_PUBLISHES_MAIN="$SHA" git push --atomic "$REMOTE" "$SHA:refs/heads/main" "refs/tags/$TAG:refs/tags/$TAG"; then
  SUMMARY+=("push          ok    $(dt "$t0" "$(now)")s   $SHA -> main, $TAG")
  note "published $TAG at $SHA"; finish 0
fi
[ -z "$TAG_MADE" ] || git tag -d "$TAG" >/dev/null 2>&1
SUMMARY+=("push          FAILED")
refuse "the push was rejected"
