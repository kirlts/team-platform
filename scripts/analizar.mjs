#!/usr/bin/env node
// Analiza un texto con el analizador real y los proveedores configurados por entorno.
// Sirve para probar la descomposición de punta a punta sin levantar la API.
//
//   set -a; . ~/.config/team-platform/env; set +a
//   node scripts/analizar.mjs "texto del input"      # o por stdin
//
// Imprime la propuesta, las llamadas (modelo, tokens, duración) y el tiempo total.

import { analyze } from '../src/analyze/index.js';
import { loadSeed } from '../src/analyze/seed.js';
import { createProviders } from '../src/providers/index.js';

const text = process.argv[2] ?? (await readStdin());
if (!text.trim()) {
  console.error('Falta el texto.');
  process.exit(2);
}

const { areas, templates } = await loadSeed();
const members = [
  { id: 1, name: 'Martín', profile: 'Desarrollo el sistema entero: servidor, interfaz e infraestructura. Decido la arquitectura.\n\nPrefiero recibir los errores con pasos para reproducirlos.' },
  { id: 2, name: 'Pablo', profile: 'Dirijo el negocio y pruebo el producto con clientes. Decido el producto y las ventas.\n\nNo programo.' },
];
const bundle = { text, attachments: [], areas, templates, members };

const started = performance.now();
const result = await analyze(bundle, {
  providers: createProviders(process.env),
  onProgress: ({ percent, phrase }) => console.error(`${String(percent).padStart(3)} %  ${phrase}`),
});
const total = Math.round(performance.now() - started);

console.log(JSON.stringify({ status: result.status, proposal: result.proposal, stats: result.stats }, null, 2));
console.error('\nLlamadas:');
for (const c of result.calls ?? []) {
  console.error(`  ${c.step}  ${c.model}  entrada ${c.usage?.input_tokens} (caché ${c.usage?.cached_tokens ?? 0})  salida ${c.usage?.output_tokens}  ${c.duration_ms} ms`);
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
