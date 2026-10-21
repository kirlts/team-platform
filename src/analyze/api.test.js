// Tests of the `api` analyzer with the fake provider: the mechanics (numbering, validating, rescuing,
// retrying) are tested without network and without a model.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createFakeProviders, ProviderHttpError, ProviderMaxTokensError, ProviderOutputError, ProviderRefusalError,
} from '../providers/index.js';
import { ProviderTimeoutError } from '../providers/errors.js';
import { analyze, AnalyzeInputError, warmCatalog, warmTemplate } from './index.js';
import { decomposeSystem } from './prompts.js';
import { parseTemplate } from './templates.js';
import {
  bugMessage, CLASSIFY_ERRORS, CLASSIFY_MULTI, goodDecomposition, lastUserText, makeBundle, MULTI_TEXT, scriptByRequest, seed, unitIdsIn,
} from './testing/fixtures.js';

const ids = (messages) => messages.map((m) => m.unit_ids);

describe('analyze (api): an input with three mixed points', () => {
  it('comes out as three messages with disjoint unit_ids, no gaps and the non-actionable discarded', async () => {
    const bundle = await makeBundle();
    const fake = createFakeProviders({ text: [CLASSIFY_ERRORS, goodDecomposition()] });
    const result = await analyze(bundle, { providers: fake });

    assert.equal(result.status, 'ok');
    const { proposal } = result;
    assert.ok(!('area_id' in proposal) && !('template_id' in proposal), 'the area and the template belong to each message, not to the root');
    assert.equal(proposal.messages.length, 3);
    assert.ok(proposal.messages.every((m) => m.area_id === 2 && m.template_id === 2));
    assert.deepEqual(ids(proposal.messages), [[2, 4], [3], [5]]);
    const all = [...proposal.messages.flatMap((m) => m.unit_ids), ...proposal.discarded.flatMap((d) => d.unit_ids)].sort((a, b) => a - b);
    assert.deepEqual(all, [1, 2, 3, 4, 5, 6], 'each unit exactly once');
    assert.equal(new Set(all).size, all.length, 'disjoint');
    assert.equal(result.units.length, 6);

    // Two calls, both with low effort and no thinking (measurement of 2026-10-20 cited in config.js).
    assert.equal(fake.calls.text.length, 2);
    assert.equal(fake.calls.text[0].effort, 'low');
    assert.equal(fake.calls.text[1].effort, 'low');
    assert.equal(fake.calls.text[0].thinking, 'disabled');
    assert.equal(fake.calls.text[1].thinking, 'disabled');
    assert.equal(fake.calls.text[0].maxTokens, 16_000);
    assert.equal(fake.calls.text[1].cacheTtl, '5m');
    assert.deepEqual(result.calls.map((c) => c.step), ['classify', 'decompose[t2]']);
    assert.ok(result.calls.every((c) => c.usage && c.provider === 'fake' && c.outcome === 'ok'));
    assert.equal(result.stats.groups, 1);
  });

  it('the first call sees areas and templates with title and description; the second, the body of the group template and only its units', async () => {
    const bundle = await makeBundle();
    const fake = createFakeProviders({ text: [CLASSIFY_ERRORS, goodDecomposition()] });
    await analyze(bundle, { providers: fake });
    const [classify, decompose] = fake.calls.text;
    const catalog = classify.system.join('\n');
    for (const a of bundle.areas) assert.ok(catalog.includes(a.description));
    for (const t of bundle.templates) assert.ok(catalog.includes(t.description));
    assert.ok(!catalog.includes('## Método'), 'the first call does not see bodies');
    assert.match(lastUserText(classify), /\[u1\] \(p1\) Hola equipo[\s\S]*\[u6\] \(p6\) Gracias/, 'the classification sees the whole input');
    const groupItem = classify.schema.properties.groups.items.properties;
    assert.deepEqual(groupItem.area_id.enum, [1, 2, 3, 4, 5]);
    assert.deepEqual(groupItem.template_id.enum, [1, 2, 3, 4, 5]);
    assert.deepEqual(Object.keys(groupItem), ['unit_ids', 'area_id', 'template_id']);

    assert.ok(decompose.system.join('\n').includes('Un mensaje por error.'), 'body of the group template');
    assert.ok(!decompose.system.join('\n').includes('Un mensaje por idea.'));
    // Compiled schema of the template fields (Anthropic grammar).
    const f = decompose.schema.properties.messages.items.properties.fields;
    assert.deepEqual(f.required, ['steps', 'expected', 'actual']);
    assert.deepEqual(Object.keys(f.properties), ['steps', 'expected', 'actual', 'where', 'impact']);
    // The user message carries the team, the attachments and only the units of the group, with their original numbering.
    const user = lastUserText(decompose);
    assert.match(user, /Member 2: Bruno Silva/);
    assert.match(user, /Attachment 10: image \(no extracted text\)/);
    assert.deepEqual(unitIdsIn(decompose), [2, 3, 4, 5]);
  });

  it('progress advances in real steps, never going back, up to 100', async () => {
    const fake = createFakeProviders({ text: [CLASSIFY_ERRORS, goodDecomposition()] });
    const progress = [];
    await analyze(await makeBundle(), { providers: fake, onProgress: (p) => progress.push(p) });
    const pct = progress.map((p) => p.percent);
    assert.deepEqual([...pct].sort((a, b) => a - b), pct);
    assert.equal(pct.at(-1), 100);
    assert.ok(progress.every((p) => typeof p.phrase === 'string' && p.phrase.length > 0));
  });

  it('an input without usable text is an input error', async () => {
    const bundle = await makeBundle({ text: '   ', attachments: [{ id: 1, kind: 'image', extracted: null }] });
    await assert.rejects(analyze(bundle, { providers: createFakeProviders({ text: [] }) }), AnalyzeInputError);
  });

  it('an unknown ANALYZER is an error; the default is api', async () => {
    const fake = createFakeProviders({ text: [CLASSIFY_ERRORS, goodDecomposition()] });
    await assert.rejects(analyze(await makeBundle(), { providers: fake, env: { ANALYZER: 'otro' } }), AnalyzeInputError);
    assert.equal((await analyze(await makeBundle(), { providers: fake, env: {} })).status, 'ok');
  });
});

