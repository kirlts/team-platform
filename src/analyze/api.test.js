// Pruebas del analizador `api` con el proveedor falso: la mecánica (numerar, validar, rescatar,
// reintentar) se prueba sin red y sin modelo.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createFakeProviders, ProviderHttpError, ProviderMaxTokensError, ProviderOutputError, ProviderRefusalError,
} from '../providers/index.js';
import { analyze, AnalyzeInputError, warmTemplate } from './index.js';
import { decomposeSystem } from './prompts.js';
import { parseTemplate } from './templates.js';
import { bugMessage, ERROR_AREA, goodDecomposition, lastUserText, makeBundle, seed, unitIdsIn } from './testing/fixtures.js';

const ids = (messages) => messages.map((m) => m.unit_ids);

describe('analyze (api): un input con tres puntos mezclados', () => {
  it('sale en tres mensajes con unit_ids disjuntos, sin huecos y con lo no accionable descartado', async () => {
    const bundle = await makeBundle();
    const fake = createFakeProviders({ text: [ERROR_AREA, goodDecomposition()] });
    const progress = [];
    const result = await analyze(bundle, { providers: fake, onProgress: (p) => progress.push(p) });

    assert.equal(result.status, 'ok');
    const { proposal } = result;
    assert.equal(proposal.area_id, 2);
    assert.equal(proposal.template_id, 2);
    assert.equal(proposal.messages.length, 3);
    assert.deepEqual(ids(proposal.messages), [[2, 4], [3], [5]]);
    const all = [...proposal.messages.flatMap((m) => m.unit_ids), ...proposal.discarded.flatMap((d) => d.unit_ids)].sort((a, b) => a - b);
    assert.deepEqual(all, [1, 2, 3, 4, 5, 6], 'cada unidad exactamente una vez');
    assert.equal(new Set(all).size, all.length, 'disjuntos');
    assert.equal(result.units.length, 6);

    // Dos llamadas: clasificar con esfuerzo low y descomponer con medium (informe 02 §10.2).
    assert.equal(fake.calls.text.length, 2);
    assert.equal(fake.calls.text[0].effort, 'low');
    assert.equal(fake.calls.text[1].effort, 'medium');
    assert.equal(fake.calls.text[0].maxTokens, 16_000);
    assert.equal(fake.calls.text[1].cacheTtl, '5m');
    assert.deepEqual(result.calls.map((c) => c.step), ['classify', 'decompose']);
    assert.ok(result.calls.every((c) => c.usage && c.provider === 'fake' && c.outcome === 'ok'));
  });

  it('la primera llamada ve áreas y plantillas con título y descripción; la segunda, el cuerpo de la elegida', async () => {
    const bundle = await makeBundle();
    const fake = createFakeProviders({ text: [ERROR_AREA, goodDecomposition()] });
    await analyze(bundle, { providers: fake });
    const [classify, decompose] = fake.calls.text;
    const catalog = classify.system.join('\n');
    for (const a of bundle.areas) assert.ok(catalog.includes(a.description));
    for (const t of bundle.templates) assert.ok(catalog.includes(t.description));
    assert.ok(!catalog.includes('## Método'), 'la primera llamada no ve cuerpos');
    assert.deepEqual(classify.schema.properties.area_id.enum, [1, 2, 3, 4, 5]);

    assert.ok(decompose.system.join('\n').includes('Un mensaje por error.'), 'cuerpo de la plantilla elegida');
    assert.ok(!decompose.system.join('\n').includes('Un mensaje por idea.'));
    // Esquema compilado de los fields de la plantilla (gramática de Anthropic).
    const f = decompose.schema.properties.messages.items.properties.fields;
    assert.deepEqual(f.required, ['steps', 'expected', 'actual']);
    assert.deepEqual(Object.keys(f.properties), ['steps', 'expected', 'actual', 'where', 'impact']);
    // El usuario recibe equipo, adjuntos y unidades numeradas.
    const user = lastUserText(decompose);
    assert.match(user, /Miembro 2: Bruno Silva/);
    assert.match(user, /Adjunto 10: image \(sin texto extraído\)/);
    assert.match(user, /\[u1\] Hola equipo/);
    assert.match(user, /\[u6\] Gracias/);
  });

  it('el progreso avanza por pasos reales, sin retroceder, hasta 100', async () => {
    const fake = createFakeProviders({ text: [ERROR_AREA, goodDecomposition()] });
    const progress = [];
    await analyze(await makeBundle(), { providers: fake, onProgress: (p) => progress.push(p) });
    const pct = progress.map((p) => p.percent);
    assert.deepEqual([...pct].sort((a, b) => a - b), pct);
    assert.equal(pct.at(-1), 100);
    assert.ok(progress.every((p) => typeof p.phrase === 'string' && p.phrase.length > 0));
  });

  it('un input sin texto utilizable es un error de entrada', async () => {
    const bundle = await makeBundle({ text: '   ', attachments: [{ id: 1, kind: 'image', extracted: null }] });
    await assert.rejects(analyze(bundle, { providers: createFakeProviders({ text: [] }) }), AnalyzeInputError);
  });

  it('ANALYZER desconocido es un error; por omisión es api', async () => {
    const fake = createFakeProviders({ text: [ERROR_AREA, goodDecomposition()] });
    await assert.rejects(analyze(await makeBundle(), { providers: fake, env: { ANALYZER: 'otro' } }), AnalyzeInputError);
    assert.equal((await analyze(await makeBundle(), { providers: fake, env: {} })).status, 'ok');
  });
});

