#!/usr/bin/env node
// Sustituto de `claude` para las pruebas del harness: registra con qué lo llamaron y contesta
// con el formato de `claude -p --output-format json`. Se elige el comportamiento con FAKE_CLAUDE_MODE.
import { appendFileSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';

const state = process.env.FAKE_CLAUDE_STATE;
const mode = process.env.FAKE_CLAUDE_MODE ?? 'ok';

let stdin = '';
process.stdin.on('data', (d) => { stdin += d; });
process.stdin.on('end', () => {
  const counterFile = `${state}/count`;
  const n = existsSync(counterFile) ? Number(readFileSync(counterFile, 'utf8')) : 0;
  writeFileSync(counterFile, String(n + 1));
  appendFileSync(`${state}/calls.jsonl`, `${JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), files: readdirSync('.').sort(), templates: readdirSync('templates').sort(), stdin })}\n`);

  if (mode === 'exit') {
    process.stderr.write('sesión no iniciada');
    process.exit(3);
  }
  const reply = (extra) => {
    process.stdout.write(JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: 4200,
      num_turns: 3,
      total_cost_usd: 0.0123,
      usage: { input_tokens: 31000, output_tokens: 410, cache_read_input_tokens: 2000, cache_creation_input_tokens: 500 },
      modelUsage: { 'claude-haiku-5-5': {} },
      ...extra,
    }));
  };
  if (mode === 'error') return reply({ subtype: 'error_max_turns', is_error: true, result: 'demasiados turnos' });
  if (mode === 'refusal') return reply({ stop_reason: 'refusal', stop_details: { category: 'cyber' } });

  const unitIds = [...readFileSync('input.md', 'utf8').matchAll(/\[u(\d+)\]/g)].map((m) => Number(m[1]));
  const message = (ids) => ({
    unit_ids: ids,
    title: 'Corregir pantalla en blanco',
    fields: { steps: 'Abrir', expected: 'Carga', actual: 'En blanco', where: null, impact: null },
    body: 'La pantalla queda en blanco.',
    assignee_ids: [1],
    attachment_ids: [],
  });
  const good = { area_id: 2, template_id: 2, messages: [message(unitIds)], discarded: [] };
  if (mode === 'always-bad' || (mode === 'bad-then-ok' && n === 0)) {
    return reply({ structured_output: { ...good, messages: [message([unitIds[0]])] } }); // deja huecos
  }
  return reply({ structured_output: good });
});