describe('analyze (api): overlaps, gaps and rescue', () => {
  it('an overlap triggers a single rescue pass over the conflict', async () => {
    const solapada = goodDecomposition();
    solapada.messages[1].unit_ids = [3, 4]; // u4 also stays in message A
    const rescate = {
      messages: [bugMessage([2, 3, 4], 'Corregir ingreso en blanco y fechas del CSV')],
    };
    const fake = createFakeProviders({ text: [CLASSIFY_ERRORS, solapada, rescate] });
    const result = await analyze(await makeBundle(), { providers: fake });

    assert.equal(result.status, 'ok');
    assert.equal(fake.calls.text.length, 3, 'classify, decompose and one rescue');
    assert.equal(result.stats.rescues, 1);
    assert.deepEqual(result.calls.map((c) => c.step), ['classify', 'decompose[t2]', 'rescue[t2]']);
    // The rescue receives only the conflict: u4 and the messages that shared it, not the whole input.
    const prompt = lastUserText(fake.calls.text[2]);
    assert.match(prompt, /u4: message 1 and message 2/);
    assert.match(prompt, /\[u4\]/);
    assert.ok(!prompt.includes('[u5]'), 'units without a conflict are not resent');
    assert.ok(!prompt.includes('[u1]'), 'nor those of other groups');
    assert.deepEqual(result.proposal.messages.map((m) => m.unit_ids), [[2, 3, 4], [5]]);
  });

  it('a gap (a unit in no place) is also rescued, with only the missing units', async () => {
    const conHueco = goodDecomposition();
    conHueco.messages.pop(); // u5 is missing
    const rescate = { messages: [bugMessage([5], 'Corregir notificaciones duplicadas')] };
    const fake = createFakeProviders({ text: [CLASSIFY_ERRORS, conHueco, rescate] });
    const result = await analyze(await makeBundle(), { providers: fake });
    assert.equal(result.status, 'ok');
    assert.equal(fake.calls.text.length, 3);
    const prompt = lastUserText(fake.calls.text[2]);
    assert.match(prompt, /Units that no part of the output covers: u5/);
    assert.ok(!prompt.includes('Messages to redo'));
    assert.deepEqual(ids(result.proposal.messages), [[2, 4], [3], [5]]);
    assert.deepEqual(result.proposal.discarded.map((d) => d.unit_ids), [[1], [6]], 'the discards of the classification are kept');
  });

  it('if the rescue does not resolve the conflict, the job fails with the reason and there is no second rescue', async () => {
    const solapada = goodDecomposition();
    solapada.messages[1].unit_ids = [3, 4];
    const rescateMalo = { messages: [bugMessage([2, 3, 4], 'A'), bugMessage([4], 'B')] };
    const fake = createFakeProviders({ text: [CLASSIFY_ERRORS, solapada, rescateMalo] });
    const result = await analyze(await makeBundle(), { providers: fake });
    assert.equal(result.status, 'invalid');
    assert.equal(result.reason, 'mece_conflict');
    assert.match(result.errors.join('\n'), /unit 4 is in more than one place/);
    assert.equal(fake.calls.text.length, 3);
  });

  it('with rescuePasses at 0 the conflict fails without calling the rescue', async () => {
    const solapada = goodDecomposition();
    solapada.messages[1].unit_ids = [3, 4];
    const fake = createFakeProviders({ text: [CLASSIFY_ERRORS, solapada] });
    const result = await analyze(await makeBundle(), { providers: fake, config: { rescuePasses: 0 } });
    assert.equal(result.status, 'invalid');
    assert.equal(fake.calls.text.length, 2);
  });
});

