// Pruebas del analizador `api` con el proveedor falso: la mecánica (numerar, validar, rescatar,
// reintentar) se prueba sin red y sin modelo.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createFakeProviders, ProviderHttpError, ProviderMaxTokensError, ProviderOutputError, ProviderRefusalError,
} from '../providers/index.js';
import { analyze, AnalyzeInputError, warmCatalog, warmTemplate } from './index.js';
import { decomposeSystem } from './prompts.js';
import { parseTemplate } from './templates.js';
import {
  bugMessage, CLASSIFY_ERRORS, CLASSIFY_MULTI, goodDecomposition, lastUserText, makeBundle, MULTI_TEXT, scriptByRequest, seed, unitIdsIn,
} from './testing/fixtures.js';

const ids = (messages) => messages.map((m) => m.unit_ids);

describe('analyze (api): un input con tres puntos mezclados', () => {
  it('sale en tres mensajes con unit_ids disjuntos, sin huecos y con lo no accionable descartado', async () => {
    const bundle = await makeBundle();
    const fake = createFakeProviders({ text: [CLASSIFY_ERRORS, goodDecomposition()] });
    const result = await analyze(bundle, { providers: fake });

    assert.equal(result.status, 'ok');
    const { proposal } = result;
    assert.ok(!('area_id' in proposal) && !('template_id' in proposal), 'el área y la plantilla son de cada mensaje, no de la raíz');
    assert.equal(proposal.messages.length, 3);
    assert.ok(proposal.messages.every((m) => m.area_id === 2 && m.template_id === 2));
    assert.deepEqual(ids(proposal.messages), [[2, 4], [3], [5]]);
    const all = [...proposal.messages.flatMap((m) => m.unit_ids), ...proposal.discarded.flatMap((d) => d.unit_ids)].sort((a, b) => a - b);
    assert.deepEqual(all, [1, 2, 3, 4, 5, 6], 'cada unidad exactamente una vez');
    assert.equal(new Set(all).size, all.length, 'disjuntos');
    assert.equal(result.units.length, 6);

    // Dos llamadas: clasificar con esfuerzo low y descomponer el grupo con medium (informe 02 §10.2).
    assert.equal(fake.calls.text.length, 2);
    assert.equal(fake.calls.text[0].effort, 'low');
    assert.equal(fake.calls.text[1].effort, 'medium');
    assert.equal(fake.calls.text[0].maxTokens, 16_000);
    assert.equal(fake.calls.text[1].cacheTtl, '5m');
    assert.deepEqual(result.calls.map((c) => c.step), ['classify', 'decompose[t2]']);
    assert.ok(result.calls.every((c) => c.usage && c.provider === 'fake' && c.outcome === 'ok'));
    assert.equal(result.stats.groups, 1);
  });

  it('la primera llamada ve áreas y plantillas con título y descripción; la segunda, el cuerpo de la plantilla del grupo y sólo sus unidades', async () => {
    const bundle = await makeBundle();
    const fake = createFakeProviders({ text: [CLASSIFY_ERRORS, goodDecomposition()] });
    await analyze(bundle, { providers: fake });
    const [classify, decompose] = fake.calls.text;
    const catalog = classify.system.join('\n');
    for (const a of bundle.areas) assert.ok(catalog.includes(a.description));
    for (const t of bundle.templates) assert.ok(catalog.includes(t.description));
    assert.ok(!catalog.includes('## Método'), 'la primera llamada no ve cuerpos');
    assert.match(lastUserText(classify), /\[u1\] \(p1\) Hola equipo[\s\S]*\[u6\] \(p6\) Gracias/, 'la clasificación ve todo el input');
    const groupItem = classify.schema.properties.groups.items.properties;
    assert.deepEqual(groupItem.area_id.enum, [1, 2, 3, 4, 5]);
    assert.deepEqual(groupItem.template_id.enum, [1, 2, 3, 4, 5]);
    assert.deepEqual(Object.keys(groupItem), ['unit_ids', 'area_id', 'template_id']);

    assert.ok(decompose.system.join('\n').includes('Un mensaje por error.'), 'cuerpo de la plantilla del grupo');
    assert.ok(!decompose.system.join('\n').includes('Un mensaje por idea.'));
    // Esquema compilado de los fields de la plantilla (gramática de Anthropic).
    const f = decompose.schema.properties.messages.items.properties.fields;
    assert.deepEqual(f.required, ['steps', 'expected', 'actual']);
    assert.deepEqual(Object.keys(f.properties), ['steps', 'expected', 'actual', 'where', 'impact']);
    // El usuario recibe equipo, adjuntos y sólo las unidades del grupo, con su numeración original.
    const user = lastUserText(decompose);
    assert.match(user, /Miembro 2: Bruno Silva/);
    assert.match(user, /Adjunto 10: image \(sin texto extraído\)/);
    assert.deepEqual(unitIdsIn(decompose), [2, 3, 4, 5]);
  });

  it('el progreso avanza por pasos reales, sin retroceder, hasta 100', async () => {
    const fake = createFakeProviders({ text: [CLASSIFY_ERRORS, goodDecomposition()] });
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
    const fake = createFakeProviders({ text: [CLASSIFY_ERRORS, goodDecomposition()] });
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
    };
    const fake = createFakeProviders({ text: [CLASSIFY_ERRORS, solapada, rescate] });
    const result = await analyze(await makeBundle(), { providers: fake });

    assert.equal(result.status, 'ok');
    assert.equal(fake.calls.text.length, 3, 'clasificar, descomponer y un rescate');
    assert.equal(result.stats.rescues, 1);
    assert.deepEqual(result.calls.map((c) => c.step), ['classify', 'decompose[t2]', 'rescue[t2]']);
    // El rescate recibe sólo el conflicto: la u4 y los mensajes que la compartían, no el input entero.
    const prompt = lastUserText(fake.calls.text[2]);
    assert.match(prompt, /u4: mensaje 1 y mensaje 2/);
    assert.match(prompt, /\[u4\]/);
    assert.ok(!prompt.includes('[u5]'), 'las unidades sin conflicto no se reenvían');
    assert.ok(!prompt.includes('[u1]'), 'ni las de otros grupos');
    assert.deepEqual(result.proposal.messages.map((m) => m.unit_ids), [[2, 3, 4], [5]]);
  });

  it('un hueco (unidad en ningún lugar) también se rescata, sólo con las unidades faltantes', async () => {
    const conHueco = goodDecomposition();
    conHueco.messages.pop(); // falta la u5
    const rescate = { messages: [bugMessage([5], 'Corregir notificaciones duplicadas')] };
    const fake = createFakeProviders({ text: [CLASSIFY_ERRORS, conHueco, rescate] });
    const result = await analyze(await makeBundle(), { providers: fake });
    assert.equal(result.status, 'ok');
    assert.equal(fake.calls.text.length, 3);
    const prompt = lastUserText(fake.calls.text[2]);
    assert.match(prompt, /Unidades que ninguna parte de la salida cubre: u5/);
    assert.ok(!prompt.includes('Mensajes que hay que rehacer'));
    assert.deepEqual(ids(result.proposal.messages), [[2, 4], [3], [5]]);
    assert.deepEqual(result.proposal.discarded.map((d) => d.unit_ids), [[1], [6]], 'los descartes de la clasificación se conservan');
  });

  it('si el rescate no resuelve el conflicto, el trabajo falla con el motivo y no hay un segundo rescate', async () => {
    const solapada = goodDecomposition();
    solapada.messages[1].unit_ids = [3, 4];
    const rescateMalo = { messages: [bugMessage([2, 3, 4], 'A'), bugMessage([4], 'B')] };
    const fake = createFakeProviders({ text: [CLASSIFY_ERRORS, solapada, rescateMalo] });
    const result = await analyze(await makeBundle(), { providers: fake });
    assert.equal(result.status, 'invalid');
    assert.equal(result.reason, 'mece_conflict');
    assert.match(result.errors.join('\n'), /la unidad 4 está en más de un lugar/);
    assert.equal(fake.calls.text.length, 3);
  });

  it('con rescuePasses en 0 el conflicto falla sin llamar al rescate', async () => {
    const solapada = goodDecomposition();
    solapada.messages[1].unit_ids = [3, 4];
    const fake = createFakeProviders({ text: [CLASSIFY_ERRORS, solapada] });
    const result = await analyze(await makeBundle(), { providers: fake, config: { rescuePasses: 0 } });
    assert.equal(result.status, 'invalid');
    assert.equal(fake.calls.text.length, 2);
  });
});

