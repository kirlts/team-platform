// La referencia misma tiene que ser MECE: cada unidad en exactamente un mensaje o descartada.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCases, loadFixtures } from './lib.js';
import { score } from './score.js';

const cases = loadCases();
const fixtures = loadFixtures();

test('hay al menos seis casos', () => {
  assert.ok(cases.length >= 6, `hay ${cases.length}`);
});

for (const c of cases) {
  test(`${c.id}: la referencia cubre cada unidad una sola vez`, () => {
    const ids = c.input.units.map((u) => u.id);
    assert.equal(new Set(ids).size, ids.length, 'ids de unidad repetidos');

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
      assert.ok(d.reason, `${d.unit_id} descartada sin motivo`);
      place(d.unit_id, 'descartadas');
    }
    assert.equal(seen.size, ids.length, 'quedan unidades sin asignar');
  });

  test(`${c.id}: área y plantilla esperadas existen en las fixtures`, () => {
    const areas = [].concat(c.expected.area);
    const templates = [].concat(c.expected.template);
    for (const a of areas) assert.ok(fixtures.areas.some((x) => x.id === a), `área ${a}`);
    for (const t of templates) assert.ok(fixtures.templates.some((x) => x.id === t), `plantilla ${t}`);
  });

  test(`${c.id}: las fuentes de las unidades son texto escrito o un adjunto declarado`, () => {
    const sources = new Set(['t', ...c.input.attachments.map((a) => a.id)]);
    for (const u of c.input.units) assert.ok(sources.has(u.source), `${u.id} tiene fuente ${u.source}`);
  });

  test(`${c.id}: la referencia usada como salida puntúa MECE`, () => {
    const actual = {
      area_id: [].concat(c.expected.area)[0],
      template_id: [].concat(c.expected.template)[0],
      messages: c.expected.messages,
      discarded: c.expected.discarded,
    };
    const r = score({ units: c.input.units, expected: c.expected, actual });
    assert.equal(r.mece, true);
    assert.equal(r.area_ok, true);
    assert.equal(r.template_ok, true);
  });
}

test('el caso de los 40 puntos tiene 40 mensajes esperados', () => {
  const c = cases.find((x) => x.id === '02-docx-40-puntos');
  assert.equal(c.expected.messages.length, 40);
});

test('el monólogo dura diez minutos y una de sus referencias no es contigua', () => {
  const c = cases.find((x) => x.id === '03-monologo-prueba');
  assert.match(c.input.units.at(-1).text, /^\[09:48\]/);
  const gaps = c.expected.messages.some((m) => {
    const n = m.unit_ids.map((id) => Number(id.slice(1))).sort((a, b) => a - b);
    return n.some((v, i) => i > 0 && v - n[i - 1] > 1);
  });
  assert.ok(gaps);
});

test('ningún caso lleva datos de contacto reales', () => {
  const text = JSON.stringify(cases.map((c) => c.input));
  assert.equal(/@[\w-]+\.\w+/.test(text), false, 'hay un correo');
  assert.equal(/\+\d{1,3}[\s-]?\d{6,}|\b\d{3}[\s-]\d{3}[\s-]\d{3,4}\b/.test(text), false, 'hay un teléfono');
});
