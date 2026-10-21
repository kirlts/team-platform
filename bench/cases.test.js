// La referencia misma tiene que ser MECE: cada unidad que numera el analizador, en exactamente un
// mensaje esperado o descartada. Si cambia la segmentación de src/analyze/units.js, estas pruebas
// fallan y expected.json se vuelve a numerar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCases, loadFixtures, unitsOf } from './lib.js';
import { score } from './score.js';

const cases = loadCases();
const fixtures = await loadFixtures();

test('hay al menos seis casos', () => {
  assert.ok(cases.length >= 6, `hay ${cases.length}`);
});

for (const c of cases) {
  const units = unitsOf(c.input);
  const ids = units.map((u) => u.id);

  test(`${c.id}: la referencia cubre cada unidad numerada una sola vez`, () => {
    const seen = new Map();
    const place = (id, where) => {
      assert.ok(ids.includes(id), `${where} cita ${id}, que no existe`);
      assert.ok(!seen.has(id), `${id} está en ${where} y en ${seen.get(id)}`);
      seen.set(id, where);
    };
    for (const m of c.expected.messages) {
      assert.ok(m.unit_ids.length > 0, `${m.id} no tiene unidades`);
      for (const id of m.unit_ids) place(id, m.id);
    }
    for (const d of c.expected.discarded) {
      assert.ok(d.reason, `${d.unit_ids} descartadas sin motivo`);
      for (const id of d.unit_ids) place(id, 'descartadas');
    }
    assert.equal(seen.size, ids.length, 'quedan unidades sin asignar');
  });

  test(`${c.id}: área y plantilla esperadas de cada mensaje existen en el juego inicial y se corresponden`, () => {
    for (const m of c.expected.messages) {
      const areas = [].concat(m.area_id);
      const templates = [].concat(m.template_id);
      assert.equal(areas.length, templates.length, `${m.id}: áreas y plantillas desparejas`);
      areas.forEach((area, i) => {
        assert.ok(fixtures.areas.some((a) => a.id === area), `${m.id}: área ${area}`);
        const template = fixtures.templates.find((t) => t.id === templates[i]);
        assert.ok(template, `${m.id}: plantilla ${templates[i]}`);
        assert.equal(template.area_id, area, `${m.id}: la plantilla ${template.id} no es del área ${area}`);
      });
    }
  });

  test(`${c.id}: los adjuntos del input traen texto extraído`, () => {
    for (const a of c.input.attachments) assert.ok(a.extracted?.trim(), `adjunto ${a.id} sin texto`);
    assert.ok(c.input.text.trim() || c.input.attachments.length > 0);
  });

  test(`${c.id}: la referencia usada como salida puntúa MECE con la clasificación completa`, () => {
    const actual = {
      messages: c.expected.messages.map((m) => ({ ...m, area_id: [].concat(m.area_id)[0], template_id: [].concat(m.template_id)[0] })),
      discarded: c.expected.discarded,
    };
    const r = score({ units, expected: c.expected, actual });
    assert.equal(r.mece, true);
    assert.equal(r.rates.classification_accuracy, 1);
  });
}

test('el caso de los 40 puntos tiene 40 mensajes esperados', () => {
  const c = cases.find((x) => x.id === '02-docx-40-puntos');
  assert.equal(c.expected.messages.length, 40);
});

test('el monólogo llega a los diez minutos y una de sus referencias no es contigua', () => {
  const c = cases.find((x) => x.id === '03-monologo-prueba');
  assert.match(unitsOf(c.input).at(-1).text, /^\[09:48\]/);
  const gaps = c.expected.messages.some((m) => m.unit_ids.some((v, i) => i > 0 && v - m.unit_ids[i - 1] > 1));
  assert.ok(gaps);
});

test('el caso mezclado tiene mensajes de tres áreas distintas', () => {
  const c = cases.find((x) => x.id === '06-mensaje-mezclado');
  assert.equal(new Set(c.expected.messages.map((m) => m.area_id)).size, 3);
});

test('ningún caso lleva datos de contacto reales', () => {
  const text = JSON.stringify(cases.map((c) => c.input));
  assert.equal(/@[\w-]+\.\w+/.test(text), false, 'hay un correo');
  assert.equal(/\+\d{1,3}[\s-]?\d{6,}|\b\d{3}[\s-]\d{3}[\s-]\d{3,4}\b/.test(text), false, 'hay un teléfono');
});
