#!/usr/bin/env node
// Validation of the «Error directo» area and template against the real analyzer (a deployed platform).
//
//   node bench/error-directo.mjs setup  --area docs/plantillas/area-error-directo.md --template docs/plantillas/error-directo.md --title "Error directo v2"
//   node bench/error-directo.mjs update --area-id N --area <file> --template-id M --template <file>
//   node bench/error-directo.mjs run    --items <items.jsonl> --out <results.jsonl> --label <name> [--concurrency 4]
//   node bench/error-directo.mjs score  --items <items.jsonl> --results <results.jsonl> [--truth <field>]
//   node bench/error-directo.mjs teardown --state <state.json>
//
// Credentials: `source ~/.config/team-platform/vps-admin` (URL, ADMIN_EMAIL, ADMIN_PASSWORD).
// The items file lives under bench/private (never versioned). Every dollar is declared in bench/results/private-spend.jsonl.
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { costOf } from './pricing.js';

const { URL: BASE, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
const SPEND_FILE = process.env.SPEND_FILE ?? 'bench/results/private-spend.jsonl';
const POLL_MS = 3000; // sampling period of the job status; the job itself takes seconds
const JOB_TIMEOUT_MS = 600_000; // 10 minutes per input before giving up

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? def : process.argv[i + 1];
}

let cookie = '';
async function api(method, path, body, { multipart } = {}) {
  const headers = { 'x-team-request': '1', cookie };
  let payload;
  if (multipart) payload = multipart;
  else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  const set = res.headers.getSetCookie?.() ?? [];
  if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  return json;
}

