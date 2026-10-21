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
//
// Writes <result>.usefulness.json next to each result: per-message scores, the median per case and overall.
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProviders } from '../src/providers/index.js';
import { costOf } from './pricing.js';
import { createSpend, withQueueRetries } from './spend.mjs';
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
    },
  });
  if (positionals.length === 0) throw new Error('Usage: judge-usefulness.mjs <result.json> [...] [--project file]');
  const ledger = createSpend({ resultsDir: values['results-dir'] ?? join(here, 'results'), budgetUsd: Number(values.budget) });
  const providers = createProviders(process.env);
  if (providers.text.unavailable) throw new Error(providers.text.unavailable);
  const project = values.project ? readFileSync(values.project, 'utf8') : '';
  const system = [RUBRIC, ...(project.trim() ? [`Project description (the same for every message you judge). Use it to check the project context:\n\n${project}`] : [])];

  // Jobs: every run of every case of every file. They are independent, so a bounded pool runs them side by side.
  const jobs = [];
  const outputs = positionals.map((file) => {
    const result = JSON.parse(readFileSync(file, 'utf8'));
    const out = { file, judged_at: new Date().toISOString(), source: basename(file), model: providers.text.model, project_in_prompt: Boolean(project.trim()), cases: [], cost_usd: 0 };
    for (const c of result.cases) {
      c.runs.forEach((run, runIndex) => {
        const entry = { case_id: c.case_id, run: runIndex + 1, scores: [], median: null, missing: [] };
        out.cases.push(entry);
        const messages = run.proposal?.messages ?? [];
        if (messages.length > 0) jobs.push({ out, entry, messages, units: run.units });
      });
    }
    return out;
  });

  async function judgeOne({ out, entry, messages, units }) {
    let missing = messages.map((_, i) => i + 1);
    const got = new Map();
    for (let attempt = 0; attempt < 2 && missing.length > 0; attempt += 1) {
      const label = `judge ${entry.case_id}`;
      ledger.assertBudget(label);
      const subset = missing.map((i) => messages[i - 1]);
      const response = await withQueueRetries(() => providers.text.complete({
        system,
        messages: [{ role: 'user', content: judgeUser({ messages: subset, units }) }],
        schema: RATINGS_SCHEMA,
        effort: 'medium',
        thinking: 'disabled',
      }), { onRetry: (e, n) => console.log(`${entry.case_id}: retry ${n} (${e.message.slice(0, 90)})`) });
      const cost = costOf({ model: response.model, usage: response.usage });
      out.cost_usd += cost ?? 0;
      const total = ledger.add(label, cost ?? 0, cost === null ? 1 : 0);
      const { ratings } = readRatings(response.json, subset.length);
      for (const [local, r] of ratings) got.set(missing[local - 1], r);
      missing = missing.filter((i) => !got.has(i));
      console.log(`${basename(out.file)} ${entry.case_id}: ${got.size}/${messages.length} rated (accumulated ${total.toFixed(4)} USD)`);
    }
    entry.scores = [...got].sort((a, b) => a[0] - b[0]).map(([index, r]) => ({ message_index: index, score: r.score, reason: r.reason }));
    entry.missing = missing;
    entry.median = median(entry.scores.map((s) => s.score));
  }

  let next = 0;
  let failure = null;
  await Promise.all(Array.from({ length: Number(values.concurrency) }, async () => {
    while (next < jobs.length && !failure) {
      const job = jobs[next++];
      try {
        await judgeOne(job);
      } catch (e) {
        failure = e;
      }
    }
  }));

  for (const out of outputs) {
    const all = out.cases.flatMap((c) => c.scores.map((s) => s.score));
    out.overall = { judged: all.length, median: median(all), mean: all.length ? all.reduce((a, b) => a + b, 0) / all.length : null };
    writeFileSync(out.file.replace(/\.json$/, '.usefulness.json'), JSON.stringify(out, null, 2));
    console.log(`${basename(out.file)}: ${all.length} messages, median ${out.overall.median}, mean ${out.overall.mean?.toFixed(2)}, ${out.cost_usd.toFixed(4)} USD`);
  }
  if (failure) {
    console.error(`Stopped: ${failure.message}`);
    process.exit(2);
  }
}