describe('analyze (api): solapes, huecos y rescate', () => {
  it('un solape dispara un único pase de rescate sobre el conflicto', async () => {
    const solapada = goodDecomposition();
    solapada.messages[1].unit_ids = [3, 4]; // u4 queda también en el mensaje A
    const rescate = {
      messages: [bugMessage([2, 3, 4], 'Corregir ingreso en blanco y fechas del CSV')],
      discarded: [],
    };
    const fake = createFakeProviders({ text: [ERROR_AREA, solapada, rescate] });
    const result = await analyze(await makeBundle(), { providers: fake });

    assert.equal(result.status, 'ok');
    assert.equal(fake.calls.text.length, 3, 'clasificar, descomponer y un rescate');
    assert.equal(result.stats.rescues, 1);
    assert.deepEqual(result.calls.map((c) => c.step), ['classify', 'decompose', 'rescue']);
    // El rescate recibe sólo el conflicto: la u4 y los mensajes que la compartían, no el input entero.
    const prompt = lastUserText(fake.calls.text[2]);
    assert.match(prompt, /u4: mensaje 1 y mensaje 2/);
    assert.match(prompt, /\[u4\]/);
    assert.ok(!prompt.includes('[u5]'), 'las unidades sin conflicto no se reenvían');
    assert.deepEqual(result.proposal.messages.map((m) => m.unit_ids), [[2, 3, 4], [5]]);
  });

  it('un hueco (unidad en ningún lugar) también se rescata, sólo con las unidades faltantes', async () => {
    const conHueco = goodDecomposition();
    conHueco.discarded = [{ unit_ids: [1], reason: 'saludo' }]; // falta la u6
    const rescate = { messages: [], discarded: [{ unit_ids: [6], reason: 'despedida' }] };
    const fake = createFakeProviders({ text: [ERROR_AREA, conHueco, rescate] });
    const result = await analyze(await makeBundle(), { providers: fake });
    assert.equal(result.status, 'ok');
    assert.equal(fake.calls.text.length, 3);
    const prompt = lastUserText(fake.calls.text[2]);
    assert.match(prompt, /Unidades que ninguna parte de la salida cubre: u6/);
    assert.ok(!prompt.includes('Mensajes que hay que rehacer'));
    assert.deepEqual(result.proposal.discarded.map((d) => d.unit_ids), [[1], [6]]);
  });

  it('si el rescate no resuelve el conflicto, el trabajo falla con el motivo y no hay un segundo rescate', async () => {
    const solapada = goodDecomposition();
    solapada.messages[1].unit_ids = [3, 4];
    const rescateMalo = { messages: [bugMessage([2, 3, 4], 'A'), bugMessage([4], 'B')], discarded: [] };
    const fake = createFakeProviders({ text: [ERROR_AREA, solapada, rescateMalo] });
    const result = await analyze(await makeBundle(), { providers: fake });
    assert.equal(result.status, 'invalid');
    assert.equal(result.reason, 'mece_conflict');
    assert.match(result.errors.join('\n'), /la unidad 4 está en más de un lugar/);
    assert.equal(fake.calls.text.length, 3);
  });

  it('con rescuePasses en 0 el conflicto falla sin llamar al rescate', async () => {
    const solapada = goodDecomposition();
    solapada.messages[1].unit_ids = [3, 4];
    const fake = createFakeProviders({ text: [ERROR_AREA, solapada] });
    const result = await analyze(await makeBundle(), { providers: fake, config: { rescuePasses: 0 } });
    assert.equal(result.status, 'invalid');
    assert.equal(fake.calls.text.length, 2);
  });
});