describe('analyze (api): salida inválida', () => {
  it('se reintenta una vez con el error como contexto y la segunda salida buena se acepta', async () => {
    const mala = goodDecomposition();
    delete mala.messages[0].fields.actual;
    const fake = createFakeProviders({ text: [CLASSIFY_ERRORS, mala, goodDecomposition()] });
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
    const fake = createFakeProviders({ text: [CLASSIFY_ERRORS, mala, mala] });
    const result = await analyze(await makeBundle(), { providers: fake });
    assert.equal(result.status, 'invalid');
    assert.match(result.errors.join('\n'), /el miembro 99 no existe/);
    assert.equal(fake.calls.text.length, 3);
  });

  it('un adjunto que no es del input y una unidad inexistente son errores de referencia', async () => {
    const mala = goodDecomposition();
    mala.messages[1].attachment_ids = [55];
    mala.messages[2].unit_ids = [5, 77];
    const fake = createFakeProviders({ text: [CLASSIFY_ERRORS, mala, mala] });
    const result = await analyze(await makeBundle(), { providers: fake });
    assert.equal(result.status, 'invalid');
    const errors = result.errors.join('\n');
    assert.match(errors, /el adjunto 55 no pertenece al input/);
    assert.match(errors, /la unidad 77 no existe/);
  });

  it('una clasificación con la plantilla de otra área se reintenta', async () => {
    const mala = { ...CLASSIFY_ERRORS, groups: [{ unit_ids: [2, 3, 4, 5], area_id: 1, template_id: 2 }] };
    const fake = createFakeProviders({ text: [mala, CLASSIFY_ERRORS, goodDecomposition()] });
    const result = await analyze(await makeBundle(), { providers: fake });
    assert.equal(result.status, 'ok');
    assert.match(fake.calls.text[1].messages.at(-1).content, /grupo 1: la plantilla 2 no pertenece al área 1/);
  });

  it('una clasificación con una unidad en dos grupos o sin lugar se reintenta con ese conflicto', async () => {
    const solapa = { groups: [{ unit_ids: [2, 3], area_id: 2, template_id: 2 }, { unit_ids: [3, 4, 5], area_id: 1, template_id: 1 }], discarded: CLASSIFY_ERRORS.discarded };
    const hueco = { groups: [{ unit_ids: [2, 3, 4], area_id: 2, template_id: 2 }], discarded: CLASSIFY_ERRORS.discarded };
    for (const [mala, esperado] of [[solapa, /la unidad 3 está en más de un lugar \(grupo 1 y grupo 2\)/], [hueco, /las unidades 5 no están en ningún lugar/]]) {
      const fake = createFakeProviders({ text: [mala, CLASSIFY_ERRORS, goodDecomposition()] });
      const result = await analyze(await makeBundle(), { providers: fake });
      assert.equal(result.status, 'ok');
      assert.match(fake.calls.text[1].messages.at(-1).content, esperado);
    }
  });

  it('una salida que ni es JSON (ProviderOutputError) se reintenta con su motivo', async () => {
    const roto = new ProviderOutputError('anthropic: la salida no es JSON', { raw: '{"messages": [' });
    const fake = createFakeProviders({ text: [CLASSIFY_ERRORS, roto, goodDecomposition()] });
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
    const fake = createFakeProviders({ text: [CLASSIFY_ERRORS, new ProviderRefusalError('rechazo', { category: 'general_harms' })] });
    const result = await analyze(await makeBundle(), { providers: fake });
    assert.equal(result.status, 'refusal');
    assert.equal(result.step, 'decompose[t2]');
    assert.equal(fake.calls.text.length, 2);
  });

  it('un corte por max_tokens reintenta una vez con el doble', async () => {
    const corte = new ProviderMaxTokensError('corte', { maxTokens: 16_000 });
    const fake = createFakeProviders({ text: [CLASSIFY_ERRORS, corte, goodDecomposition()] });
    const result = await analyze(await makeBundle(), { providers: fake });
    assert.equal(result.status, 'ok');
    assert.equal(fake.calls.text[1].maxTokens, 16_000);
    assert.equal(fake.calls.text[2].maxTokens, 32_000);
    assert.equal(result.stats.max_tokens_retries, 1);
  });

  it('dos cortes seguidos son el estado max_tokens', async () => {
    const corte = new ProviderMaxTokensError('corte');
    const fake = createFakeProviders({ text: [CLASSIFY_ERRORS, corte, corte] });
    const result = await analyze(await makeBundle(), { providers: fake });
    assert.equal(result.status, 'max_tokens');
    assert.equal(result.max_tokens, 32_000);
    assert.equal(fake.calls.text.length, 3);
  });

  it('un fallo de red se lanza con las llamadas ya hechas', async () => {
    const http = new ProviderHttpError('503', { status: 503, retryable: true });
    const fake = createFakeProviders({ text: [CLASSIFY_ERRORS, http] });
    await assert.rejects(analyze(await makeBundle(), { providers: fake }), (err) => err === http && err.calls.length === 2 && err.calls[1].outcome === 'http');
  });
});

