#!/usr/bin/env node
// Stand-in for `claude -p --output-format stream-json` in the test of scripts/canary.mjs. The message of the canary has no template, so the structured
// output is the base one (only `summary` and the optional fields): this double answers with exactly that.
// FAKE_CANARY_MODE: ok (summary says OK) | no-ok (summary without it) | exit (the session dies with no result).
// FAKE_CANARY_SLEEP_MS holds the session that long before its result.
// For scripts/host-conformance.mjs, all of them off by default so that the canary does not change: FAKE_CANARY_OUTCOME adds `outcome` to the output (`done` is what hands the
// branch to the delivery); FAKE_CANARY_TRANSCRIPT=1 leaves a transcript under $CLAUDE_CONFIG_DIR/projects, as Claude Code does (what COLLECT brings out of the machine);
// FAKE_CANARY_PUSH=1 commits a change in $TEAM_REPO_DIR and pushes it to the branch $TEAM_BRANCH (what DELIVER looks for).
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
const mode = process.env.FAKE_CANARY_MODE ?? 'ok'
const out = (event) => process.stdout.write(`${JSON.stringify(event)}\n`)
process.stdin.resume()
process.stdin.on('end', async () => {
  out({ type: 'system', subtype: 'init', session_id: 'canary-sess', model: 'claude-haiku-5-5', tools: ['Read'] })
  if (process.env.FAKE_CANARY_TRANSCRIPT === '1' && process.env.CLAUDE_CONFIG_DIR) {
    mkdirSync(`${process.env.CLAUDE_CONFIG_DIR}/projects/-job`, { recursive: true })
    writeFileSync(`${process.env.CLAUDE_CONFIG_DIR}/projects/-job/canary-sess.jsonl`, `${JSON.stringify({ type: 'user', session_id: 'canary-sess' })}\n`)
  }
  if (mode === 'exit') { process.stderr.write('session not started'); process.exit(3) }
  if (process.env.FAKE_CANARY_SLEEP_MS) await new Promise((resolve) => setTimeout(resolve, Number(process.env.FAKE_CANARY_SLEEP_MS)))
  if (process.env.FAKE_CANARY_PUSH === '1' && process.env.TEAM_REPO_DIR && process.env.TEAM_BRANCH) {
    const git = (...args) => execFileSync('git', ['-C', process.env.TEAM_REPO_DIR, '-c', 'user.name=conformance', '-c', 'user.email=conformance@example.org', ...args], { stdio: ['ignore', 'ignore', 'inherit'] })
    writeFileSync(`${process.env.TEAM_REPO_DIR}/change.txt`, `${process.env.TEAM_BRANCH}\n`)
    git('add', 'change.txt')
    git('commit', '-q', '-m', 'change of the session')
    git('push', '-q', 'origin', `HEAD:refs/heads/${process.env.TEAM_BRANCH}`)
  }
  const summary = mode === 'no-ok' ? 'Listo, nada que informar.' : 'OK, son las 10:00.'
  out({ type: 'result', subtype: 'success', is_error: false, session_id: 'canary-sess', duration_ms: 1000, num_turns: 1, total_cost_usd: 0.01, usage: { input_tokens: 100, output_tokens: 10 }, modelUsage: { 'claude-haiku-5-5': {} }, result: '', structured_output: { summary, ...(process.env.FAKE_CANARY_OUTCOME ? { outcome: process.env.FAKE_CANARY_OUTCOME } : {}) } })
})
