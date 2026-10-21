// Analizador `harness` (UD-008, MASTER-SPEC §7.5): `claude -p` por input.
//
// Reutiliza la suscripción de Claude Code que el equipo ya paga. Va SIN `--bare`: `--bare` no lee el
// login de suscripción ni credenciales OAuth y exige ANTHROPIC_API_KEY (documentación oficial,
// code.claude.com/docs/en/headless, consultada el 2026-10-20). Lo más cerca de bare que permite la
// suscripción es un directorio de trabajo vacío y propio de cada análisis, sin sesión guardada y con
// sólo herramientas de lectura. La sobrecarga se mide con `usage` y `total_cost_usd` de la salida JSON.
//
// El bundle se escribe en archivos de ese directorio (input.md, bundle.json, templates/<id>.md); el
// harness lee las plantillas por archivo, como las dos llamadas de `api` las revelan de a una.
// La salida pasa por el mismo validador que `api`.
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordGenAiCall, withSpan } from '../telemetry/api.js';
import { AnalyzeInputError, HarnessError, HarnessUnavailableError } from './errors.js';
import { harnessPrompt } from './prompts.js';
import { buildProposalSchema } from './schema.js';
import { parseTemplate } from './templates.js';
import { numberUnits, renderUnits } from './units.js';
import { describeConflicts, normalizeDecomposition, validateProposal } from './validate.js';

const PROVIDER = 'claude-code';

async function writeWorkdir(dir, bundle, units) {
  await mkdir(join(dir, 'templates'));
  await writeFile(join(dir, 'input.md'), `${renderUnits(units)}\n`);
  await writeFile(
    join(dir, 'bundle.json'),
    JSON.stringify(
      {
        areas: bundle.areas.map((a) => ({ id: a.id, title: a.title, description: a.description })),
        templates: bundle.templates.map((t) => ({ id: t.id, area_id: t.area_id, name: t.name, description: t.description })),
        project: { name: bundle.project?.name ?? '', description: bundle.project?.description ?? '' },
        members: (bundle.members ?? []).map((m) => ({ id: m.id, name: m.name, profile: m.profile ?? '' })),
        attachments: (bundle.attachments ?? []).map((a) => ({ id: a.id, kind: a.kind })),
        unit_count: units.length,
      },
      null,
      2,
    ),
  );
  for (const t of bundle.templates) {
    if (typeof t.body_markdown === 'string') await writeFile(join(dir, 'templates', `${t.id}.md`), t.body_markdown);
  }
}

/** Ejecuta `claude -p` y devuelve el objeto de resultado. */
function runClaude({ bin, args, prompt, cwd, env, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(bin, args, { cwd, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (cause) {
      reject(new HarnessUnavailableError(`No se pudo ejecutar «${bin}»: ${cause.message}`, { bin, cause }));
      return;
    }
    const out = [];
    const err = [];
    let timedOut = false;
    // La señal va solo al proceso que este módulo lanzó, nunca al padre.
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (c) => out.push(c));
    child.stderr.on('data', (c) => err.push(c));
    child.on('error', (cause) => {
      clearTimeout(timer);
      if (cause.code === 'ENOENT' || cause.code === 'EACCES') {
        reject(new HarnessUnavailableError(`El analizador «harness» necesita Claude Code instalado: no se encontró «${bin}» (ANALYZER=harness)`, { bin, cause }));
      } else {
        reject(new HarnessError(`Falló el arranque de «${bin}»: ${cause.message}`, { cause }));
      }
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(out).toString('utf8');
      const stderr = Buffer.concat(err).toString('utf8');
      if (timedOut) {
        reject(new HarnessError(`claude -p superó el plazo de ${timeoutMs} ms`, { exitCode: code, stderr }));
        return;
      }
      let parsed = null;
      try {
        parsed = JSON.parse(stdout);
      } catch {
        parsed = null;
      }
      // Algunas versiones entregan la lista de eventos: el resultado es el elemento de tipo `result`.
      if (Array.isArray(parsed)) parsed = parsed.findLast((e) => e?.type === 'result') ?? null;
      if (code !== 0 && !parsed) {
        reject(new HarnessError(`claude -p terminó con código ${code}: ${stderr.trim().slice(0, 500) || 'sin mensaje'}`, { exitCode: code, stderr }));
        return;
      }
      if (!parsed) {
        reject(new HarnessError('claude -p no devolvió JSON', { exitCode: code, stderr: stdout.slice(0, 500) }));
        return;
      }
      resolve(parsed);
    });
    child.stdin.on('error', () => {}); // si el proceso muere antes de leer, el error llega por `close`
    child.stdin.end(prompt);
  });
}

function toCallEntry(result, step) {
  const u = result.usage ?? {};
  const modelNames = Object.keys(result.modelUsage ?? {});
  return {
    step,
    modality: 'text',
    provider: PROVIDER,
    model: modelNames.length === 1 ? modelNames[0] : (modelNames.join(',') || null),
    usage: {
      input_tokens: u.input_tokens ?? 0,
      output_tokens: u.output_tokens ?? 0,
      cached_tokens: u.cache_read_input_tokens ?? 0,
      cache_creation_tokens: u.cache_creation_input_tokens ?? 0,
    },
    cost_usd: result.total_cost_usd ?? null,
    duration_ms: result.duration_ms ?? null,
    num_turns: result.num_turns ?? null,
    outcome: result.is_error ? 'error' : 'ok',
  };
}

