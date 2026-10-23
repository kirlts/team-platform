#!/usr/bin/env node
// Prompt-cache probe (docs/investigaciones/mediciones/2026-10-23-tokens-y-cache.md). Sends small calls with the repository's
// public decomposition prompt and the starter templates, and prints what the API reports for each: cache write, cache read
// and uncached input. No private data: the system prompt is code and the templates are in `templates/`.
//
//   node bench/cache-probe.mjs [--model claude-sonnet-5-5] [--only schema,prewarm,templates,race,stream]
//
// Each case starts with a nonce in the system prompt, so no earlier run or case shares its cache entry. Spending is declared
// in bench/results/private-spend.jsonl with the label `tokens-cache/probe`.
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createSpend } from './spend.mjs';
import { costOf } from './pricing.js';
import { decomposeSystem } from '../src/analyze/prompts.js';
import { parseTemplate } from '../src/analyze/templates.js';
import { buildDecompositionSchema } from '../src/analyze/schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({
  options: {
    model: { type: 'string', default: 'claude-sonnet-5-5' },
    only: { type: 'string', default: 'schema,prewarm,templates,race,stream' },
    ttl: { type: 'string', default: '5m' },
  },
});
const cases = new Set(values.only.split(','));
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.log('Sin ANTHROPIC_API_KEY: nada que medir.');
  process.exit(0);
}
const ledger = createSpend({ resultsDir: join(here, 'results'), budgetUsd: Infinity });

const tpl = (name) => parseTemplate(readFileSync(join(here, '..', 'templates', `${name}.md`), 'utf8'), { source: name });
const [templateA, templateB] = [tpl('bug'), tpl('idea')];
const schemaOf = (t) => buildDecompositionSchema(t.fields, { profile: 'anthropic', withDiscarded: false });
const sharedBlocks = (nonce) => {
  const [instructions, , project] = decomposeSystem(templateA, { name: 'Proyecto de prueba', description: `${'Descripción del proyecto de prueba. '.repeat(60)}` }, 'es-419');
  return { shared: [`Sonda ${nonce}\n${instructions}`, project].filter(Boolean), template: (t) => decomposeSystem(t, null, 'es-419')[1] };
};

const cc = (ttl = values.ttl) => (ttl === '1h' ? { type: 'ephemeral', ttl: '1h' } : { type: 'ephemeral' });
const withBreaks = (blocks, breakAt) => blocks.map((text, i) => ({ type: 'text', text, ...(breakAt.includes(i) ? { cache_control: cc() } : {}) }));