describe('analyze (api): partición', () => {
  function longBundleText(sections) {
    return Array.from({ length: sections }, (_, i) => `# Sección ${i + 1}\nLa pantalla ${i + 1} falla de una forma distinta.`).join('\n\n');
  }
  // Guion del falso: cada trozo se clasifica como un grupo de errores y cada grupo se descompone con un mensaje por unidad.
  const errorGroupPerRequest = (req) => {
    if (req.schema.properties.groups) return { groups: [{ unit_ids: unitIdsIn(req), area_id: 2, template_id: 2 }], discarded: [] };
    return { messages: unitIdsIn(req).map((u) => bugMessage([u], `Corregir pantalla ${u}`)) };
  };
  const smallThreshold = (bundle) => {
    const probe = decomposeSystem(parseTemplate(bundle.templates[1].body_markdown)).join('\n').length;
    return Math.ceil(probe / 3) + 150;
  };

  it('sobre el umbral parte en trozos disjuntos, clasifica y descompone en paralelo y reduce sin llamada extra', async () => {
    const bundle = await makeBundle({ text: longBundleText(8), attachments: [] });
    const fake = createFakeProviders({ text: errorGroupPerRequest });
    const result = await analyze(bundle, { providers: fake, config: { partitionThresholdTokens: smallThreshold(bundle), partitionConcurrency: 2 } });
    assert.equal(result.status, 'ok');
    assert.ok(result.stats.partitioned && result.stats.chunks > 1, `trozos: ${result.stats.chunks}`);
    assert.equal(fake.calls.text.length, result.stats.classification_chunks + result.stats.chunks, 'una clasificación por trozo y un mapa por trozo; la reducción es determinista');
    assert.deepEqual(result.proposal.messages.flatMap((m) => m.unit_ids), result.units.map((u) => u.id));
    assert.ok(fake.calls.text.some((c) => /Este es el trozo \d de \d/.test(lastUserText(c))));
  });

  it('un trozo que cita unidades de otro trozo es un error de referencia', async () => {
    const bundle = await makeBundle({ text: longBundleText(8), attachments: [] });
    const fake = createFakeProviders({
      text: (req) => (req.schema.properties.groups ? errorGroupPerRequest(req) : { messages: [bugMessage([1, 8], 'x')] }),
    });
    const result = await analyze(bundle, { providers: fake, config: { partitionThresholdTokens: smallThreshold(bundle), partitionConcurrency: 1, invalidOutputRetries: 0 } });
    assert.equal(result.status, 'invalid');
    assert.match(result.errors.join('\n'), /no existe en este input/);
  });

  it('un monólogo transcrito va entero aunque supere el umbral', async () => {
    const audio = Array.from({ length: 40 }, (_, i) => `[00:${String(i).padStart(2, '0')}] frase ${i} del monólogo sobre una falla`).join('\n');
    const bundle = await makeBundle({ text: '', attachments: [{ id: 3, kind: 'audio', extracted: audio }] });
    const fake = createFakeProviders({
      text: (req) => (req.schema.properties.groups
        ? errorGroupPerRequest(req)
        : { messages: [bugMessage(unitIdsIn(req), 'Corregir la falla del monólogo', { attachment_ids: [3] })] }),
    });
    const result = await analyze(bundle, { providers: fake, config: { partitionThresholdTokens: smallThreshold(bundle) + 0 } });
    assert.equal(result.status, 'ok');
    assert.equal(result.stats.chunks, 1);
    assert.equal(result.stats.classification_chunks, 1);
    assert.equal(result.proposal.messages[0].unit_ids.length, 40);
  });
});