describe('analyze (api): salida inválida', () => {
  it('se reintenta una vez con el error como contexto y la segunda salida buena se acepta', async () => {
    const mala = goodDecomposition();
    delete mala.messages[0].fields.actual;
    const fake = createFakeProviders({ text: [ERROR_AREA, mala, goodDecomposition()] });
    const result = await analyze(await makeBundle(), { providers: fake });
    assert.equal(result.status, 'ok');
    assert.equal(fake.calls.text.length, 3);
    const retry = fake.calls.text[2];
    assert.equal(retry.messages.at(-2).role, 'assistant');
    assert.equal(retry.messages.at(-1).role, 'user');
    assert.match(retry.messages.at(-1).content, /mensaje 1.*falta «actual»/);
    assert.equal(result.stats.invalid_retries, 1);
  });

  it('si el reintento también es inválido, el trabajo falla con los errores y no se reintenta otra vez', async () => {
    const mala = goodDecomposition();
    mala.messages[0].assignee_ids = [99];
    const fake = createFakeProviders({ text: [ERROR_AREA, mala, mala] });
    const result = await analyze(await makeBundle(), { providers: fake });
    assert.equal(result.status, 'invalid');
    assert.match(result.errors.join('\n'), /el miembro 99 no existe/);
    assert.equal(fake.calls.text.length, 3);
  });

  it('un adjunto que no es del input y una unidad inexistente son errores de referencia', async () => {
    const mala = goodDecomposition();
    mala.messages[1].attachment_ids = [55];
    mala.messages[2].unit_ids = [5, 77];
    const fake = createFakeProviders({ text: [ERROR_AREA, mala, mala] });
    const result = await analyze(await makeBundle(), { providers: fake });
    assert.equal(result.status, 'invalid');
    const errors = result.errors.join('\n');
    assert.match(errors, /el adjunto 55 no pertenece al input/);
    assert.match(errors, /la unidad 77 no existe/);
  });

  it('una clasificación con la plantilla de otra área se reintenta', async () => {
    const fake = createFakeProviders({ text: [{ area_id: 1, template_id: 2 }, ERROR_AREA, goodDecomposition()] });
    const result = await analyze(await makeBundle(), { providers: fake });
    assert.equal(result.status, 'ok');
    assert.match(fake.calls.text[1].messages.at(-1).content, /la plantilla 2 no pertenece al área 1/);
  });

  it('una salida que ni es JSON (ProviderOutputError) se reintenta con su motivo', async () => {
    const roto = new ProviderOutputError('anthropic: la salida no es JSON', { raw: '{"messages": [' });
    const fake = createFakeProviders({ text: [ERROR_AREA, roto, goodDecomposition()] });
    const result = await analyze(await makeBundle(), { providers: fake });
    assert.equal(result.status, 'ok');
    assert.equal(result.calls[1].outcome, 'invalid_output');
    assert.match(fake.calls.text[2].messages.at(-1).content, /no es JSON/);
  });
});