describe('analyze (api): invalid output', () => {
  it('it retries once with the error as context and a good second output is accepted', async () => {
    const mala = goodDecomposition();
    delete mala.messages[0].fields.actual;
    const fake = createFakeProviders({ text: [CLASSIFY_ERRORS, mala, goodDecomposition()] });
    const result = await analyze(await makeBundle(), { providers: fake });
    assert.equal(result.status, 'ok');
    assert.equal(fake.calls.text.length, 3);
    const retry = fake.calls.text[2];
    assert.equal(retry.messages.at(-2).role, 'assistant');
    assert.equal(retry.messages.at(-1).role, 'user');
    assert.match(retry.messages.at(-1).content, /message 1.*missing «actual»/);
    assert.equal(result.stats.invalid_retries, 1);
  });

  it('if the retry is also invalid, the job fails with the errors and does not retry again', async () => {
    const mala = goodDecomposition();
    mala.messages[0].assignee_ids = [99];
    const fake = createFakeProviders({ text: [CLASSIFY_ERRORS, mala, mala] });
    const result = await analyze(await makeBundle(), { providers: fake });
    assert.equal(result.status, 'invalid');
    assert.match(result.errors.join('\n'), /member 99 does not exist/);
    assert.equal(fake.calls.text.length, 3);
  });

  it('an attachment that is not from the input and a nonexistent unit are reference errors', async () => {
    const mala = goodDecomposition();
    mala.messages[1].attachment_ids = [55];
    mala.messages[2].unit_ids = [5, 77];
    const fake = createFakeProviders({ text: [CLASSIFY_ERRORS, mala, mala] });
    const result = await analyze(await makeBundle(), { providers: fake });
    assert.equal(result.status, 'invalid');
    const errors = result.errors.join('\n');
    assert.match(errors, /attachment 55 does not belong to the input/);
    assert.match(errors, /unit 77 does not exist/);
  });

  it('a classification with the template of another area is retried', async () => {
    const mala = { ...CLASSIFY_ERRORS, groups: [{ unit_ids: [2, 3, 4, 5], area_id: 1, template_id: 2 }] };
    const fake = createFakeProviders({ text: [mala, CLASSIFY_ERRORS, goodDecomposition()] });
    const result = await analyze(await makeBundle(), { providers: fake });
    assert.equal(result.status, 'ok');
    assert.match(fake.calls.text[1].messages.at(-1).content, /group 1: template 2 does not belong to area 1/);
  });

  it('a classification with a unit in two groups or in no place is retried with that conflict', async () => {
    const solapa = { groups: [{ unit_ids: [2, 3], area_id: 2, template_id: 2 }, { unit_ids: [3, 4, 5], area_id: 1, template_id: 1 }], discarded: CLASSIFY_ERRORS.discarded };
    const hueco = { groups: [{ unit_ids: [2, 3, 4], area_id: 2, template_id: 2 }], discarded: CLASSIFY_ERRORS.discarded };
    for (const [mala, esperado] of [[solapa, /unit 3 is in more than one place \(group 1 and group 2\)/], [hueco, /units 5 are in no place/]]) {
      const fake = createFakeProviders({ text: [mala, CLASSIFY_ERRORS, goodDecomposition()] });
      const result = await analyze(await makeBundle(), { providers: fake });
      assert.equal(result.status, 'ok');
      assert.match(fake.calls.text[1].messages.at(-1).content, esperado);
    }
  });

  it('an output that is not even JSON (ProviderOutputError) is retried with its reason', async () => {
    const roto = new ProviderOutputError('anthropic: la salida no es JSON', { raw: '{"messages": [' });
    const fake = createFakeProviders({ text: [CLASSIFY_ERRORS, roto, goodDecomposition()] });
    const result = await analyze(await makeBundle(), { providers: fake });
    assert.equal(result.status, 'ok');
    assert.equal(result.calls[1].outcome, 'invalid_output');
    assert.match(fake.calls.text[2].messages.at(-1).content, /no es JSON/);
  });
});