/** Valida el Proposal completo del harness con el mismo validador que `api`. */
function validateHarnessProposal(proposal, bundle, units) {
  if (!proposal || typeof proposal !== 'object') return { errors: ['la salida no es un objeto'] };
  const { templates } = bundle;
  const fieldsByTemplate = new Map();
  for (const m of Array.isArray(proposal.messages) ? proposal.messages : []) {
    const row = templates.find((t) => t.id === m?.template_id);
    if (!row || fieldsByTemplate.has(row.id)) continue;
    if (typeof row.body_markdown !== 'string') return { errors: [`la plantilla ${row.id} no trae su cuerpo`] };
    fieldsByTemplate.set(row.id, parseTemplate(row.body_markdown, { source: `plantilla ${row.id}` }).fields);
  }
  const v = validateProposal(proposal, {
    templates,
    fieldsByTemplate,
    scope: new Set(units.map((u) => u.id)),
    memberIds: new Set((bundle.members ?? []).map((m) => m.id)),
    attachmentIds: new Set((bundle.attachments ?? []).map((a) => a.id)),
  });
  return { errors: [...v.errors, ...describeConflicts(v.conflicts)] };
}

/**
 * @param {object} bundle
 * @param {{onProgress?: Function, config: object}} opts  `config` ya resuelta
 */
export async function analyzeWithHarness(bundle, { onProgress, config }) {
  if (!bundle?.areas?.length || !bundle?.templates?.length) throw new AnalyzeInputError('El bundle no trae áreas o plantillas');
  const units = numberUnits(bundle);
  if (units.length === 0) throw new AnalyzeInputError('El input no tiene texto ni adjuntos con texto extraído');
  const calls = [];
  const stats = { chunks: 1, groups: 0, classification_chunks: 1, rescues: 0, invalid_retries: 0, max_tokens_retries: 0, partitioned: false, units: units.length };
  let done = 0;
  const report = (phrase) => onProgress?.({ percent: Math.round((100 * done) / 3), phrase });

  const workRoot = config.harnessWorkRoot ?? tmpdir();
  const dir = await mkdtemp(join(workRoot, 'team-analyze-'));
  try {
    report('preparando el análisis');
    await writeWorkdir(dir, bundle, units);
    done = 1;

    const tools = config.harnessTools.join(',');
    const args = [
      '-p',
      '--output-format', 'json',
      '--json-schema', JSON.stringify(buildProposalSchema()),
      `--tools=${tools}`,
      `--allowedTools=${tools}`,
      '--permission-mode=dontAsk',
      '--no-session-persistence',
    ];

    let retryErrors = [];
    for (let attempt = 0; ; attempt += 1) {
      report(attempt === 0 ? 'analizando con Claude Code' : 'corrigiendo la propuesta');
      let result;
      const prompt = harnessPrompt({ unitCount: units.length, retryErrors });
      try {
        // Un span por invocación de `claude -p`, con el costo real que informa (`total_cost_usd`), sin estimarlo.
        result = await withSpan('harness', { 'team.step': 'harness', 'team.attempt': attempt + 1 }, async (span) => {
          const r = await runClaude({
            bin: config.harnessBin,
            args,
            prompt,
            cwd: dir,
            env: config.harnessEnv,
            timeoutMs: config.harnessTimeoutMs,
          });
          const call = toCallEntry(r, 'harness');
          recordGenAiCall(span, {
            provider: PROVIDER,
            model: call.model,
            request: { messages: [{ role: 'user', content: prompt }] },
            response: { text: JSON.stringify(r.structured_output ?? r.result ?? null), model: call.model, stop_reason: r.stop_reason },
            usage: call.usage,
            cost: r.total_cost_usd ?? null,
          });
          return r;
        });
      } catch (err) {
        err.calls = calls;
        throw err;
      }
      const entry = toCallEntry(result, attempt === 0 ? 'harness' : 'harness-retry');
      calls.push(entry);

      if (result.stop_reason === 'refusal') {
        return { status: 'refusal', step: entry.step, category: result.stop_details?.category ?? null, explanation: null, errors: [], units, calls, stats };
      }
      let errors;
      let checked = null;
      if (result.is_error) {
        errors = [`claude -p informó un error (${result.subtype ?? 'sin subtipo'}): ${String(result.result ?? '').slice(0, 300)}`];
      } else {
        let proposal = result.structured_output;
        if (proposal === undefined && typeof result.result === 'string') {
          try {
            proposal = JSON.parse(result.result);
          } catch {
            proposal = undefined;
          }
        }
        if (proposal === undefined) {
          errors = ['claude -p no devolvió structured_output'];
        } else {
          checked = withSpan('validate', { 'team.step': 'validate', 'team.validated_step': 'harness' }, (span) => {
            const v = validateHarnessProposal(proposal, bundle, units);
            span.setAttributes({ 'team.valid': v.errors.length === 0, 'team.error_count': v.errors.length });
            if (v.errors.length > 0) span.setAttribute('team.errors', v.errors.slice(0, 10).map((e) => String(e).slice(0, 300)));
            return v;
          });
          errors = checked.errors;
          if (errors.length === 0) {
            done = 2;
            report('validando la propuesta');
            const { messages, discarded } = normalizeDecomposition(proposal);
            done = 3;
            report('propuesta lista');
            return { status: 'ok', proposal: { messages, discarded }, units, calls, stats };
          }
        }
      }
      // Una salida inválida reintenta una vez con el error como contexto; después, el trabajo falla con el motivo (§7.5).
      if (attempt >= config.invalidOutputRetries) {
        return { status: 'invalid', step: entry.step, errors, units, calls, stats };
      }
      stats.invalid_retries += 1;
      retryErrors = errors;
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
