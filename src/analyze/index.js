// Analyzer: from an extracted input to a MECE proposal (MASTER-SPEC §7.5, UD-008).
//
//   analyze(bundle, { providers, onProgress, config, analyzer }) → Promise<AnalyzeResult>
//
// bundle = { text, attachments:[{id, kind, extracted}],
//            areas:[{id, title, description, position?}],
//            templates:[{id, area_id, name, description, body_markdown}],
//            members:[{id, name, profile}], project:{name, description},
//            recent_inputs?:[{id, created_at, text_excerpt, proposed_titles}], language?, job_id?, input_id? }
//   job_id and input_id, if present, become the `team.job_id` and `team.input_id` attributes of the analysis span.
//
// AnalyzeResult
//   { status: 'ok', proposal, units, calls, stats }
//   proposal = { messages:[{ area_id, template_id, title, body, fields, assignee_ids, attachment_ids, unit_ids }],
//                discarded:[{ unit_ids, reason }] }
//   Each message carries its own area and template: an input with a bug, an idea and a question comes out as
//   messages of three areas (idea.md: «uno o varios mensajes que agrupen el trabajo en categorías»).
//   Call 1 splits the units into groups {area_id, template_id, unit_ids}; call 2 decomposes
//   each group with its template, in parallel. Overlaps and gaps are computed over the union of all groups.
//
//   { status: 'refusal',   step, category, explanation, ... }  the provider refused; it is not retried the same way
//   { status: 'max_tokens', step, max_tokens, ... }            the output was cut twice (16,000 and 32,000)
//   { status: 'invalid',   step, errors, reason?, draft?, ... } invalid output after the single retry,
//                                                              or MECE conflict after the single rescue
//   All carry `units` (the numbered units), `calls` (one entry per model call, for
//   llm_calls: step, provider, model, usage, duration_ms, outcome) and `stats`.
//
// What is not a domain result is thrown (AnalyzeInputError, TemplateError, HarnessUnavailableError,
// HarnessError and the network or configuration provider errors); `error.calls` carries the calls already made.
//
// `onProgress({ percent, phrase })` is called per real completed step, never by clock (§7.10).
import { withSpan } from '../telemetry/api.js';
import { analyzeWithApi, warmCatalog, warmTemplate } from './api.js';
import { resolveConfig } from './config.js';
import { AnalyzeInputError } from './errors.js';
import { analyzeWithHarness } from './harness.js';

export * from './errors.js';
export { DEFAULT_CONFIG, KNOBS, resolveConfig } from './config.js';
export { compileFieldsSchema, loadTemplateFile, parseTemplate } from './templates.js';
export { buildClassificationSchema, buildDecompositionSchema, buildProposalSchema } from './schema.js';
export { numberUnits, partitionUnits, renderUnits } from './units.js';
export { warmCatalog, warmTemplate };

export const ANALYZERS = Object.freeze(['api', 'harness']);

/**
 * @param {object} bundle
 * @param {{providers?: object, onProgress?: (p: {percent: number, phrase: string}) => void, config?: object, analyzer?: 'api'|'harness', env?: Record<string, string|undefined>}} [opts]
 *   `analyzer` wins over `env.ANALYZER`; with neither, `api`.
 *   `redescribe(attachment)` (optional) returns a more detailed text for an image attachment; the second pass uses it (UD-021).
 */
export async function analyze(bundle, { providers, onProgress, config, analyzer, redescribe, env = process.env } = {}) {
  const kind = analyzer ?? (env.ANALYZER || 'api');
  if (!ANALYZERS.includes(kind)) throw new AnalyzeInputError(`ANALYZER debe ser «api» o «harness», no «${kind}»`);
  const resolved = resolveConfig(config);
  if (kind === 'api' && !providers?.text) throw new AnalyzeInputError('El analizador «api» necesita providers.text');
  // One span per analysis; `team.job_id` and `team.input_id` come from the bundle if present (UD-014).
  return withSpan(
    'analyze',
    { 'team.step': 'analyze', 'team.analyzer': kind, 'team.job_id': bundle?.job_id, 'team.input_id': bundle?.input_id },
    async (span) => {
      const result = kind === 'harness'
        ? await analyzeWithHarness(bundle, { onProgress, config: resolved })
        : await analyzeWithApi(bundle, { providers, onProgress, config: resolved, redescribe });
      span.setAttributes({
        'team.status': result.status,
        'team.units': result.units?.length,
        'team.messages': result.proposal?.messages.length,
        'team.invalid_retries': result.stats?.invalid_retries,
        'team.rescues': result.stats?.rescues,
        'team.second_pass': result.stats?.second_pass === true,
      });
      return result;
    },
  );
}