describe('analyze (api): refusal y max_tokens son estados', () => {
  it('un refusal en la clasificación no se reintenta y vuelve con su categoría', async () => {
    const refusal = new ProviderRefusalError('rechazo', { category: 'cyber', usage: { input_tokens: 50, output_tokens: 0, cached_tokens: 0 } });
    const fake = createFakeProviders({ text: [refusal] });
    const result = await analyze(await makeBundle(), { providers: fake });
    assert.equal(result.status, 'refusal');
    assert.equal(result.category, 'cyber');
    assert.equal(result.step, 'classify');
    assert.equal(fake.calls.text.length, 1);
    assert.equal(result.calls[0].outcome, 'refusal');
    assert.equal(result.calls[0].usage.input_tokens, 50, 'el rechazo también cuesta tokens y se registra');
  });

  it('un refusal en la descomposición tampoco se reintenta igual', async () => {
    const fake = createFakeProviders({ text: [ERROR_AREA, new ProviderRefusalError('rechazo', { category: 'general_harms' })] });
    const result = await analyze(await makeBundle(), { providers: fake });
    assert.equal(result.status, 'refusal');
    assert.equal(result.step, 'decompose');
    assert.equal(fake.calls.text.length, 2);
  });

  it('un corte por max_tokens reintenta una vez con el doble', async () => {
    const corte = new ProviderMaxTokensError('corte', { maxTokens: 16_000 });
    const fake = createFakeProviders({ text: [ERROR_AREA, corte, goodDecomposition()] });
    const result = await analyze(await makeBundle(), { providers: fake });
    assert.equal(result.status, 'ok');
    assert.equal(fake.calls.text[1].maxTokens, 16_000);
    assert.equal(fake.calls.text[2].maxTokens, 32_000);
    assert.equal(result.stats.max_tokens_retries, 1);
  });

  it('dos cortes seguidos son el estado max_tokens', async () => {
    const corte = new ProviderMaxTokensError('corte');
    const fake = createFakeProviders({ text: [ERROR_AREA, corte, corte] });
    const result = await analyze(await makeBundle(), { providers: fake });
    assert.equal(result.status, 'max_tokens');
    assert.equal(result.max_tokens, 32_000);
    assert.equal(fake.calls.text.length, 3);
  });

  it('un fallo de red se lanza con las llamadas ya hechas', async () => {
    const http = new ProviderHttpError('503', { status: 503, retryable: true });
    const fake = createFakeProviders({ text: [ERROR_AREA, http] });
    await assert.rejects(analyze(await makeBundle(), { providers: fake }), (err) => err === http && err.calls.length === 2 && err.calls[1].outcome === 'http');
  });
});

describe('analyze (api): partición', () => {
  function longBundleText(sections) {
    return Array.from({ length: sections }, (_, i) => `# Sección ${i + 1}\nLa pantalla ${i + 1} falla de una forma distinta.`).join('\n\n');
  }
  // El guion del falso: una descomposición por trozo, un mensaje por unidad del trozo.
  const porTrozo = (req) => ({
    messages: unitIdsIn(req).map((u) => bugMessage([u], `Corregir pantalla ${u}`)),
    discarded: [],
  });

  it('sobre el umbral parte en trozos disjuntos, descompone en paralelo y reduce sin llamada extra', async () => {
    const bundle = await makeBundle({ text: longBundleText(8), attachments: [] });
    const fake = createFakeProviders({ text: (req, n) => (n === 0 ? ERROR_AREA : porTrozo(req)) });
    const probe = decomposeSystem(parseTemplate(bundle.templates[1].body_markdown)).join('\n').length;
    // Umbral chico: deja espacio para el sistema fijo más unas pocas secciones por trozo.
    const result = await analyze(bundle, { providers: fake, config: { partitionThresholdTokens: Math.ceil(probe / 3) + 150, partitionConcurrency: 2 } });
    assert.equal(result.status, 'ok');
    assert.ok(result.stats.partitioned && result.stats.chunks > 1, `trozos: ${result.stats.chunks}`);
    assert.equal(fake.calls.text.length, 1 + result.stats.chunks, 'una clasificación y un mapa por trozo; la reducción es determinista');
    const cubiertas = result.proposal.messages.flatMap((m) => m.unit_ids);
    assert.deepEqual(cubiertas, result.units.map((u) => u.id));
    assert.match(lastUserText(fake.calls.text[1]), /Este es el trozo \d de \d/);
  });

  it('un trozo que cita unidades de otro trozo es un error de referencia', async () => {
    const bundle = await makeBundle({ text: longBundleText(8), attachments: [] });
    const fake = createFakeProviders({ text: (req, n) => (n === 0 ? ERROR_AREA : { messages: [bugMessage([1, 8], 'x')], discarded: [] }) });
    const probe = decomposeSystem(parseTemplate(bundle.templates[1].body_markdown)).join('\n').length;
    const result = await analyze(bundle, { providers: fake, config: { partitionThresholdTokens: Math.ceil(probe / 3) + 150, partitionConcurrency: 1, invalidOutputRetries: 0 } });
    assert.equal(result.status, 'invalid');
    assert.match(result.errors.join('\n'), /no existe en este input/);
  });

  it('un monólogo transcrito va entero aunque supere el umbral', async () => {
    const audio = Array.from({ length: 40 }, (_, i) => `[00:${String(i).padStart(2, '0')}] frase ${i} del monólogo sobre una falla`).join('\n');
    const bundle = await makeBundle({ text: '', attachments: [{ id: 3, kind: 'audio', extracted: audio }] });
    const fake = createFakeProviders({ text: (req, n) => (n === 0 ? ERROR_AREA : { messages: [bugMessage(unitIdsIn(req), 'Corregir la falla del monólogo', { attachment_ids: [3] })], discarded: [] }) });
    const probe = decomposeSystem(parseTemplate(bundle.templates[1].body_markdown)).join('\n').length;
    const result = await analyze(bundle, { providers: fake, config: { partitionThresholdTokens: Math.ceil(probe / 3) + 50 } });
    assert.equal(result.status, 'ok');
    assert.equal(result.stats.chunks, 1);
    assert.equal(result.proposal.messages[0].unit_ids.length, 40);
  });
});

