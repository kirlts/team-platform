#!/usr/bin/env node
// Deterministic scorer for the real case of input 33 (two client videos, eight spoken requests). The data never enters
// git: it lives in bench/private/envio-33/ (bundle.json, the bundle `src/domain/pipeline.js` builds for the `analyze` job,
// and verdad.json, the requests with their voice units assigned by time and the visual claims that must not originate a
// message). Without those files the script prints a notice and exits 0.
//
//   node bench/envio-33.mjs [--runs 3] [--budget 1]          runs the real analyzer (analyze(), providers from the environment)
//   node bench/envio-33.mjs --from-messages <proposal.json>  scores a proposal already made ({ messages: [{ unit_ids, area_id, title }] })
//   --private-dir <d>  where envio-33/ lives (default bench/private; env BENCH_PRIVATE_DIR)
//   --config '<json>'  analyzer knobs for every run (src/analyze/config.js), e.g. '{"classifyEffort":"high"}'
//   --results-dir <d>  where the spending ledger private-spend.jsonl goes (default bench/results)
//   --cold             adds a random mark to the framing of each run, so the prompt cache starts empty (a send after a quiet hour)
//   --label <p>        prefix of each run in the spending ledger (default envio-33); the per-call usage of every run is saved in the result
//
// Per run it measures: requests collected (all their core voice units in one message that holds no other request; «buried»
// when that message mixes requests), requests no message names (the probe of verdad.json on title and fields), requests lost (a required voice unit
// in no message), mixed messages (core units of more than one request), messages born only from frames, surplus messages (they
// speak but hold no core unit of any request: a closing or a recap made into a message), units repeated in
// two messages, and the area of each request (the area of the message that holds most of its core units). A boundary unit,
// one whose time range straddles two requests, may go with either of them and never makes a message mixed.
import { parseArgs } from 'node:util';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSpend, withQueueRetries } from './spend.mjs';
import { costOf } from './pricing.js';

const here = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({
  options: {
    runs: { type: 'string', default: '3' },
    budget: { type: 'string', default: '1' },
    'from-messages': { type: 'string' },
    'private-dir': { type: 'string' },
    'results-dir': { type: 'string' },
    config: { type: 'string' },
    label: { type: 'string', default: 'envio-33' },
    cold: { type: 'boolean', default: false },
  },
});

const caseDir = join(values['private-dir'] ?? process.env.BENCH_PRIVATE_DIR ?? join(here, 'private'), 'envio-33');
const bundlePath = join(caseDir, 'bundle.json');
const truthPath = join(caseDir, 'verdad.json');
if (!existsSync(bundlePath) || !existsSync(truthPath)) {
  console.log(`Sin datos del envío 33 en ${caseDir} (faltan bundle.json o verdad.json): nada que medir.`);
  process.exit(0);
}
const bundle = JSON.parse(readFileSync(bundlePath, 'utf8'));
const truth = JSON.parse(readFileSync(truthPath, 'utf8'));

/**
 * Scores one proposal against the truth of the case. Pure: same proposal, same score.
 * @param {{ messages: { unit_ids: number[], area_id?: number|string, title?: string, fields?: object, body?: string }[], discarded?: object[] }} proposal
 * @param {object} t  verdad.json
 */