describe('analyze (api): refusal and max_tokens are states', () => {
  it('a refusal in the classification is not retried and returns with its category', async () => {
    const refusal = new ProviderRefusalError('refusal', { category: 'cyber', usage: { input_tokens: 50, output_tokens: 0, cached_tokens: 0 } });
    const fake = createFakeProviders({ text: [refusal] });
    const result = await analyze(await makeBundle(), { providers: fake });
    assert.equal(result.status, 'refusal');
    assert.equal(result.category, 'cyber');
    assert.equal(result.step, 'classify');
    assert.equal(fake.calls.text.length, 1);
    assert.equal(result.calls[0].outcome, 'refusal');
    assert.equal(result.calls[0].usage.input_tokens, 50, 'the refusal also costs tokens and is recorded');
  });

  it('a refusal in the decomposition is not retried either', async () => {
    const fake = createFakeProviders({ text: [CLASSIFY_ERRORS, new ProviderRefusalError('refusal', { category: 'general_harms' })] });
    const result = await analyze(await makeBundle(), { providers: fake });
    assert.equal(result.status, 'refusal');
    assert.equal(result.step, 'decompose[t2]');
    assert.equal(fake.calls.text.length, 2);
  });

  it('a max_tokens cutoff retries once with double', async () => {
    const corte = new ProviderMaxTokensError('cutoff', { maxTokens: 16_000 });
    const fake = createFakeProviders({ text: [CLASSIFY_ERRORS, corte, goodDecomposition()] });
    const result = await analyze(await makeBundle(), { providers: fake });
    assert.equal(result.status, 'ok');
    assert.equal(fake.calls.text[1].maxTokens, 16_000);
    assert.equal(fake.calls.text[2].maxTokens, 32_000);
    assert.equal(result.stats.max_tokens_retries, 1);
  });

  it('two cutoffs in a row are the max_tokens state', async () => {
    const corte = new ProviderMaxTokensError('cutoff');
    const fake = createFakeProviders({ text: [CLASSIFY_ERRORS, corte, corte] });
    const result = await analyze(await makeBundle(), { providers: fake });
    assert.equal(result.status, 'max_tokens');
    assert.equal(result.max_tokens, 32_000);
    assert.equal(fake.calls.text.length, 3);
  });

  it('a network failure is thrown with the calls already made', async () => {
    const http = new ProviderHttpError('503', { status: 503, retryable: true });
    const fake = createFakeProviders({ text: [CLASSIFY_ERRORS, http] });
    await assert.rejects(analyze(await makeBundle(), { providers: fake }), (err) => err === http && err.calls.length === 2 && err.calls[1].outcome === 'http');
  });
});

