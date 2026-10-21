#!/usr/bin/env node
// H-1600: does a compound sentence with two actionable points keep both in the proposal? Runs the real analyzer on public
// sentences several times and reports, per sentence, in how many runs every point shows up in some message, and where the
// other runs lose it: the unit left in no message or discarded (classification) or both points inside one message that
// names only one (decomposition). The check is a measurement on the bench; nothing like it runs in the product.
//
//   node bench/probe-compound.mjs [--repeat 10] [--only n] [--config '{"knob":value}']
import { parseArgs } from 'node:util';
import { analyze } from '../src/analyze/index.js';
import { createProviders } from '../src/providers/index.js';
import { loadFixtures, buildBundle, loadCases } from './lib.js';
import { costOf } from './pricing.js';

/** The public case 09 adds its sentences with their `mentions`; the list below adds the variants tried in H-1600.
 * Each sentence lists the stems that identify each of its points in the proposal text (measurement only). */
export const SENTENCES = [
  { id: 'elogio-y-dos-defectos', text: 'Me encanta cómo quedó el panel de equipo, pero el menú se corta en el teléfono y la página de ajustes tarda más de diez segundos en cargar.', points: ['menú', 'ajustes'] },
  { id: 'dos-defectos-con-y', text: 'El menú se corta en el teléfono y la página de ajustes tarda más de diez segundos en cargar.', points: ['menú', 'ajustes'] },
  { id: 'elogio-y-dos-fallas', text: 'Muy buen trabajo con el panel de equipo, aunque los filtros no guardan la selección y la exportación genera un archivo vacío.', points: ['filtro', 'export'] },
  { id: 'rendimiento-y-visual', text: 'La lista de entregas tarda casi un minuto en abrir y los botones se ven desalineados en la tableta.', points: ['entregas', 'botones'] },
  { id: 'error-y-pedido', text: 'El recordatorio llega duplicado y además necesito poder elegir a qué hora sale.', points: ['recordatorio', 'hora'] },
];

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function coverage(proposal, points) {
  const texts = (proposal?.messages ?? []).map((m) => norm(JSON.stringify([m.title, m.body, m.fields])));
  const found = points.map((p) => texts.some((t) => t.includes(norm(p))));
  const alone = points.map((p) => texts.filter((t) => t.includes(norm(p))).length);
  return { found, all: found.every(Boolean), messages: texts.length, split: alone.every((n) => n > 0) && texts.length >= points.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: { repeat: { type: 'string', default: '10' }, only: { type: 'string' }, config: { type: 'string' } } });
  const fixtures = await loadFixtures();
  const providers = createProviders(process.env);
  let total = 0;
  for (const s of SENTENCES.filter((x) => !values.only || x.id === values.only)) {
    const runs = await Promise.all(Array.from({ length: Number(values.repeat) }, async () => {
      const r = await analyze(buildBundle({ text: s.text, attachments: [] }, fixtures), { providers, ...(values.config ? { config: JSON.parse(values.config) } : {}) });
      total += (r.calls ?? []).reduce((a, c) => a + (costOf(c) ?? 0), 0);
      return { status: r.status, discarded: r.proposal?.discarded?.length ?? 0, ...coverage(r.proposal, s.points) };
    }));
    const ok = runs.filter((r) => r.all).length;
    const two = runs.filter((r) => r.messages >= 2).length;
    console.log(`${s.id.padEnd(24)} ambos puntos ${ok}/${runs.length}  dos o más mensajes ${two}/${runs.length}  descartada ${runs.filter((r) => r.discarded > 0).length}  sin propuesta ${runs.filter((r) => r.status !== 'ok').length}`);
  }
  console.log(`costo ${total.toFixed(4)} USD`);
}
