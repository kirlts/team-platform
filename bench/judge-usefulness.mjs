#!/usr/bin/env node
// Usefulness judge of the bench (H-77). Measurement only: nothing here runs inside the product.
//
// For each result file written by run-private.mjs it asks the text provider (createProviders(process.env), the same
// one the analyzer uses) to rate every produced message from 1 to 5 against a fixed rubric, with structured output.
// The judge is blind to the variant: its prompt carries the source units a message cites and the message, never the
// variant label, the team or any member profile. The project description, when given, is the same text for every
// variant so that «right project context» can be checked against it.
//
//   node bench/judge-usefulness.mjs <result.json> [<result.json> ...] [--project file] [--concurrency n] [--budget USD]
//   node bench/judge-usefulness.mjs --pooled <result.json> ... [--per-run-cap n] [--judge-model id] [--out file] [--same-points]
//
// Default mode writes <result>.usefulness.json next to each result: per-message scores, the median per case and overall.
// --pooled puts the messages of every variant of a case in one call, shuffled and without labels, so the judge sees
// them side by side and cannot tell which variant wrote which; it writes one file with the scores by variant label.
// --judge-model sets the judge model (the analyzer's by default); with a model other than Haiku the judge runs at
// effort low with thinking left to the model (Sonnet 5.5 rejects thinking disabled).
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProviders } from '../src/providers/index.js';
import { costOf } from './pricing.js';
import { createSpend, withQueueRetries } from './spend.mjs';
import { mkdirSync } from 'node:fs';
import { median } from './compare.js';

export const RUBRIC = `You judge the messages that a tool wrote for a small software team from raw input (a meeting transcript, a chat, a feedback document, a screen recording). The messages are in Spanish. Rate each one from 1 to 5 on a single question: can a person on the team read the message body and understand what to do and why, with the right project context, without the message inventing facts?

Scale:
5 = A teammate can act without asking anything. The body says what to do and why, names the real parts of the product correctly, and every fact traces to the source or to the project description.
4 = The action and the reason are clear. One small gap: a missing detail the source had, or a generic sentence that adds nothing.
3 = Understandable, but the reason is missing, the action is vague, or the project context that would help is absent.
2 = Hard to act on: it only restates the source, loses what matters, or places the request in the wrong part of the product.
1 = Not usable. It contradicts the source or the project description.

Rules:
- A fact is invented when it appears in neither the cited source nor the project description: a name, a number, a file, a deadline, a decision, a cause. Any invented fact caps the score at 2. Say which fact in the reason.
- Wording that follows the source closely is not invention. Context taken from the project description is not invention when it is correct and it is relevant to the request.
- Judge the body. Read the title and the fields as part of the message, but do not reward a good title with a weak body.
- Do not reward length. A short body that is complete scores the same as a long one.
- Rate every message once, by its index. The reason is one sentence.`;

export const RATINGS_SCHEMA = {
  type: 'object',
  properties: {
    ratings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          reason: { type: 'string' },
          score: { type: 'integer', enum: [1, 2, 3, 4, 5] },
        },
        required: ['index', 'reason', 'score'],
        additionalProperties: false,
      },
    },
  },
  required: ['ratings'],
  additionalProperties: false,
};

/** User turn of one case: each message with the source units it cites. No variant, team or profile information. */
export function judgeUser({ messages, units }) {
  const byId = new Map(units.map((u) => [u.id, u]));
  const parts = [];
  messages.forEach((m, i) => {
    const cited = (m.unit_ids ?? []).map((id) => byId.get(id)).filter(Boolean);
    parts.push(`### Message ${i + 1}`, '', 'Cited source:', ...cited.map((u) => `[${u.id}] ${u.text}`), '');
    parts.push(`Title: ${m.title}`);
    for (const [key, value] of Object.entries(m.fields ?? {})) if (typeof value === 'string' && value.trim()) parts.push(`${key}: ${value}`);
    parts.push('Body:', m.body ?? '', '');
  });
  return parts.join('\n');
}

