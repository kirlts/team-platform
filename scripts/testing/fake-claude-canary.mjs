#!/usr/bin/env node
// Stand-in for `claude -p --output-format stream-json` in the test of scripts/canary.mjs. The message of the canary has no template, so the structured
// output is the base one (only `summary` and the optional fields): this double answers with exactly that.
// FAKE_CANARY_MODE: ok (summary says OK) | no-ok (summary without it) | exit (the session dies with no result).
// FAKE_CANARY_SLEEP_MS holds the session that long before its result.
const mode = process.env.FAKE_CANARY_MODE ?? 'ok'
const out = (event) => process.stdout.write(`${JSON.stringify(event)}\n`)
process.stdin.resume()
process.stdin.on('end', async () => {
  out({ type: 'system', subtype: 'init', session_id: 'canary-sess', model: 'claude-haiku-5-5', tools: ['Read'] })
  if (mode === 'exit') { process.stderr.write('session not started'); process.exit(3) }
  if (process.env.FAKE_CANARY_SLEEP_MS) await new Promise((resolve) => setTimeout(resolve, Number(process.env.FAKE_CANARY_SLEEP_MS)))
  const summary = mode === 'no-ok' ? 'Listo, nada que informar.' : 'OK, son las 10:00.'
  out({ type: 'result', subtype: 'success', is_error: false, session_id: 'canary-sess', duration_ms: 1000, num_turns: 1, total_cost_usd: 0.01, usage: { input_tokens: 100, output_tokens: 10 }, modelUsage: { 'claude-haiku-5-5': {} }, result: '', structured_output: { summary } })
})