describe('analyze (api): un input con un error, una idea y una pregunta', () => {
  const decompositions = (ruido = {}) => ({
    'Reporte de error': { messages: [bugMessage([2], 'Corregir botón Enviar de la vista previa')] },
    Idea: {
      messages: [{ unit_ids: [3], title: 'Agrupar los mensajes por día', fields: { idea: 'Agrupar por día', motivation: 'No indicado', reference: null }, body: 'Se propone agrupar los mensajes por día.', assignee_ids: [1], attachment_ids: [] }],
    },
    Pregunta: {
      messages: [{ unit_ids: [4], title: 'Responsable del certificado del dominio', fields: { question: '¿Quién renueva el certificado?' }, body: 'Quién se encarga de renovar el certificado del dominio.', assignee_ids: [2], attachment_ids: [] }],
    },
    ...ruido,
  });

  it('cada mensaje va en su área con su plantilla; una llamada de descomposición por grupo, con la plantilla del grupo', async () => {
    const bundle = await makeBundle({ text: MULTI_TEXT, attachments: [] });
    const fake = createFakeProviders({ text: scriptByRequest({ classification: CLASSIFY_MULTI, decompositions: decompositions() }) });
    const result = await analyze(bundle, { providers: fake });

    assert.equal(result.status, 'ok');
    assert.deepEqual(result.proposal.messages.map((m) => [m.unit_ids, m.area_id, m.template_id]), [[[2], 2, 2], [[3], 1, 1], [[4], 5, 5]]);
    assert.deepEqual(result.proposal.discarded.map((d) => d.unit_ids), [[1], [5]]);
    assert.equal(fake.calls.text.length, 4, 'clasificar y un grupo por plantilla');
    assert.equal(result.stats.groups, 3);
    assert.deepEqual(result.calls.map((c) => c.step).sort(), ['classify', 'decompose[t1]', 'decompose[t2]', 'decompose[t5]']);
    // Cada grupo ve el cuerpo de su plantilla y sólo sus unidades.
    const byTemplate = (name) => fake.calls.text.find((c) => c.system.join('\n').includes(`Plantilla elegida: ${name}`));
    assert.ok(byTemplate('Idea').system.join('\n').includes('Un mensaje por idea.'));
    assert.deepEqual(unitIdsIn(byTemplate('Idea')), [3]);
    assert.deepEqual(unitIdsIn(byTemplate('Pregunta')), [4]);
    // El esquema de fields de cada grupo es el de su plantilla.
    assert.deepEqual(byTemplate('Pregunta').schema.properties.messages.items.properties.fields.required, ['question']);
  });

  it('los grupos se descomponen a la vez (hasta partitionConcurrency)', async () => {
    const bundle = await makeBundle({ text: MULTI_TEXT, attachments: [] });
    let activas = 0;
    let maximo = 0;
    const script = scriptByRequest({ classification: CLASSIFY_MULTI, decompositions: decompositions() });
    const fake = createFakeProviders({
      text: async (req) => {
        if (req.schema.properties.groups) return script(req);
        activas += 1;
        maximo = Math.max(maximo, activas);
        await new Promise((resolve) => setTimeout(resolve, 20));
        activas -= 1;
        return script(req);
      },
    });
    const result = await analyze(bundle, { providers: fake });
    assert.equal(result.status, 'ok', JSON.stringify(result.errors));
    assert.equal(maximo, 3);
    const serie = await analyze(bundle, { providers: fake, config: { partitionConcurrency: 1 } });
    assert.equal(serie.status, 'ok', JSON.stringify(serie.errors));
  });

  it('un campo de otra plantilla en el mensaje de un grupo es un error de ese grupo', async () => {
    const bundle = await makeBundle({ text: MULTI_TEXT, attachments: [] });
    const mala = decompositions({ Pregunta: { messages: [{ unit_ids: [4], title: 'Q', fields: { steps: 'x' }, body: 'Q', assignee_ids: [], attachment_ids: [] }] } });
    const fake = createFakeProviders({ text: scriptByRequest({ classification: CLASSIFY_MULTI, decompositions: mala }), });
    const result = await analyze(bundle, { providers: fake, config: { invalidOutputRetries: 0 } });
    assert.equal(result.status, 'invalid');
    assert.match(result.errors.join('\n'), /falta «question»/);
    assert.match(result.errors.join('\n'), /sobra «steps»/);
  });

  it('el rescate de un grupo no toca a los demás', async () => {
    const bundle = await makeBundle({ text: MULTI_TEXT, attachments: [] });
    let primera = true;
    const solapada = { messages: [bugMessage([2], 'A'), bugMessage([2], 'B')] };
    const rescate = { messages: [bugMessage([2], 'Corregir botón Enviar')] };
    const fake = createFakeProviders({
      text: scriptByRequest({
        classification: CLASSIFY_MULTI,
        decompositions: decompositions({ 'Reporte de error': () => { const r = primera ? solapada : rescate; primera = false; return r; } }),
      }),
    });
    const result = await analyze(bundle, { providers: fake });
    assert.equal(result.status, 'ok');
    assert.equal(result.stats.rescues, 1);
    assert.equal(fake.calls.text.length, 5);
    assert.equal(result.proposal.messages.length, 3);
  });

  it('un input sin nada accionable termina sin mensajes y con todo descartado', async () => {
    const bundle = await makeBundle({ text: 'Hola.\n\nGracias.', attachments: [] });
    const fake = createFakeProviders({ text: [{ groups: [], discarded: [{ unit_ids: [1, 2], reason: 'charla' }] }] });
    const result = await analyze(bundle, { providers: fake });
    assert.equal(result.status, 'ok');
    assert.deepEqual(result.proposal, { messages: [], discarded: [{ unit_ids: [1, 2], reason: 'charla' }] });
    assert.equal(fake.calls.text.length, 1);
  });
});

