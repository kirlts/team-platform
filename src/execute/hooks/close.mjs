// Stop hook of the session (`team hook close`): the half of «the session ends with a valid result or the job fails with a reason» that only the session can still fix.
// The other half is in the worker and needs no hook: `claude -p --json-schema` hands back `structured_output`, and handler.js fails the job with `invalid_output`
// (no output, or one that does not fit the template) or `execute_no_result` (no `result` line at all), each with its reason in the thread. What a result cannot
// say is the state of the repository when the session stops: the system delivers what is on origin, not what stayed on the machine. This hook holds the session
// once, with the exact commands, when the host asked for it (the `close` block of the guards file; see common.mjs):
//   clean_tree     no uncommitted change to tracked files
//   pushed_branch  the branch with commits of its own is pushed with its last commit
//   review         a change that draws a screen, or that only touches documents, carries the mark of a reviewer other than its author on the final tree
// It holds a session once (`stop_hook_active` ends the loop) and does nothing when the repository has no change: the answer then goes in the thread.

import { spawnSync } from 'node:child_process'
import { allow, hold, readGuards } from './common.mjs'

const MAX_UNCOMMITTED_SHOWN = 5

function gitIn (root) {
  // outside-the-image: git — this hook runs inside the session machine, where the repository is; the worker never starts it
  return (...args) => { const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' }); return r.status === 0 ? r.stdout : '' }
}

/** The branch the session's commits are counted from: `close.base`, else the default branch of the remote. Null when neither resolves. */
function baseOf (git, close) {
  const named = close.base ?? git('symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD').trim()
  return named && git('rev-parse', '-q', '--verify', named).trim() ? named : null
}

const fill = (text, values) => text.replace(/\{(tree|job|branch)\}/g, (m, k) => values[k] ?? m)

/** The marks `<trailer>: <reviewer> <tree sha>` of the commits in the range. */
export function marksOf (log, trailer) {
  const escaped = trailer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return [...log.matchAll(new RegExp(`^${escaped}:\\s*(.+?)\\s+([0-9a-f]{40})\\s*$`, 'gm'))].map((m) => ({ reviewer: m[1].trim().toLowerCase(), tree: m[2] }))
}

/** Whether the change needs a review mark: some file matches `paths` (and not `except`), or every file matches `only` (and not `only_except`). */
export function needsReview (review, files) {
  const matches = (file, pattern, except) => new RegExp(pattern).test(file) && !(except && new RegExp(except).test(file))
  if (review.paths && files.some((file) => matches(file, review.paths, review.except))) return true
  return Boolean(review.only) && files.length > 0 && files.every((file) => matches(file, review.only, review.only_except))
}

export function run ({ event, env = process.env }) {
  const close = readGuards(env)?.close
  if (!close || event?.stop_hook_active) return allow()
  const root = env.CLAUDE_PROJECT_DIR || event?.cwd || process.cwd()
  const git = gitIn(root)
  const base = baseOf(git, close)
  if (!base) return allow()

  const own = git('rev-list', `${base}..HEAD`).split(/\s+/).filter(Boolean)
  const dirty = git('status', '--porcelain', '--untracked-files=no').split('\n').filter((l) => l.trim()).map((l) => l.slice(3))
  if (own.length === 0 && dirty.length === 0) return allow() // no change in the repository: no review, no branch to push; the answer goes in the thread

  const missing = []
  if (close.clean_tree && dirty.length) {
    missing.push(`There are uncommitted changes (${dirty.slice(0, MAX_UNCOMMITTED_SHOWN).join(', ')}): commit them by path (\`git add <file>\` and \`git commit\`) or discard them with \`git restore <file>\`.`)
  }

  const review = close.review
  if (review) {
    const files = git('diff', '-z', '--name-only', '--no-renames', `${base}...HEAD`).split('\0').filter(Boolean)
    if (needsReview(review, files)) {
      const tree = git('rev-parse', 'HEAD^{tree}').trim()
      const authors = new Set(git('log', '--format=%an%n%ae', `${base}..HEAD`).split('\n').map((a) => a.trim().toLowerCase()).filter(Boolean))
      const notBy = new Set((review.not_by ?? []).map((name) => name.toLowerCase()))
      const valid = marksOf(git('log', '--format=%B', `${base}..HEAD`), review.trailer).some((mark) => mark.tree === tree && !authors.has(mark.reviewer) && !notBy.has(mark.reviewer))
      if (!valid) missing.push(fill(review.message, { tree, job: env.TEAM_JOB_ID ?? '', branch: env.TEAM_BRANCH ?? '' }))
    }
  }

  if (close.pushed_branch && own.length) {
    if (git('rev-parse', '-q', '--verify', '@{u}').trim() !== git('rev-parse', 'HEAD').trim()) {
      missing.push('The branch is not pushed with its last commit: `git push -u origin HEAD`. The system delivers what is on origin, not what stayed on this machine.')
    }
  }
  return missing.length ? hold(missing.join(' ')) : allow()
}
