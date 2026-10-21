// Side-by-side comparison of several private-bench result files (H-77). Pure functions: the caller loads the files and
// supplies `inputOf(caseId)`, the extracted input text, so that a mark the input itself contains is not counted as a
// tell (see ai-tells.js). Nothing here prints client text: only counts and rates.
import { mergeAssignment } from './score.js';
import { tellsOfProposal } from './ai-tells.js';

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const ratio = (n, d) => (d === 0 ? null : n / d);
export function median(xs) {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * @param {Array<{ file: string, variant?: string|null, context?: object, cases: object[], usefulness?: object|null }>} results
 * @param {{ inputOf?: (caseId: string) => string }} [opts]
 */
export function compareResults(results, { inputOf = () => '' } = {}) {
  const variants = results.map((r) => {
    const runs = r.cases.flatMap((c) => c.runs.map((run) => ({ ...run, case_id: c.case_id })));
    const counts = (key) => sum(runs.map((x) => x.score.counts[key] ?? 0));
    const assignment = mergeAssignment(runs.map((x) => x.score.assignment));
    let tells = 0;
    let messages = 0;
    for (const run of runs) {
      if (!run.proposal) continue;
      const t = tellsOfProposal(run.proposal, { input: inputOf(run.case_id) });
      tells += t.total;
      messages += t.messages;
    }
    const costs = runs.map((x) => x.usage.cost_usd);
    const names = Object.fromEntries((r.context?.members ?? []).map((m) => [String(m.id), m.name]));
    const u = r.usefulness;
    const scores = u ? u.cases.flatMap((c) => c.scores.map((s) => s.score)) : [];
    return {
      label: r.variant ?? r.file,
      cases: r.cases.length,
      runs: runs.length,
      ok: runs.filter((x) => x.status === 'ok').length,
      mece: runs.filter((x) => x.score.mece).length,
      coverage: ratio(counts('covered'), counts('expected_messages')),
      expected_messages: counts('expected_messages'),
      actual_messages: counts('actual_messages'),
      classification: ratio(counts('both_correct'), counts('units')),
      assignment,
      member_names: names,
      tells_per_message: ratio(tells, messages),
      tells,
      messages,
      median_seconds: median(runs.map((x) => x.total_ms / 1000)),
      cost_usd: costs.some((c) => c === null) ? null : sum(costs),
      usefulness: u
        ? { judged: scores.length, median: median(scores), mean: ratio(sum(scores), scores.length), case_medians_median: median(u.cases.map((c) => c.median).filter((m) => m !== null)), judge_cost_usd: u.cost_usd ?? null }
        : null,
    };
  });
  return { variants };
}

const pct = (x) => (x === null || x === undefined ? 'n/a' : `${(x * 100).toFixed(1)} %`);
const num = (x, digits = 2) => (x === null || x === undefined ? 'n/a' : x.toFixed(digits));

/** Markdown tables: one row per measure, one column per variant; then one row per member. */
export function formatComparison({ variants }) {
  const table = (header, rows) => [
    `| ${header.join(' | ')} |`,
    `| ${header.map((_, i) => (i === 0 ? '---' : '---:')).join(' | ')} |`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n');
  const head = ['Measure', ...variants.map((v) => v.label)];
  const rows = [
    ['Cases (runs)', (v) => `${v.cases} (${v.runs})`],
    ['Status ok', (v) => `${v.ok}/${v.runs}`],
    ['MECE cases', (v) => `${v.mece}/${v.runs}`],
    ['Coverage', (v) => pct(v.coverage)],
    ['Messages obtained / expected', (v) => `${v.actual_messages} / ${v.expected_messages}`],
    ['Classification (area and template)', (v) => pct(v.classification)],
    ['Assignment: exact set', (v) => `${pct(v.assignment.accuracy)} (${v.assignment.exact}/${v.assignment.pairs})`],
    ['Assignment: precision', (v) => pct(v.assignment.precision)],
    ['Assignment: recall', (v) => pct(v.assignment.recall)],
    ['AI tells per message', (v) => num(v.tells_per_message, 3)],
    ['Median time per case (s)', (v) => num(v.median_seconds, 1)],
    ['Analysis cost (USD)', (v) => num(v.cost_usd, 4)],
    ['Usefulness: median of messages (1 to 5)', (v) => (v.usefulness ? num(v.usefulness.median, 1) : 'n/a')],
    ['Usefulness: mean of messages', (v) => (v.usefulness ? num(v.usefulness.mean) : 'n/a')],
    ['Usefulness: median of case medians', (v) => (v.usefulness ? num(v.usefulness.case_medians_median, 1) : 'n/a')],
    ['Messages judged', (v) => (v.usefulness ? String(v.usefulness.judged) : 'n/a')],
    ['Judge cost (USD)', (v) => (v.usefulness ? num(v.usefulness.judge_cost_usd, 4) : 'n/a')],
  ].map(([name, f]) => [name, ...variants.map(f)]);

  const ids = [...new Set(variants.flatMap((v) => Object.keys(v.assignment.per_member)))].sort((a, b) => Number(a) - Number(b));
  const nameOf = (id) => variants.map((v) => v.member_names[id]).find(Boolean) ?? `member ${id}`;
  const memberRows = ids.flatMap((id) => [
    [`${nameOf(id)}: expected in`, ...variants.map((v) => String(v.assignment.per_member[id]?.expected ?? 0))],
    [`${nameOf(id)}: precision`, ...variants.map((v) => pct(v.assignment.per_member[id]?.precision ?? null))],
    [`${nameOf(id)}: recall`, ...variants.map((v) => pct(v.assignment.per_member[id]?.recall ?? null))],
    [`${nameOf(id)}: exact set when expected`, ...variants.map((v) => pct(v.assignment.per_member[id]?.exact_when_expected_rate ?? null))],
    [`${nameOf(id)}: membership accuracy`, ...variants.map((v) => pct(v.assignment.per_member[id]?.accuracy ?? null))],
  ]);
  return `${table(head, rows)}\n\nAssignment per member (pairs: expected message covered by an obtained message)\n\n${table(head, memberRows)}`;
}