async function call({ blocks, breakAt, schema, maxTokens = 400, stream = false, onStart, user = 'Hay un error: el botón de guardar no responde en la agenda.' }) {
  const body = {
    model: values.model,
    max_tokens: maxTokens,
    system: withBreaks(blocks, breakAt),
    messages: [{ role: 'user', content: user }],
    ...(schema ? { output_config: { format: { type: 'json_schema', schema }, effort: 'low' } } : {}),
    ...(stream ? { stream: true } : {}),
  };
  const t0 = performance.now();
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  });
  let usage;
  let firstEventMs = null;
  if (stream && res.ok) {
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n\n')) >= 0) {
        const event = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 2);
        const data = event.split('\n').find((l) => l.startsWith('data: '));
        if (!data) continue;
        const j = JSON.parse(data.slice(6));
        if (j.type === 'message_start') {
          firstEventMs = Math.round(performance.now() - t0);
          usage = { ...j.message.usage };
          onStart?.();
        }
        if (j.type === 'message_delta' && j.usage) usage = { ...usage, output_tokens: j.usage.output_tokens };
      }
    }
  } else {
    const json = await res.json();
    if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(json).slice(0, 300)}`);
    usage = json.usage;
  }
  const ms = Math.round(performance.now() - t0);
  const u = {
    input_tokens: usage.input_tokens ?? 0,
    output_tokens: usage.output_tokens ?? 0,
    cached_tokens: usage.cache_read_input_tokens ?? 0,
    cache_creation_tokens: usage.cache_creation_input_tokens ?? 0,
  };
  ledger.add('tokens-cache/probe', costOf({ model: values.model, usage: u }) ?? 0, 0);
  return { ms, firstEventMs, ...u };
}
const show = (label, r) => console.log(`${label.padEnd(44)} escritura ${String(r.cache_creation_tokens).padStart(6)}  lectura ${String(r.cached_tokens).padStart(6)}  sin caché ${String(r.input_tokens).padStart(5)}  salida ${String(r.output_tokens).padStart(4)}  ${r.ms} ms${r.firstEventMs !== null ? ` (primer evento ${r.firstEventMs} ms)` : ''}`);
const nonce = () => randomBytes(4).toString('hex');
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

console.log(`Modelo ${values.model}, TTL ${values.ttl}\n`);

if (cases.has('schema')) {
  console.log('1. ¿El esquema de salida forma parte de la clave del caché?');
  const { shared } = sharedBlocks(nonce());
  show('  A. sistema S, esquema A', await call({ blocks: shared, breakAt: [shared.length - 1], schema: schemaOf(templateA) }));
  await sleep(1500);
  show('  B. sistema S, esquema A (repetida)', await call({ blocks: shared, breakAt: [shared.length - 1], schema: schemaOf(templateA) }));
  await sleep(1500);
  show('  C. sistema S, esquema B', await call({ blocks: shared, breakAt: [shared.length - 1], schema: schemaOf(templateB) }));
  await sleep(1500);
  show('  D. sistema S, sin esquema', await call({ blocks: shared, breakAt: [shared.length - 1] }));
}

if (cases.has('prewarm')) {
  console.log('\n2. Precalentar con max_tokens 0 y sin esquema, y luego la llamada real con esquema');
  const { shared } = sharedBlocks(nonce());
  try {
    show('  A. max_tokens 0, sin esquema', await call({ blocks: shared, breakAt: [shared.length - 1], maxTokens: 0 }));
  } catch (error) {
    console.log(`  A. max_tokens 0: ${error.message}`);
  }
  await sleep(1500);
  show('  B. llamada real con esquema A', await call({ blocks: shared, breakAt: [shared.length - 1], schema: schemaOf(templateA) }));
}

if (cases.has('templates')) {
  console.log('\n3. Dos puntos de corte: lo compartido y, después, la plantilla');
  const { shared, template } = sharedBlocks(nonce());
  const a = [...shared, template(templateA)];
  const b = [...shared, template(templateB)];
  show('  A. plantilla A (corte tras lo compartido y tras A)', await call({ blocks: a, breakAt: [shared.length - 1, a.length - 1], schema: schemaOf(templateA) }));
  await sleep(1500);
  show('  B. plantilla B (mismos cortes)', await call({ blocks: b, breakAt: [shared.length - 1, b.length - 1], schema: schemaOf(templateB) }));
  await sleep(1500);
  show('  C. plantilla A otra vez', await call({ blocks: a, breakAt: [shared.length - 1, a.length - 1], schema: schemaOf(templateA) }));
}

if (cases.has('race')) {
  console.log('\n4. Cuatro llamadas simultáneas con el mismo sistema, sin caché previo');
  const { shared } = sharedBlocks(nonce());
  const results = await Promise.all(Array.from({ length: 4 }, () => call({ blocks: shared, breakAt: [shared.length - 1], schema: schemaOf(templateA) })));
  results.forEach((r, i) => show(`  llamada ${i + 1}`, r));
  await sleep(1500);
  show('  una quinta, después de las cuatro', await call({ blocks: shared, breakAt: [shared.length - 1], schema: schemaOf(templateA) }));
}

if (cases.has('stream')) {
  console.log('\n5. Primera llamada con flujo: las demás salen al llegar message_start');
  const { shared } = sharedBlocks(nonce());
  const rest = [];
  let released;
  const startSeen = new Promise((resolve) => { released = resolve; });
  const first = call({ blocks: shared, breakAt: [shared.length - 1], schema: schemaOf(templateA), stream: true, onStart: () => released() });
  await startSeen;
  for (let i = 0; i < 3; i += 1) rest.push(call({ blocks: shared, breakAt: [shared.length - 1], schema: schemaOf(templateA) }));
  show('  primera (flujo)', await first);
  (await Promise.all(rest)).forEach((r, i) => show(`  siguiente ${i + 1}`, r));
}
console.log(`\nGasto acumulado del libro: ${ledger.read().total_usd.toFixed(4)} USD`);