describe('analyze (api): partitioning', () => {
  function longBundleText(sections) {
    return Array.from({ length: sections }, (_, i) => `# Sección ${i + 1}\nLa pantalla ${i + 1} falla de una forma distinta.`).join('\n\n');
  }
  // Fake script: each chunk is classified as one group of errors and each group is decomposed with one message per unit.
  const errorGroupPerRequest = (req) => {
    if (req.schema.properties.groups) return { groups: [{ unit_ids: unitIdsIn(req), area_id: 2, template_id: 2 }], discarded: [] };
    return { messages: unitIdsIn(req).map((u) => bugMessage([u], `Corregir pantalla ${u}`)) };
  };
  const smallThreshold = (bundle) => {
    const probe = decomposeSystem(parseTemplate(bundle.templates[1].body_markdown), undefined, 'en').join('\n').length;
    return Math.ceil(probe / 3) + 150;
  };

  it('above the threshold it splits into disjoint chunks, classifies and decomposes in parallel and reduces with no extra call', async () => {
    const bundle = await makeBundle({ text: longBundleText(8), attachments: [] });
    const fake = createFakeProviders({ text: errorGroupPerRequest });
    const result = await analyze(bundle, { providers: fake, config: { partitionThresholdTokens: smallThreshold(bundle), partitionConcurrency: 2 } });
    assert.equal(result.status, 'ok');
    assert.ok(result.stats.partitioned && result.stats.chunks > 1, `chunks: ${result.stats.chunks}`);
    assert.equal(fake.calls.text.length, result.stats.classification_chunks + result.stats.chunks, 'one classification per chunk and one map per chunk; the reduction is deterministic');
    assert.deepEqual(result.proposal.messages.flatMap((m) => m.unit_ids), result.units.map((u) => u.id));
    assert.ok(fake.calls.text.some((c) => /This is chunk \d of \d/.test(lastUserText(c))));
  });

  it('a chunk that cites units of another chunk is a reference error', async () => {
    const bundle = await makeBundle({ text: longBundleText(8), attachments: [] });
    const fake = createFakeProviders({
      text: (req) => (req.schema.properties.groups ? errorGroupPerRequest(req) : { messages: [bugMessage([1, 8], 'x')] }),
    });
    const result = await analyze(bundle, { providers: fake, config: { partitionThresholdTokens: smallThreshold(bundle), partitionConcurrency: 1, invalidOutputRetries: 0 } });
    assert.equal(result.status, 'invalid');
    assert.match(result.errors.join('\n'), /does not exist in this input/);
  });

  it('a transcribed monologue goes whole even if it exceeds the threshold', async () => {
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

describe('analyze (api): an input with a bug, an idea and a question', () => {
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

  it('each message goes in its area with its template; one decomposition call per group, with the group template', async () => {
    const bundle = await makeBundle({ text: MULTI_TEXT, attachments: [] });
    const fake = createFakeProviders({ text: scriptByRequest({ classification: CLASSIFY_MULTI, decompositions: decompositions() }) });
    const result = await analyze(bundle, { providers: fake });

    assert.equal(result.status, 'ok');
    assert.deepEqual(result.proposal.messages.map((m) => [m.unit_ids, m.area_id, m.template_id]), [[[2], 2, 2], [[3], 1, 1], [[4], 5, 5]]);
    assert.deepEqual(result.proposal.discarded.map((d) => d.unit_ids), [[1], [5]]);
    assert.equal(fake.calls.text.length, 4, 'classify and one group per template');
    assert.equal(result.stats.groups, 3);
    assert.deepEqual(result.calls.map((c) => c.step).sort(), ['classify', 'decompose[t1]', 'decompose[t2]', 'decompose[t5]']);
    // Each group sees the body of its template and only its units.
    const byTemplate = (name) => fake.calls.text.find((c) => c.system.join('\n').includes(`Chosen template: ${name}`));
    assert.ok(byTemplate('Idea').system.join('\n').includes('Un mensaje por idea.'));
    assert.deepEqual(unitIdsIn(byTemplate('Idea')), [3]);
    assert.deepEqual(unitIdsIn(byTemplate('Pregunta')), [4]);
    // The fields schema of each group is that of its template.
    assert.deepEqual(byTemplate('Pregunta').schema.properties.messages.items.properties.fields.required, ['question']);
  });

  it('groups are decomposed at the same time (up to partitionConcurrency)', async () => {
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

  it('a field of another template in the message of a group is an error of that group', async () => {
    const bundle = await makeBundle({ text: MULTI_TEXT, attachments: [] });
    const mala = decompositions({ Pregunta: { messages: [{ unit_ids: [4], title: 'Q', fields: { steps: 'x' }, body: 'Q', assignee_ids: [], attachment_ids: [] }] } });
    const fake = createFakeProviders({ text: scriptByRequest({ classification: CLASSIFY_MULTI, decompositions: mala }), });
    const result = await analyze(bundle, { providers: fake, config: { invalidOutputRetries: 0 } });
    assert.equal(result.status, 'invalid');
    assert.match(result.errors.join('\n'), /missing «question»/);
    assert.match(result.errors.join('\n'), /unexpected «steps»/);
  });

  it('the rescue of one group does not touch the others', async () => {
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

  it('an input with nothing actionable ends with no messages only after a second, deeper reading', async () => {
    const bundle = await makeBundle({ text: 'Hola.\n\nGracias.', attachments: [] });
    const empty = { groups: [], discarded: [{ unit_ids: [1, 2], reason: 'charla' }] };
    const fake = createFakeProviders({ text: [empty, empty] });
    const result = await analyze(bundle, { providers: fake });
    assert.equal(result.status, 'ok');
    assert.deepEqual(result.proposal, { messages: [], discarded: [{ unit_ids: [1, 2], reason: 'charla' }] });
    assert.equal(result.stats.second_pass, true);
    assert.equal(fake.calls.text.length, 2, 'the first reading and the second one');
    assert.match(fake.calls.text[1].messages[0].content, /Second reading/);
    assert.match(fake.calls.text[0].messages[0].content, /^(?!Second reading)/);
  });
});

describe('analyze (api): second reading (UD-021)', () => {
  const found = { groups: [{ unit_ids: [1], area_id: 2, template_id: 2 }], discarded: [] };
  const emptyFor = (ids) => ({ groups: [], discarded: [{ unit_ids: ids, reason: 'sin pedido' }] });
  /** First classification empty, the following ones as given; any decomposition answers with `message`. */
  const script = (afterFirst, message) => {
    let classifications = 0;
    return (req) => {
      if (req.schema.properties.groups) {
        classifications += 1;
        return classifications === 1 ? emptyFor([1]) : afterFirst;
      }
      return { messages: [message] };
    };
  };

  it('a first reading with no groups is read again and the second one yields a message', async () => {
    const bundle = await makeBundle({ text: 'El botón de exportar no hace nada.', attachments: [] });
    const fake = createFakeProviders({ text: script(found, bugMessage([1], 'Corregir el botón de exportar')) });
    const result = await analyze(bundle, { providers: fake });
    assert.equal(result.status, 'ok');
    assert.equal(result.stats.second_pass, true);
    assert.deepEqual(result.proposal.messages.map((m) => m.title), ['Corregir el botón de exportar']);
    assert.ok(!('source' in result.proposal.messages[0]), 'a message born from text is not marked as inferred from an image');
    const steps = fake.calls.text.map((c) => (c.schema.properties.groups ? 'classify' : 'decompose'));
    assert.deepEqual(steps, ['classify', 'classify', 'decompose']);
    assert.match(lastUserText(fake.calls.text[1]), /Second reading/);
    assert.doesNotMatch(lastUserText(fake.calls.text[0]), /Second reading/);
  });

  it('a first reading that finds something does not run a second one', async () => {
    const bundle = await makeBundle({ text: 'El botón de exportar no hace nada.', attachments: [] });
    const fake = createFakeProviders({
      text: scriptByRequest({ classification: found, decompositions: { 'Reporte de error': { messages: [bugMessage([1], 'Corregir el botón de exportar')] } } }),
    });
    const result = await analyze(bundle, { providers: fake });
    assert.equal(result.status, 'ok');
    assert.ok(!result.stats.second_pass);
  });

  it('an image sent alone is described again in more detail, and what comes out of it is marked as inferred from the image', async () => {
    const bundle = await makeBundle({ text: '', attachments: [{ id: 7, kind: 'image', extracted: 'Una pantalla.' }] });
    const asked = [];
    const redescribe = async (attachment) => {
      asked.push(attachment.id);
      return 'Formulario de ingreso con el campo Correo vacío y el botón Enviar desalineado.';
    };
    const fake = createFakeProviders({ text: script(found, bugMessage([1], 'Corregir el botón Enviar desalineado')) });
    const result = await analyze(bundle, { providers: fake, redescribe });
    assert.equal(result.status, 'ok');
    assert.deepEqual(asked, [7]);
    assert.equal(result.stats.second_pass, true);
    assert.match(lastUserText(fake.calls.text[1]), /Formulario de ingreso con el campo Correo vacío/);
    assert.equal(result.proposal.messages[0].source, 'frame');
    assert.match(result.units[0].text, /Formulario de ingreso/);
  });

  it('an image alone with no way to describe it again still gets a second classification', async () => {
    const bundle = await makeBundle({ text: '', attachments: [{ id: 7, kind: 'image', extracted: 'Una pantalla con un panel de indicadores.' }] });
    const fake = createFakeProviders({ text: script(found, bugMessage([1], 'Revisar el panel de indicadores')) });
    const result = await analyze(bundle, { providers: fake });
    assert.equal(result.stats.second_pass, true);
    assert.equal(result.proposal.messages[0].source, 'frame');
  });

  it('long text is read again by sections, one classification each', async () => {
    const text = Array.from({ length: 5 }, (_, i) => `Párrafo ${i + 1} sin pedido claro.`).join('\n\n');
    const bundle = await makeBundle({ text, attachments: [] });
    let calls = 0;
    const fake = createFakeProviders({ text: (req) => { calls += 1; return { groups: [], discarded: [{ unit_ids: unitIdsIn(req), reason: 'charla' }] }; } });
    const result = await analyze(bundle, { providers: fake, config: { secondPassSectionUnits: 2 } });
    assert.equal(result.proposal.messages.length, 0);
    assert.equal(calls, 1 + 3, 'the first reading and three sections of 2, 2 and 1 units');
    assert.ok(fake.calls.text.slice(1).every((c) => /Second reading/.test(lastUserText(c))));
  });
});

describe('analyze (api): fallback provider (H-18)', () => {
  const goodScript = () => scriptByRequest({ classification: CLASSIFY_ERRORS, decompositions: { 'Reporte de error': goodDecomposition() } });

  it('a refusal in the classification is repeated once on the fallback, which is recorded in calls', async () => {
    const bundle = await makeBundle();
    const good = goodScript();
    const fake = createFakeProviders({ text: (req, n) => (n === 0 ? new ProviderRefusalError('no', { category: 'x' }) : good(req)), textFallback: [CLASSIFY_ERRORS] });
    const result = await analyze(bundle, { providers: fake });
    assert.equal(result.status, 'ok');
    assert.equal(fake.calls.text.length, 2, 'the primary provider is tried once for the classification and then decomposes');
    assert.equal(fake.calls.textFallback.length, 1);
    const [primary, fallback] = result.calls;
    assert.equal(primary.fallback, undefined);
    assert.equal(primary.outcome, 'refusal');
    assert.equal(fallback.fallback, true);
    assert.equal(fallback.provider, 'fake-fallback');
    assert.equal(result.stats.fallbacks, 1);
  });

  it('a retryable HTTP failure goes to the fallback as well', async () => {
    const bundle = await makeBundle();
    const good = goodScript();
    const fake = createFakeProviders({ text: (req, n) => (n === 0 ? new ProviderHttpError('overloaded', { status: 529, retryable: true }) : good(req)), textFallback: [CLASSIFY_ERRORS] });
    const result = await analyze(bundle, { providers: fake });
    assert.equal(result.status, 'ok');
    assert.equal(result.calls.filter((c) => c.fallback).length, 1);
  });

  it('without a fallback the behavior is the current one: a refusal is a state and an HTTP failure is thrown', async () => {
    const refused = createFakeProviders({ text: [new ProviderRefusalError('no', { category: 'x' })] });
    assert.equal(refused.textFallback, null);
    assert.equal((await analyze(await makeBundle(), { providers: refused })).status, 'refusal');
    const down = createFakeProviders({ text: [new ProviderHttpError('down', { status: 503, retryable: true })] });
    await assert.rejects(analyze(await makeBundle(), { providers: down }), ProviderHttpError);
  });

  it('what the fallback does not cover is not repeated: a non-retryable HTTP failure and a timeout', async () => {
    for (const error of [new ProviderHttpError('bad key', { status: 401, retryable: false }), new ProviderTimeoutError('slow', { timeoutMs: 5 })]) {
      const fake = createFakeProviders({ text: [error], textFallback: goodScript() });
      await assert.rejects(analyze(await makeBundle(), { providers: fake }), error.constructor);
      assert.equal(fake.calls.textFallback.length, 0);
    }
  });

  it('a refusal of the fallback itself comes back as the refusal state, with both calls recorded', async () => {
    const fake = createFakeProviders({ text: [new ProviderRefusalError('no')], textFallback: [new ProviderRefusalError('tampoco')] });
    const result = await analyze(await makeBundle(), { providers: fake });
    assert.equal(result.status, 'refusal');
    assert.deepEqual(result.calls.map((c) => Boolean(c.fallback)), [false, true]);
  });
});

describe('analyze (api): schema profiles', () => {
  it('with a provider that requires everything, optional fields travel as null and are cleaned at the end', async () => {
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

describe('analyze (api): system prompt cache', () => {
  it('the decomposition system of each initial template exceeds the cacheable minimum of 512 tokens', async () => {
    const { templates } = await seed();
    for (const row of templates) {
      const system = decomposeSystem(parseTemplate(row.body_markdown), undefined, 'en').join('\n');
      assert.ok(system.length / 3 >= 512, `${row.name}: ${Math.round(system.length / 3)} estimated tokens`);
    }
  });

  it('calls record whether their system is cacheable', async () => {
    const fake = createFakeProviders({ text: [CLASSIFY_ERRORS, goodDecomposition()] });
    const result = await analyze(await makeBundle(), { providers: fake });
    assert.equal(result.calls[1].cacheable, true);
  });
});

describe('analyze (api): the decomposition of a group does not discard', () => {
  it('the schema of the second call has no discarded and the units of the group all go in messages', async () => {
    const fake = createFakeProviders({ text: [CLASSIFY_ERRORS, goodDecomposition()] });
    const result = await analyze(await makeBundle(), { providers: fake });
    assert.deepEqual(Object.keys(fake.calls.text[1].schema.properties), ['messages']);
    assert.deepEqual(Object.keys(fake.calls.text[0].schema.properties), ['groups', 'discarded']);
    assert.equal(result.status, 'ok');
  });

  it('a group that comes back with no messages is retried: the classification already chose it as a point', async () => {
    const fake = createFakeProviders({ text: [CLASSIFY_ERRORS, { messages: [] }, goodDecomposition()] });
    const result = await analyze(await makeBundle(), { providers: fake });
    assert.equal(result.status, 'ok');
    assert.match(fake.calls.text[2].messages.at(-1).content, /the group produced no message/);
  });

  it('a unit of the group that no message cites is a gap and goes to the rescue', async () => {
    const conHueco = goodDecomposition();
    conHueco.messages.pop();
    const fake = createFakeProviders({ text: [CLASSIFY_ERRORS, conHueco, { messages: [bugMessage([5], 'Corregir notificaciones duplicadas')] }] });
    assert.equal((await analyze(await makeBundle(), { providers: fake })).status, 'ok');
    assert.equal(fake.calls.text.length, 3);
  });
});

describe('analyze (api): thinking per call', () => {
  it('classifyThinking and decomposeThinking can be set back to adaptive thinking, each in its own call', async () => {
    const fake = createFakeProviders({ text: [CLASSIFY_ERRORS, goodDecomposition()] });
    await analyze(await makeBundle(), { providers: fake, config: { classifyThinking: null, decomposeThinking: 'disabled', decomposeEffort: 'medium' } });
    assert.ok(!('thinking' in fake.calls.text[0]));
    assert.equal(fake.calls.text[1].thinking, 'disabled');
    assert.equal(fake.calls.text[1].effort, 'medium');
  });
});

describe('warmTemplate', () => {
  it('sends a minimal request with the template system and schema and records the call', async () => {
    const { templates } = await seed();
    const fake = createFakeProviders({ text: [{ messages: [] }] });
    const { resolveConfig } = await import('./config.js');
    const entry = await warmTemplate({ providers: fake, config: resolveConfig(), templateMarkdown: templates[1].body_markdown, language: 'en' });
    assert.equal(entry.step, 'warmup');
    assert.equal(entry.ok, true);
    assert.equal(fake.calls.text.length, 1);
    assert.deepEqual(fake.calls.text[0].system, decomposeSystem(parseTemplate(templates[1].body_markdown), undefined, 'en'));
  });
});

describe('warmCatalog', () => {
  it('warms the classification schema with the ids of the catalog', async () => {
    const { areas, templates } = await seed();
    const fake = createFakeProviders({ text: [{ groups: [] }] });
    const { resolveConfig } = await import('./config.js');
    const entry = await warmCatalog({ providers: fake, config: resolveConfig(), areas, templates });
    assert.equal(entry.step, 'warmup-classify');
    assert.equal(entry.ok, true);
    assert.deepEqual(fake.calls.text[0].schema.properties.groups.items.properties.template_id.enum, [1, 2, 3, 4, 5]);
  });
});