export function scoreProposal(proposal, t) {
  const messages = (proposal.messages ?? []).map((m, index) => ({ index, title: m.title ?? '', area_id: m.area_id == null ? null : Number(m.area_id), ids: (m.unit_ids ?? []).map(Number), text: `${m.title ?? ''}\n${typeof m.body === 'string' ? m.body : ''}\n${JSON.stringify(m.fields ?? {})}` }));
  const voice = new Map(t.voice_units.map((v) => [v.unit_id, v]));
  const where = new Map(); // unit id -> message indexes
  for (const m of messages) for (const id of m.ids) where.set(id, [...(where.get(id) ?? []), m.index]);
  const scored = t.pedidos.filter((p) => !p.joins);

  const requests = scored.map((p) => {
    const core = t.voice_units.filter((v) => v.pedidos.length === 1 && v.pedidos[0] === p.id).map((v) => v.unit_id);
    const holders = new Map();
    for (const id of core) for (const mi of where.get(id) ?? []) holders.set(mi, (holders.get(mi) ?? 0) + 1);
    const lost = core.filter((id) => !where.has(id));
    const whole = lost.length === 0 ? [...holders.entries()].find(([, n]) => n === core.length)?.[0] : undefined;
    const ownerOf = (mi) => new Set(messages[mi].ids.map((id) => voice.get(id)).filter((v) => v && v.pedidos.length === 1).map((v) => v.pedidos[0]));
    const collected = whole !== undefined && ownerOf(whole).size === 1;
    const buried = whole !== undefined && !collected;
    const mentioned = p.probe ? messages.filter((m) => new RegExp(p.probe, 'i').test(m.text)).map((m) => m.index) : null;
    const main = [...holders.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
    const area = main === undefined ? null : messages[main].area_id;
    const areaOk = area !== null && (area === p.area_id || (p.also_ok ?? []).includes(area));
    return { pedido: p.id, core, collected, buried, mentioned_in: mentioned, lost_units: lost, messages: [...holders.keys()].sort((a, b) => a - b), area_id: area, expected_area_id: p.area_id, area_ok: areaOk };
  });

  const lostUnits = t.voice_units.filter((v) => v.required && !where.has(v.unit_id)).map((v) => v.unit_id);
  const mixed = messages.filter((m) => new Set(m.ids.map((id) => voice.get(id)).filter((v) => v && v.pedidos.length === 1).map((v) => v.pedidos[0])).size > 1).map((m) => m.index);
  const frameOnly = messages.filter((m) => !m.ids.some((id) => voice.has(id))).map((m) => m.index);
  // A surplus message speaks but holds no core unit of any scored request: a closing, a recap or a point nobody asked for.
  const scoredIds = new Set(scored.map((p) => p.id));
  const surplus = messages.filter((m) => m.ids.some((id) => voice.has(id)) && !m.ids.some((id) => { const v = voice.get(id); return v && v.pedidos.length === 1 && scoredIds.has(v.pedidos[0]); })).map((m) => m.index);
  const repeated = [...where.entries()].filter(([, ms]) => ms.length > 1).map(([id]) => id).sort((a, b) => a - b);
  const claims = t.visual_claims.map((c) => {
    const re = new RegExp(c.probe, 'i');
    return { message: c.message, claim: c.claim, frame_only_message: frameOnly.some((mi) => c.frames.some((f) => messages[mi].ids.includes(f))), mentioned_in: messages.filter((m) => re.test(m.text)).map((m) => m.index) };
  });
  return {
    messages: messages.length,
    collected: requests.filter((r) => r.collected).length,
    buried: requests.filter((r) => r.buried).map((r) => r.pedido),
    unmentioned: requests.filter((r) => r.mentioned_in && r.mentioned_in.length === 0).map((r) => r.pedido),
    requests_total: scored.length,
    lost_requests: requests.filter((r) => r.lost_units.length > 0).map((r) => r.pedido),
    lost_units: lostUnits,
    mixed_messages: mixed,
    frame_only_messages: frameOnly,
    surplus_messages: surplus,
    repeated_units: repeated,
    area_ok: requests.filter((r) => r.area_ok).length,
    requests,
    claims,
    titles: messages.map((m) => `[${m.index}] área ${m.area_id}: ${m.title}`),
  };
}

function printScore(label, s) {
  const row = (r) => `  ${String(r.pedido).padEnd(6)} ${(r.collected ? 'sí' : r.buried ? 'mezclado' : 'no').padEnd(9)} ${String(r.mentioned_in === null ? '-' : r.mentioned_in.join(',') || 'ninguno').padEnd(10)} ${String(r.lost_units.length ? r.lost_units.join(',') : '-').padEnd(10)} ${String(r.messages.join(',') || '-').padEnd(10)} ${String(r.area_id ?? '-').padEnd(5)} ${String(r.expected_area_id).padEnd(9)} ${r.area_ok ? 'sí' : 'no'}`;
  console.log(`\n${label}`);
  console.log(s.titles.map((t) => `  ${t}`).join('\n'));
  console.log('  pedido recogido  nombrado   perdidas   mensajes   área  esperada  área ok');
  console.log(s.requests.map(row).join('\n'));
  console.log(`  Recogidos solos ${s.collected}/${s.requests_total} · mezclados con otro pedido ${s.buried.length} (${s.buried.join(',') || '-'}) · sin nombrar en ningún mensaje ${s.unmentioned.length} (${s.unmentioned.join(',') || '-'}) · perdidos ${s.lost_requests.length} (${s.lost_requests.join(',') || '-'}) · unidades de voz sin asignar ${s.lost_units.length} · mensajes mezclados ${s.mixed_messages.length}/${s.messages} · sólo fotogramas ${s.frame_only_messages.length} · sobrantes ${s.surplus_messages.length} · unidades repetidas ${s.repeated_units.length} · área correcta ${s.area_ok}/${s.requests_total}`);
  for (const c of s.claims) console.log(`  Afirmación visual «${c.claim}»: mensaje sólo de fotogramas ${c.frame_only_message ? 'sí' : 'no'}; mencionada en ${c.mentioned_in.join(',') || 'ninguno'}`);
}

const SUMMARY_KEYS = ['collected', 'buried', 'unmentioned', 'lost_requests', 'lost_units', 'mixed_messages', 'frame_only_messages', 'surplus_messages', 'repeated_units', 'area_ok', 'messages'];
const count = (v) => (Array.isArray(v) ? v.length : v);

async function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = join(caseDir, 'resultados');
  mkdirSync(outDir, { recursive: true });
  const out = { at: new Date().toISOString(), case: 'envio-33', mode: values['from-messages'] ? 'from-messages' : 'analyze', runs: [] };

  if (values['from-messages']) {
    const proposal = JSON.parse(readFileSync(values['from-messages'], 'utf8'));
    out.source = values['from-messages'];
    const s = scoreProposal(proposal.proposal ?? proposal, truth);
    out.runs.push({ status: 'ok', score: s });
    printScore(`Puntuación de ${values['from-messages']}`, s);
  } else {
    const { analyze } = await import('../src/analyze/index.js');
    const { createProviders } = await import('../src/providers/index.js');
    const providers = createProviders(process.env);
    if (providers.text?.unavailable) {
      console.error(`Sin proveedor de texto: ${providers.text.unavailable}`);
      process.exit(1);
    }
    // --budget caps this invocation: the ledger is shared by every private bench, so the cap starts at what it already holds.
    const ledger = createSpend({ resultsDir: values['results-dir'] ?? join(here, 'results'), budgetUsd: Infinity });
    const before = ledger.read().total_usd;
    const budget = Number(values.budget);
    out.model = { provider: providers.text.name, model: providers.text.model };
    out.config = values.config ? JSON.parse(values.config) : {};
    const runs = Number(values.runs);
    for (let i = 1; i <= runs; i += 1) {
      const label = `${values.label}/run-${i}`;
      const spent = ledger.read().total_usd - before;
      if (spent >= budget * 0.9) {
        console.log(`Presupuesto: gastado ${spent.toFixed(4)} USD de ${budget} en esta invocación; se corta antes de «${label}»`);
        break;
      }
      const t0 = performance.now();
      const runBundle = values.cold ? { ...bundle, framing: `${bundle.framing ?? ''} [${Math.random().toString(36).slice(2, 8)}]` } : bundle;
      const result = await withQueueRetries(() => analyze(runBundle, { providers, analyzer: 'api', config: values.config ? JSON.parse(values.config) : undefined }), { onRetry: (e, n) => console.error(`  reintento ${n}: ${e.message}`) });
      const calls = (result.calls ?? []).map((c) => ({ ...c, cost_usd: costOf(c) }));
      const usd = calls.reduce((a, c) => a + (c.cost_usd ?? 0), 0);
      const unpriced = calls.filter((c) => c.cost_usd === null).length;
      const total = ledger.add(label, usd, unpriced);
      const entry = { status: result.status, ms: Math.round(performance.now() - t0), calls: calls.length, call_details: calls.map((c) => ({ step: c.step, model: c.model, effort: c.effort, thinking: c.thinking, cacheable: c.cacheable, usage: c.usage, duration_ms: c.duration_ms, outcome: c.outcome, cost_usd: c.cost_usd })), cost_usd: usd, unpriced_calls: unpriced, spent_this_invocation_usd: total - before };
      if (result.status === 'ok') {
        entry.score = scoreProposal(result.proposal, truth);
        entry.proposal = result.proposal;
        printScore(`Corrida ${i}/${runs} (${providers.text.model}, ${calls.length} llamadas, ${usd.toFixed(4)} USD, ${(entry.ms / 1000).toFixed(0)} s)`, entry.score);
      } else {
        entry.failure = { step: result.step, reason: result.reason, errors: result.errors };
        console.log(`\nCorrida ${i}/${runs}: ${result.status} en ${result.step} (${result.reason ?? ''})`);
      }
      out.runs.push(entry);
    }
  }

  const ok = out.runs.filter((r) => r.score);
  if (ok.length > 1) {
    out.summary = Object.fromEntries(SUMMARY_KEYS.map((k) => [k, ok.map((r) => count(r.score[k]))]));
    console.log('\nPor corrida:', JSON.stringify(out.summary));
  }
  const file = join(outDir, `${stamp}.json`);
  writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`\nResultado: ${file}`);
}

await main();