describe('analyze (api): perfiles de esquema', () => {
  it('con un proveedor que exige todo requerido, lo opcional viaja como nulo y se limpia al final', async () => {
    const bundle = await makeBundle();
    const out = goodDecomposition();
    for (const m of out.messages) m.fields = { steps: 'a', expected: 'b', actual: 'c', where: null, impact: null };
    const fake = createFakeProviders({ textProfile: 'all-required', text: [CLASSIFY_ERRORS, out] });
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
    const fake = createFakeProviders({ text: [CLASSIFY_ERRORS, goodDecomposition()] });
    const result = await analyze(await makeBundle(), { providers: fake });
    assert.equal(result.calls[1].cacheable, true);
  });
});

describe('analyze (api): la descomposición de un grupo no descarta', () => {
  it('el esquema de la segunda llamada no trae discarded y las unidades del grupo van todas en mensajes', async () => {
    const fake = createFakeProviders({ text: [CLASSIFY_ERRORS, goodDecomposition()] });
    const result = await analyze(await makeBundle(), { providers: fake });
    assert.deepEqual(Object.keys(fake.calls.text[1].schema.properties), ['messages']);
    assert.deepEqual(Object.keys(fake.calls.text[0].schema.properties), ['groups', 'discarded']);
    assert.equal(result.status, 'ok');
  });

  it('un grupo que vuelve sin mensajes se reintenta: la clasificación ya lo eligió como un punto', async () => {
    const fake = createFakeProviders({ text: [CLASSIFY_ERRORS, { messages: [] }, goodDecomposition()] });
    const result = await analyze(await makeBundle(), { providers: fake });
    assert.equal(result.status, 'ok');
    assert.match(fake.calls.text[2].messages.at(-1).content, /el grupo no produjo ningún mensaje/);
  });

  it('una unidad del grupo que ningún mensaje cita es un hueco y va al rescate', async () => {
    const conHueco = goodDecomposition();
    conHueco.messages.pop();
    const fake = createFakeProviders({ text: [CLASSIFY_ERRORS, conHueco, { messages: [bugMessage([5], 'Corregir notificaciones duplicadas')] }] });
    assert.equal((await analyze(await makeBundle(), { providers: fake })).status, 'ok');
    assert.equal(fake.calls.text.length, 3);
  });
});