describe('analyze (api): perfiles de esquema', () => {
  it('con un proveedor que exige todo requerido, lo opcional viaja como nulo y se limpia al final', async () => {
    const bundle = await makeBundle();
    const out = goodDecomposition();
    for (const m of out.messages) m.fields = { steps: 'a', expected: 'b', actual: 'c', where: null, impact: null };
    const fake = createFakeProviders({ textProfile: 'all-required', text: [ERROR_AREA, out] });
    const result = await analyze(bundle, { providers: fake });
    assert.equal(result.status, 'ok');
    const f = fake.calls.text[1].schema.properties.messages.items.properties.fields;
    assert.deepEqual(f.required, ['steps', 'expected', 'actual', 'where', 'impact']);
    assert.deepEqual(f.properties.where, { type: ['string', 'null'] });
    assert.deepEqual(result.proposal.messages[0].fields, { steps: 'a', expected: 'b', actual: 'c' });
  });
});

describe('analyze (api): caché del prompt de sistema', () => {
  it('el sistema de la descomposición de cada plantilla inicial supera el mínimo cacheable de 512 tokens', async () => {
    const { templates } = await seed();
    for (const row of templates) {
      const system = decomposeSystem(parseTemplate(row.body_markdown)).join('\n');
      assert.ok(system.length / 3 >= 512, `${row.name}: ${Math.round(system.length / 3)} tokens estimados`);
    }
  });

  it('las llamadas registran si su sistema es cacheable', async () => {
    const fake = createFakeProviders({ text: [ERROR_AREA, goodDecomposition()] });
    const result = await analyze(await makeBundle(), { providers: fake });
    assert.equal(result.calls[1].cacheable, true);
  });
});

describe('warmTemplate', () => {
  it('manda una solicitud mínima con el sistema y el esquema de la plantilla y registra la llamada', async () => {
    const { templates } = await seed();
    const fake = createFakeProviders({ text: [{ messages: [], discarded: [] }] });
    const { resolveConfig } = await import('./config.js');
    const entry = await warmTemplate({ providers: fake, config: resolveConfig(), templateMarkdown: templates[1].body_markdown });
    assert.equal(entry.step, 'warmup');
    assert.equal(entry.ok, true);
    assert.equal(fake.calls.text.length, 1);
    assert.deepEqual(fake.calls.text[0].system, decomposeSystem(parseTemplate(templates[1].body_markdown)));
  });
});
