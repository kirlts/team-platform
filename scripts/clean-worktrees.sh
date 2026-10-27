#!/usr/bin/env bash
# Lists and retires the agent worktrees (<repo>/.claude/worktrees/*) that no live agent is using.
#
#   scripts/clean-worktrees.sh --list    classify every worktree, remove nothing, exit 0
#   scripts/clean-worktrees.sh           remove the removable ones, print how many and how much disk
#
# Declared removal condition. A worktree is removed only if ALL of these hold:
#   1. No live process has its directory as cwd or holds a file open under it
#      (/proc/*/cwd and /proc/*/fd, read with readlink; no lsof, symlinks are not followed).
#   2. It has no uncommitted changes (`git status --porcelain` is empty).
#   3. Its HEAD (the branch tip, or the detached commit) has no commit that is in no remote
#      (`git log HEAD --not --remotes` is empty).
#   4. Its HEAD is already in an integration branch: every commit of it is in a remote `desarrollo` or `main`
#      (`git log HEAD --not refs/remotes/*/desarrollo refs/remotes/*/main` is empty). A pushed branch that has not
#      landed is work in progress, and whose it is cannot be told from the worktree: another session may own it.
# Anything else is never touched. Classes, in this order of precedence:
#   live       condition 1 fails, or the worktree is locked
#   nested     another registered worktree lives inside its directory; removing it would delete
#              that one's files too, so it is kept until the inner ones are gone (reported, never touched)
#   dirty      condition 2 fails ("with changes")
#   unpushed   condition 3 fails
#   unmerged   condition 4 fails (pushed, not yet in desarrollo or main)
#   unknown    git could not answer; an error is never read as "clean", so it is not touched
#   removable  all three hold
# Removing is `git worktree remove` without --force and nothing else: the branch stays, so the
# worktree is recreated with one command, which is printed for each one removed. Branches are never
# deleted. A final `git worktree prune` drops the records of directories that no longer exist.
#
# Output (tab separated): CLASS <tab> path <tab> branch-or-commit <tab> detail. The last line is the
# summary, so `--list | tail -n 1` is the one-line version for a session start hook.
set -u

MODE=remove
case "${1:-}" in
  --list) MODE=list ;;
  '') ;;
  *) echo "usage: clean-worktrees.sh [--list]" >&2; exit 2 ;;
esac

COMMON=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || { echo "not inside a git repository" >&2; exit 2; }
# The main checkout is the parent of the common git directory (".git").
MAIN=$(dirname "$COMMON")
DIR="$MAIN/.claude/worktrees"

