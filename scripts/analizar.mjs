#!/usr/bin/env node
// Analyzes a text with the real analyzer and the providers configured through the environment.
// Used to test the decomposition end to end without starting the API.
//
//   set -a; . ~/.config/team-platform/env; set +a
//   node scripts/analizar.mjs "input text"      # or through stdin
//
// Prints the proposal, the calls (model, tokens, duration) and the total time.

import { analyze } from '../src/analyze/index.js';
import { loadSeed } from '../src/analyze/seed.js';
import { createProviders } from '../src/providers/index.js';

const text = process.argv[2] ?? (await readStdin());
if (!text.trim()) {
  console.error('Missing text.');
  process.exit(2);
}

const { areas, templates } = await loadSeed();
const members = [
  { id: 1, name: 'Martín', responsibilities: 'Desarrollo del sistema entero', domains: 'backend, frontend, infraestructura' },
  { id: 2, name: 'Pablo', responsibilities: 'Dirección del negocio y pruebas con clientes', domains: 'producto, ventas' },
];
const bundle = { text, attachments: [], areas, templates, members };

const started = performance.now();
const result = await analyze(bundle, {
  providers: createProviders(process.env),
  onProgress: ({ percent, phrase }) => console.error(`${String(percent).padStart(3)} %  ${phrase}`),
});
const total = Math.round(performance.now() - started);

console.log(JSON.stringify({ status: result.status, proposal: result.proposal, stats: result.stats }, null, 2));
console.error('\nCalls:');
for (const c of result.calls ?? []) {
  console.error(`  ${c.step}  ${c.model}  input ${c.usage?.input_tokens} (cache ${c.usage?.cached_tokens ?? 0})  output ${c.usage?.output_tokens}  ${c.duration_ms} ms`);
}
console.error(`Total: ${total} ms`);

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
  });
}
