#!/usr/bin/env bash
# The single rule for `main`: it only moves to a commit that is already in `desarrollo`, by fast-forward.
#
#   this-script <nuevo-main> <desarrollo> [<main-anterior>]
#
# Exits 0 if <nuevo-main> is <desarrollo> or an ancestor of it and, with <main-anterior>, it moves forward without rewriting history.
# Exits 1 otherwise, and prints on standard output the last commit of the history of <nuevo-main> (first parent)
# that does meet the rule: where `main` must be sent back to. It is used by the `main-solo-desde-desarrollo.yml` workflow
# (server side, an optional mirror) and by the test `scripts/main-solo-desde-desarrollo.test.sh`. The `.githooks/pre-push` hook
# applies the same rule before pushing.
set -eu
NUEVO="${1:?usage: main-solo-desde-desarrollo.sh <nuevo-main> <desarrollo> [<main-anterior>]}"
DESARROLLO="${2:?missing <desarrollo>}"
ANTERIOR="${3:-}"
CERO=0000000000000000000000000000000000000000
en_desarrollo() { git merge-base --is-ancestor "$1" "$DESARROLLO" 2>/dev/null; }
if en_desarrollo "$NUEVO"; then
  if [ -z "$ANTERIOR" ] || [ "$ANTERIOR" = "$CERO" ] || git merge-base --is-ancestor "$ANTERIOR" "$NUEVO" 2>/dev/null; then
    exit 0
  fi
fi
# The last valid one: the newest commit in the first-parent history of what is left on main that is in desarrollo.
# If the new main rewrote history, start from the previous one.
for c in $(git rev-list --first-parent "$NUEVO"); do
  if en_desarrollo "$c" && { [ -z "$ANTERIOR" ] || [ "$ANTERIOR" = "$CERO" ] || git merge-base --is-ancestor "$c" "$ANTERIOR" 2>/dev/null || git merge-base --is-ancestor "$ANTERIOR" "$c" 2>/dev/null; }; then
    echo "$c"; exit 1
  fi
done
if [ -n "$ANTERIOR" ] && [ "$ANTERIOR" != "$CERO" ] && en_desarrollo "$ANTERIOR"; then echo "$ANTERIOR"; fi
exit 1