# Every path a live process has as cwd or open file. Unreadable entries (other users) are skipped.
open_paths() {
  local p
  for p in /proc/[0-9]*; do
    readlink "$p/cwd" 2>/dev/null
    readlink "$p"/fd/* 2>/dev/null
  done
}
OPEN=$(open_paths)

in_use() { # in_use <dir>: succeeds if some process has <dir> or something below it
  printf '%s\n' "$OPEN" | awk -v d="$1" 'index($0, d "/") == 1 || $0 == d || index($0, d " (deleted)") == 1 { found = 1; exit } END { exit !found }'
}

fmt_kb() { awk -v k="$1" 'BEGIN { if (k >= 1048576) printf "%.1f GB", k / 1048576; else printf "%.1f MB", k / 1024 }'; }

n_nested=0 n_live=0 n_dirty=0 n_unpushed=0 n_unmerged=0 n_unknown=0 n_removable=0 n_removed=0 n_failed=0 freed_kb=0
RECORDS=$(git -C "$MAIN" worktree list --porcelain) || { echo "git worktree list failed" >&2; exit 2; }
ALL_PATHS=$(printf '%s\n' "$RECORDS" | sed -n 's/^worktree //p')
# The integration branches every remote knows: what has landed. Empty when there is none (then nothing is removable).
INTEGRATION=$(git -C "$MAIN" for-each-ref --format='%(refname)' 'refs/remotes/*/desarrollo' 'refs/remotes/*/main' | tr '\n' ' ')

process() { # process <path> <head> <branch> <locked>
  local inner wt=$1 head=$2 branch=$3 locked=$4 class detail ref st unp unm
  [ -d "$wt" ] || return 0
  case "$wt" in "$DIR"/*) ;; *) return 0 ;; esac
  ref=${branch:-"detached@${head:0:10}"}
  if [ -n "$locked" ]; then
    class=live; detail="locked"
  elif inner=$(printf '%s\n' "$ALL_PATHS" | awk -v d="$wt" 'index($0, d "/") == 1 { print; exit }') && [ -n "$inner" ]; then
    class=nested; detail="contains worktree $inner"
  elif in_use "$wt"; then
    class=live; detail="process using it"
  elif ! st=$(git -C "$wt" status --porcelain 2>/dev/null); then
    class=unknown; detail="git status failed"
  elif [ -n "$st" ]; then
    class=dirty; detail="$(printf '%s\n' "$st" | wc -l) changed paths"
  elif ! unp=$(git -C "$wt" rev-list HEAD --not --remotes 2>/dev/null); then
    class=unknown; detail="git rev-list failed"
  elif [ -n "$unp" ]; then
    class=unpushed; detail="$(printf '%s\n' "$unp" | wc -l) commits in no remote"
  elif [ -z "$INTEGRATION" ]; then
    class=unknown; detail="no remote desarrollo or main to compare with"
  elif ! unm=$(git -C "$wt" rev-list HEAD --not $INTEGRATION 2>/dev/null); then
    class=unknown; detail="git rev-list failed"
  elif [ -n "$unm" ]; then
    class=unmerged; detail="$(printf '%s\n' "$unm" | wc -l) commits not in desarrollo or main"
  else
    class=removable; detail=""
  fi
  case "$class" in
    live) n_live=$((n_live + 1)) ;;
    nested) n_nested=$((n_nested + 1)) ;;
    dirty) n_dirty=$((n_dirty + 1)) ;;
    unpushed) n_unpushed=$((n_unpushed + 1)) ;;
    unmerged) n_unmerged=$((n_unmerged + 1)) ;;
    unknown) n_unknown=$((n_unknown + 1)) ;;
    removable)
      n_removable=$((n_removable + 1))
      local kb; kb=$(du -skP "$wt" 2>/dev/null | cut -f1); kb=${kb:-0}
      detail="$(fmt_kb "$kb")"
      if [ "$MODE" = remove ]; then
        if git -C "$MAIN" worktree remove "$wt" 2>/dev/null; then
          n_removed=$((n_removed + 1)); freed_kb=$((freed_kb + kb))
          class=removed
          if [ -n "$branch" ]; then
            detail="$detail; recreate: git -C $MAIN worktree add $wt $branch"
          else
            detail="$detail; recreate: git -C $MAIN worktree add --detach $wt $head"
          fi
        else
          n_failed=$((n_failed + 1)); class=failed; detail="git worktree remove refused"
        fi
      fi ;;
  esac
  printf '%s\t%s\t%s\t%s\n' "$class" "$wt" "$ref" "$detail"
}

path="" head="" branch="" locked=""
while IFS= read -r line; do
  case "$line" in
    "worktree "*) path=${line#worktree }; head=""; branch=""; locked="" ;;
    "HEAD "*) head=${line#HEAD } ;;
    "branch "*) branch=${line#branch refs/heads/} ;;
    "locked"*) locked=1 ;;
    "") [ -n "$path" ] && process "$path" "$head" "$branch" "$locked"; path="" ;;
  esac
done <<< "$RECORDS
"

if [ "$MODE" = list ]; then
  echo "live $n_live, nested $n_nested, dirty $n_dirty, unpushed $n_unpushed, unmerged $n_unmerged, unknown $n_unknown, removable $n_removable"
  exit 0
fi
git -C "$MAIN" worktree prune
echo "removed $n_removed of $n_removable removable, freed $(fmt_kb "$freed_kb"); kept live $n_live, nested $n_nested, dirty $n_dirty, unpushed $n_unpushed, unmerged $n_unmerged, unknown $n_unknown; failed $n_failed"
[ "$n_failed" -eq 0 ]