async function login() {
  if (!BASE || !ADMIN_EMAIL || !ADMIN_PASSWORD) throw new Error('Faltan URL, ADMIN_EMAIL y ADMIN_PASSWORD en el entorno');
  await api('POST', '/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function areaDescription(file) {
  // The first line is the title of the document; the rest is the text the analyzer reads.
  const lines = readFileSync(file, 'utf8').split('\n');
  return lines.slice(lines[0].startsWith('# ') ? 1 : 0).join('\n').trim();
}

async function setup() {
  await login();
  const title = arg('title', 'Error directo v2');
  const stateFile = arg('state', 'bench/private/error-directo/vps-state.json');
  const areas = await api('GET', '/api/areas');
  const trashed = [];
  for (const a of areas) {
    await api("DELETE", `/api/areas/${a.id}?confirm=true`);
    trashed.push({ id: a.id, title: a.title });
  }
  const area = await api('POST', '/api/areas', { title, description: areaDescription(arg('area')), color: '#0f766e' });
  const template = await api('POST', `/api/areas/${area.id}/templates`, { body_markdown: readFileSync(arg('template'), 'utf8') });
  mkdirSync(dirname(stateFile), { recursive: true });
  writeFileSync(stateFile, JSON.stringify({ trashed, area_id: area.id, template_id: template.id, created: new Date().toISOString() }, null, 2));
  console.log(JSON.stringify({ trashed, area_id: area.id, template_id: template.id }));
}

async function update() {
  await login();
  await api('PATCH', `/api/areas/${arg('area-id')}`, { description: areaDescription(arg('area')) });
  const t = await api('PATCH', `/api/areas/${arg('area-id')}/templates/${arg('template-id')}`, { body_markdown: readFileSync(arg('template'), 'utf8') });
  console.log(JSON.stringify({ updated: true, template: t.id }));
}

function usageOf(trace) {
  let calls = 0, input = 0, output = 0, read = 0, write = 0, ms = 0;
  const walk = (n) => {
    const a = n.attributes ?? {};
    if ('gen_ai.usage.input_tokens' in a) {
      calls += 1;
      input += a['gen_ai.usage.input_tokens'] ?? 0;
      output += a['gen_ai.usage.output_tokens'] ?? 0;
      read += a['gen_ai.usage.cache_read.input_tokens'] ?? 0;
      write += a['gen_ai.usage.cache_write.input_tokens'] ?? 0;
    }
    ms = Math.max(ms, n.duration_ms ?? 0);
    for (const c of n.children ?? []) walk(c);
  };
  for (const r of trace.roots ?? []) walk(r);
  const uncached = Math.max(0, input - read - write);
  const cost = costOf({ model: 'claude-sonnet-5-5', usage: { input_tokens: uncached, output_tokens: output, cached_tokens: read, cache_creation_tokens: write } });
  return { calls, input_tokens: input, output_tokens: output, cache_read: read, cache_write: write, cost_usd: cost, job_ms: ms };
}

async function runOne(item) {
  const started = Date.now();
  const form = new FormData();
  form.set('text', item.text);
  const created = await api('POST', '/api/inputs', undefined, { multipart: form });
  const id = created.input_id;
  let detail;
  for (;;) {
    await sleep(POLL_MS);
    detail = await api('GET', `/api/inputs/${id}`);
    if (['published', 'proposed', 'failed', 'error', 'cancelled'].includes(detail.status) || detail.job?.status === 'failed') break;
    if (Date.now() - started > JOB_TIMEOUT_MS) { detail.status = 'timeout'; break; }
  }
  const wall_ms = Date.now() - started;
  const messages = (detail.proposal?.messages ?? []).map((m) => ({ title: m.title, fields: m.fields, unit_ids: m.unit_ids }));
  let usage = null;
  if (detail.job_id) {
    try { usage = usageOf(await api('GET', `/api/jobs/${detail.job_id}/trace`)); } catch (e) { usage = { error: String(e.message).slice(0, 120) }; }
  }
  return { id: item.id, input_id: id, status: detail.status, error: detail.error, wall_ms, usage, messages };
}

async function run() {
  await login();
  const items = readFileSync(arg('items'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const out = arg('out');
  const label = arg('label', 'run');
  const concurrency = Number(arg('concurrency', '4'));
  const done = new Set(existsSync(out) ? readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).id) : []);
  const queue = items.filter((i) => !done.has(i.id));
  mkdirSync(dirname(SPEND_FILE), { recursive: true });
  let spent = 0;
  const worker = async () => {
    while (queue.length) {
      const item = queue.shift();
      let result;
      try { result = await runOne(item); } catch (e) { result = { id: item.id, status: 'exception', error: String(e.message).slice(0, 300), messages: [] }; }
      appendFileSync(out, `${JSON.stringify(result)}\n`);
      const cost = result.usage?.cost_usd ?? 0;
      spent += cost;
      appendFileSync(SPEND_FILE, `${JSON.stringify({ at: new Date().toISOString(), label: `error-directo/${label} ${item.id}`, usd: Number(cost.toFixed(6)), unpriced: result.usage?.cost_usd == null ? 1 : 0 })}\n`);
      console.log(`${item.id} ${result.status} ${(result.wall_ms / 1000).toFixed(0)}s ${cost.toFixed(4)} USD [${result.messages.map((m) => m.fields?.arreglable).join(', ')}]`);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  console.log(`total ${spent.toFixed(3)} USD, ${items.length - queue.length} items`);
}

// Verdict of an item: «sí» only when every message the analyzer produced is «sí» (the strictest reading);
// «alguno» when at least one is. The truth field of the items file is «desenlace» (a, b, c, d).
function verdictOf(result, mode) {
  const v = result.messages.map((m) => String(m.fields?.arreglable ?? '').trim().toLowerCase());
  if (v.length === 0) return 'sin mensaje';
  const yes = (x) => x === 'sí' || x === 'si';
  if (mode === 'alguno') return v.some(yes) ? 'sí' : v.some((x) => x === 'en parte') ? 'en parte' : 'no';
  return v.every(yes) ? 'sí' : v.some((x) => x === 'en parte' || yes(x)) ? 'en parte' : 'no';
}

function score() {
  const items = new Map(readFileSync(arg('items'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((i) => [i.id, i]));
  const results = readFileSync(arg('results'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const report = {};
  for (const mode of ['todos', 'alguno']) {
    for (const yesSet of ['sí', 'sí o en parte']) {
      let tp = 0, fp = 0, fn = 0, tn = 0;
      for (const r of results) {
        const item = items.get(r.id);
        if (!item) continue;
        const v = verdictOf(r, mode);
        const predicted = yesSet === 'sí' ? v === 'sí' : v === 'sí' || v === 'en parte';
        const actual = item.desenlace === 'a';
        if (predicted && actual) tp += 1; else if (predicted) fp += 1; else if (actual) fn += 1; else tn += 1;
      }
      report[`${mode} / ${yesSet}`] = { tp, fp, fn, tn, precision: tp + fp ? tp / (tp + fp) : null, recall: tp + fn ? tp / (tp + fn) : null };
    }
  }
  console.log(JSON.stringify(report, null, 2));
}

async function teardown() {
  await login();
  const state = JSON.parse(readFileSync(arg('state'), 'utf8'));
  await api("DELETE", `/api/areas/${state.area_id}?confirm=true`);
  for (const a of state.trashed) await api('POST', `/api/areas/${a.id}/restore`);
  console.log(JSON.stringify({ trashed: state.area_id, restored: state.trashed.map((a) => a.id) }));
}

const commands = { setup, update, run, score, teardown };
const cmd = commands[process.argv[2]];
if (!cmd) { console.error('Uso: setup | update | run | score | teardown'); process.exit(2); }
Promise.resolve(cmd()).catch((e) => { console.error(e.message); process.exit(1); });
