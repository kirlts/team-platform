// Analizador: de un input extraído a una propuesta MECE (MASTER-SPEC §7.5, UD-008).
//
//   analyze(bundle, { providers, onProgress, config, analyzer }) → Promise<AnalyzeResult>
//
// bundle = { text, attachments:[{id, kind, extracted}],
//            areas:[{id, title, description, position?}],
//            templates:[{id, area_id, name, description, body_markdown}],
//            members:[{id, name, responsibilities, domains}] }
//
// AnalyzeResult
//   { status: 'ok', proposal, units, calls, stats }
//   proposal = { messages:[{ area_id, template_id, title, body, fields, assignee_ids, attachment_ids, unit_ids }],
//                discarded:[{ unit_ids, reason }] }
//   Cada mensaje lleva su propia área y plantilla: un input con un error, una idea y una pregunta sale en
//   mensajes de tres áreas (idea.md: «uno o varios mensajes que agrupen el trabajo en categorías»).
//   La llamada 1 reparte las unidades en grupos {area_id, template_id, unit_ids}; la llamada 2 descompone
//   cada grupo con su plantilla, en paralelo. Solapes y huecos se calculan sobre la unión de todos los grupos.
//
//   { status: 'refusal',   step, category, explanation, ... }  el proveedor rechazó; no se reintenta igual
//   { status: 'max_tokens', step, max_tokens, ... }            la salida se cortó dos veces (16.000 y 32.000)
//   { status: 'invalid',   step, errors, reason?, draft?, ... } salida inválida tras el único reintento,
//                                                              o conflicto MECE tras el único rescate
//   Todos llevan `units` (las unidades numeradas), `calls` (una entrada por llamada al modelo, para
//   llm_calls: step, provider, model, usage, duration_ms, outcome) y `stats`.
//
// Lo que no es un resultado de dominio se lanza (AnalyzeInputError, TemplateError, HarnessUnavailableError,
// HarnessError y los errores de proveedor de red o configuración); `error.calls` trae las llamadas ya hechas.
//
// `onProgress({ percent, phrase })` se llama por paso real completado, nunca por reloj (§7.10).
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
 *   `analyzer` gana sobre `env.ANALYZER`; sin ninguno de los dos, `api`.
 */
export async function analyze(bundle, { providers, onProgress, config, analyzer, env = process.env } = {}) {
  const kind = analyzer ?? (env.ANALYZER || 'api');
  if (!ANALYZERS.includes(kind)) throw new AnalyzeInputError(`ANALYZER debe ser «api» o «harness», no «${kind}»`);
  const resolved = resolveConfig(config);
  if (kind === 'harness') return analyzeWithHarness(bundle, { onProgress, config: resolved });
  if (!providers?.text) throw new AnalyzeInputError('El analizador «api» necesita providers.text');
  return analyzeWithApi(bundle, { providers, onProgress, config: resolved });
}