/** Deterministic pseudo-random generator (mulberry32) and a seed from a string, so that the shuffle can be repeated. */
export function seeded(text) {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Up to `cap` items spread evenly over the list, in order. */
export const spread = (list, cap) => (list.length <= cap ? list : Array.from({ length: cap }, (_, i) => list[Math.floor((i * list.length) / cap)]));

/** Fisher-Yates with the given random source. */
export function shuffle(list, random) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Pure part of the pipeline: validates the judge output against the messages it had to rate. */
export function readRatings(json, count) {
  const seen = new Map();
  for (const r of json?.ratings ?? []) {
    if (Number.isInteger(r.index) && r.index >= 1 && r.index <= count && Number.isInteger(r.score) && r.score >= 1 && r.score <= 5 && !seen.has(r.index)) seen.set(r.index, r);
  }
  return { ratings: seen, missing: Array.from({ length: count }, (_, i) => i + 1).filter((i) => !seen.has(i)) };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const here = dirname(fileURLToPath(import.meta.url));
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      project: { type: 'string' },
      concurrency: { type: 'string', default: '4' },
      budget: { type: 'string', default: '3' },
      'results-dir': { type: 'string' },
      'judge-model': { type: 'string' },
      'judge-effort': { type: 'string' },
      pooled: { type: 'boolean', default: false },
      'per-run-cap': { type: 'string', default: '4' },
      out: { type: 'string' },
      cases: { type: 'string' },
      'same-points': { type: 'boolean', default: false },
    },
  });
  if (positionals.length === 0) throw new Error('Usage: judge-usefulness.mjs <result.json> [...] [--project file]');
  const resultsDir = values['results-dir'] ?? join(here, 'results');
  const ledger = createSpend({ resultsDir, budgetUsd: Number(values.budget) });
  const env = values['judge-model'] ? { ...process.env, TEXT_MODEL: values['judge-model'] } : process.env;
  const providers = createProviders(env);
  if (providers.text.unavailable) throw new Error(providers.text.unavailable);
  const haiku = /haiku/.test(providers.text.model ?? '');
  const effort = values['judge-effort'] ?? (values['judge-model'] ? 'low' : 'medium');
  const thinking = haiku ? 'disabled' : undefined;
  const project = values.project ? readFileSync(values.project, 'utf8') : '';
  const system = [RUBRIC, ...(project.trim() ? [`Project description (the same for every message you judge). Use it to check the project context:\n\n${project}`] : [])];

  /** One judge call over `messages` (with the units they cite); returns Map(index -> rating) and the cost. */
  async function rate(label, messages, units) {
    let missing = messages.map((_, i) => i + 1);
    const got = new Map();
    let cost = 0;
    for (let attempt = 0; attempt < 2 && missing.length > 0; attempt += 1) {
      ledger.assertBudget(`judge ${label}`);
      const subset = missing.map((i) => messages[i - 1]);
      const response = await withQueueRetries(() => providers.text.complete({
        system,
        messages: [{ role: 'user', content: judgeUser({ messages: subset, units }) }],
        schema: RATINGS_SCHEMA,
        effort,
        maxTokens: 32000,
        ...(thinking ? { thinking } : {}),
      }), { attempts: 6, onRetry: (e, n) => console.log(`${label}: retry ${n} (${e.message.slice(0, 90)})`) });
      const spent = costOf({ model: response.model, usage: response.usage });
      cost += spent ?? 0;
      const total = ledger.add(`judge ${label}`, spent ?? 0, spent === null ? 1 : 0);
      const { ratings } = readRatings(response.json, subset.length);
      for (const [local, r] of ratings) got.set(missing[local - 1], r);
      missing = missing.filter((i) => !got.has(i));
      console.log(`${label}: ${got.size}/${messages.length} rated (accumulated ${total.toFixed(4)} USD)`);
    }
    return { got, missing, cost };
  }

  async function pool(jobs) {
    let next = 0;
    let failure = null;
    await Promise.all(Array.from({ length: Number(values.concurrency) }, async () => {
      while (next < jobs.length && !failure) {
        const job = jobs[next++];
        try {
          await job();
        } catch (e) {
          failure = e;
        }
      }
    }));
    return failure;
  }

  let failure;
  if (values.pooled) {
    // Group the runs of every file by variant label (a «-b» suffix marks a repetition of the same variant).
    const cap = Number(values['per-run-cap']);
    const labelOf = (r) => (r.variant ?? basename(r.file)).replace(/-b$/, '');
    const byCase = new Map();
    for (const file of positionals) {
      const result = JSON.parse(readFileSync(file, 'utf8'));
      const label = labelOf({ ...result, file });
      for (const c of result.cases) {
        const entry = byCase.get(c.case_id) ?? { units: null, byLabel: new Map() };
        byCase.set(c.case_id, entry);
        for (const run of c.runs) {
          entry.units ??= run.units;
          if (run.proposal?.messages?.length) entry.byLabel.set(label, [...(entry.byLabel.get(label) ?? []), ...run.proposal.messages]);
        }
      }
    }
    const out = { judged_at: new Date().toISOString(), model: providers.text.model, effort, per_run_cap: cap, project_in_prompt: Boolean(project.trim()), cost_usd: 0, variants: {} };
    const wanted = values.cases ? values.cases.split(',') : null;
    const jobs = [...byCase].filter(([id]) => !wanted || wanted.includes(id)).sort(([a], [b]) => a.localeCompare(b)).map(([caseId, entry]) => async () => {
      const items = [];
      // With --same-points, the variants whose label starts with «o-» are oracle runs: every one answered the same
      // reference points, so the same sampled points are judged for all of them, each answer taken from a repetition that
      // rotates with the point. The other variants contribute an even sample of their own messages.
      const isOracle = (label) => values['same-points'] && label.startsWith('o-');
      const keyOf = (m) => m.unit_ids.join(',');
      const oracle = new Map([...entry.byLabel].filter(([label]) => isOracle(label)).map(([label, messages]) => [label, messages.reduce((acc, m) => acc.set(keyOf(m), [...(acc.get(keyOf(m)) ?? []), m]), new Map())]));
      if (oracle.size > 0) {
        const common = [...oracle.values()].map((m) => new Set(m.keys())).reduce((x, y) => new Set([...x].filter((k) => y.has(k))));
        spread([...common], cap).forEach((key, i) => {
          for (const [label, byKey] of oracle) {
            const answers = byKey.get(key);
            items.push({ label, message: answers[i % answers.length] });
          }
        });
      }
      for (const [label, messages] of entry.byLabel) if (!isOracle(label)) for (const message of spread(messages, cap)) items.push({ label, message });
      if (items.length === 0) return;
      const shuffled = shuffle(items, seeded(caseId));
      const { got, cost } = await rate(caseId, shuffled.map((x) => x.message), entry.units);
      out.cost_usd += cost;
      shuffled.forEach((item, i) => {
        const v = (out.variants[item.label] ??= { cases: [] });
        let c = v.cases.find((x) => x.case_id === caseId);
        if (!c) v.cases.push((c = { case_id: caseId, scores: [], median: null }));
        const r = got.get(i + 1);
        if (r) c.scores.push({ score: r.score, reason: r.reason });
      });
    });
    failure = await pool(jobs);
    for (const v of Object.values(out.variants)) {
      for (const c of v.cases) c.median = median(c.scores.map((s) => s.score));
      const all = v.cases.flatMap((c) => c.scores.map((s) => s.score));
      v.judged = all.length;
      v.median = median(all);
      v.mean = all.length ? all.reduce((a, b) => a + b, 0) / all.length : null;
    }
    mkdirSync(resultsDir, { recursive: true });
    const file = values.out ?? join(resultsDir, `usefulness-${providers.text.model}-${out.judged_at.replace(/[:.]/g, '-')}.json`);
    writeFileSync(file, JSON.stringify(out, null, 2));
    for (const [label, v] of Object.entries(out.variants)) console.log(`${label}: ${v.judged} messages, median ${v.median}, mean ${v.mean?.toFixed(2)}`);
    console.log(`Judge cost ${out.cost_usd.toFixed(4)} USD; written ${file}`);
  } else {
    const jobs = [];
    const outputs = positionals.map((file) => {
      const result = JSON.parse(readFileSync(file, 'utf8'));
      const out = { file, judged_at: new Date().toISOString(), source: basename(file), model: providers.text.model, project_in_prompt: Boolean(project.trim()), cases: [], cost_usd: 0 };
      for (const c of result.cases) {
        c.runs.forEach((run, runIndex) => {
          const entry = { case_id: c.case_id, run: runIndex + 1, scores: [], median: null, missing: [] };
          out.cases.push(entry);
          const messages = run.proposal?.messages ?? [];
          if (messages.length > 0) {
            jobs.push(async () => {
              const { got, missing, cost } = await rate(`${basename(file)} ${c.case_id}`, messages, run.units);
              out.cost_usd += cost;
              entry.scores = [...got].sort((x, y) => x[0] - y[0]).map(([index, r]) => ({ message_index: index, score: r.score, reason: r.reason }));
              entry.missing = missing;
              entry.median = median(entry.scores.map((x) => x.score));
            });
          }
        });
      }
      return out;
    });
    failure = await pool(jobs);
    for (const out of outputs) {
      const all = out.cases.flatMap((c) => c.scores.map((s) => s.score));
      out.overall = { judged: all.length, median: median(all), mean: all.length ? all.reduce((a, b) => a + b, 0) / all.length : null };
      writeFileSync(out.file.replace(/\.json$/, '.usefulness.json'), JSON.stringify(out, null, 2));
      console.log(`${basename(out.file)}: ${all.length} messages, median ${out.overall.median}, mean ${out.overall.mean?.toFixed(2)}, ${out.cost_usd.toFixed(4)} USD`);
    }
  }
  if (failure) {
    console.error(`Stopped: ${failure.message}`);
    process.exit(2);
  }
}
