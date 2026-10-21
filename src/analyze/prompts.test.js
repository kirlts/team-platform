// The two prompt sets (UD-018): neutral Latin American Spanish (the default) and English, selected by `bundle.language`.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createFakeProviders } from '../providers/index.js';
import { analyze } from './index.js';
import { classifySystem, DEFAULT_LANGUAGE, decomposeSystem, harnessPrompt, LANGUAGES, promptSet, resolveLanguage } from './prompts.js';
import * as en from './prompts-en.js';
import * as es from './prompts-es.js';
import { parseTemplate } from './templates.js';
import { bugMessage, CLASSIFY_ERRORS, makeBundle, scriptByRequest } from './testing/fixtures.js';

const VOSEO = /\b(vos|sos|tenés|podés|querés|hacé|mirá|decí|fijate|acordate|poné|escribí|devolvé|usá|elegí|recogé)\b/i;
const SPAIN = /\b(ordenador|vale|coger|vosotros|móvil)\b/i;

describe('prompt sets', () => {
  it('there are two languages, es-419 is the default, and an unknown or absent language falls back to it', () => {
    assert.deepEqual([...LANGUAGES], ['es-419', 'en']);
    assert.equal(DEFAULT_LANGUAGE, 'es-419');
    assert.equal(resolveLanguage(undefined), 'es-419');
    assert.equal(resolveLanguage('fr'), 'es-419');
    assert.equal(resolveLanguage('en'), 'en');
    assert.equal(promptSet(undefined), es);
    assert.equal(promptSet('en'), en);
  });

  it('both sets export the same pieces', () => {
    assert.deepEqual(Object.keys(es).sort(), Object.keys(en).sort());
  });

  it('each set asks for its output in its own language and says so for the title, the body, the fields and the reasons', () => {
    assert.match(es.CLASSIFY_INSTRUCTIONS, /Idioma de salida: español latinoamericano neutro \(es-419\)/);
    assert.match(es.DECOMPOSE_INSTRUCTIONS, /sea cual sea el idioma del input/);
    assert.match(en.CLASSIFY_INSTRUCTIONS, /Output language: English\./);
    assert.match(en.DECOMPOSE_INSTRUCTIONS, /whatever the language of the input/);
    assert.match(es.harnessPrompt({ unitCount: 3 }), /Idioma de salida: español latinoamericano neutro/);
    assert.match(en.harnessPrompt({ unitCount: 3 }), /Output language: English/);
  });

  it('the Spanish set is neutral Latin American: no voseo and no vocabulary exclusive to Spain except where it names them as forbidden', () => {
    const text = [es.CLASSIFY_INSTRUCTIONS, es.DECOMPOSE_INSTRUCTIONS, es.harnessPrompt({ unitCount: 2, retryErrors: ['x'] })].join('\n');
    assert.doesNotMatch(text, VOSEO);
    const withoutForbiddenList = text.replaceAll("(ordenador, vale, coger)", "");
    assert.doesNotMatch(withoutForbiddenList, SPAIN);
  });

  it('the decomposition of both sets carries the writing contract (UD-019)', () => {
    for (const [set, marks] of [[es, ['Contrato de redacción', 'rayas largas', 'sin fisuras', 'es, tiene, falla, tarda']], [en, ['Writing contract', 'em dashes', 'seamless', 'is, has, fails, takes']]]) {
      for (const mark of marks) assert.ok(set.DECOMPOSE_INSTRUCTIONS.includes(mark), `missing «${mark}»`);
    }
  });

  it('the contract is short enough to keep the prompt cheap', () => {
    for (const set of [es, en]) {
      const text = set.DECOMPOSE_INSTRUCTIONS;
      const contract = text.slice(text.indexOf(set === es ? 'Contrato de redacción' : 'Writing contract'));
      const end = contract.indexOf(set === es ? 'Idioma de salida' : 'Output language');
      assert.ok(end > 0 && end / 4 < 400, `the contract is about ${Math.round(end / 4)} tokens`);
    }
  });

  it('the language reaches the system prompt of each call and the user messages', async () => {
    const { areas, templates } = await makeBundle();
    assert.match(classifySystem({ areas, templates }).join('\n'), /Eres el clasificador/);
    assert.match(classifySystem({ areas, templates, language: 'en' }).join('\n'), /You are the classifier/);
    const template = parseTemplate(templates[1].body_markdown);
    assert.match(decomposeSystem(template).join('\n'), /Plantilla elegida:/);
    assert.match(decomposeSystem(template, undefined, 'en').join('\n'), /Chosen template:/);
    assert.match(harnessPrompt({ unitCount: 2, language: 'en' }), /You are the analyzer/);
  });

  for (const [language, classifyHead, userHead] of [[undefined, /Eres el clasificador/, /Texto del input/], ['es-419', /Eres el clasificador/, /Texto del input/], ['en', /You are the classifier/, /Input text/]]) {
    it(`analyze() with language ${language ?? '(absent)'} sends the prompts of that set`, async () => {
      const bundle = await makeBundle(language === undefined ? { language: undefined } : { language });
      if (language === undefined) delete bundle.language;
      const fake = createFakeProviders({
        text: scriptByRequest({
          classification: CLASSIFY_ERRORS,
          decompositions: { 'Reporte de error': { messages: [bugMessage([2, 3, 4, 5], 'Corregir cuatro errores')] } },
        }),
      });
      const result = await analyze(bundle, { providers: fake });
      assert.equal(result.status, 'ok', JSON.stringify(result.errors));
      const [first] = fake.calls.text;
      assert.match(first.system.join('\n'), classifyHead);
      assert.match(JSON.stringify(first.messages), userHead);
    });
  }
});