describe('analyze (api): pensamiento por llamada', () => {
  it('classifyThinking y decomposeThinking llegan al proveedor sólo en su llamada', async () => {
    const fake = createFakeProviders({ text: [CLASSIFY_ERRORS, goodDecomposition()] });
    await analyze(await makeBundle(), { providers: fake, config: { decomposeThinking: 'disabled', decomposeEffort: 'low' } });
    assert.ok(!('thinking' in fake.calls.text[0]));
    assert.equal(fake.calls.text[1].thinking, 'disabled');
    assert.equal(fake.calls.text[1].effort, 'low');
  });
});

describe('warmTemplate', () => {
  it('manda una solicitud mínima con el sistema y el esquema de la plantilla y registra la llamada', async () => {
    const { templates } = await seed();
    const fake = createFakeProviders({ text: [{ messages: [] }] });
    const { resolveConfig } = await import('./config.js');
    const entry = await warmTemplate({ providers: fake, config: resolveConfig(), templateMarkdown: templates[1].body_markdown });
    assert.equal(entry.step, 'warmup');
    assert.equal(entry.ok, true);
    assert.equal(fake.calls.text.length, 1);
    assert.deepEqual(fake.calls.text[0].system, decomposeSystem(parseTemplate(templates[1].body_markdown)));
  });
});

describe('warmCatalog', () => {
  it('calienta el esquema de la clasificación con los ids del catálogo', async () => {
    const { areas, templates } = await seed();
    const fake = createFakeProviders({ text: [{ groups: [] }] });
    const { resolveConfig } = await import('./config.js');
    const entry = await warmCatalog({ providers: fake, config: resolveConfig(), areas, templates });
    assert.equal(entry.step, 'warmup-classify');
    assert.equal(entry.ok, true);
    assert.deepEqual(fake.calls.text[0].schema.properties.groups.items.properties.template_id.enum, [1, 2, 3, 4, 5]);
  });
});
