// Common material for the analyzer tests: bundle over the initial set of templates and
// scripts for the fake provider. It is not imported from production code.
import { loadSeed } from '../seed.js';

export const MEMBERS = [
  { id: 1, name: 'Ana Rojas', profile: 'Diseño las pantallas del panel y cuido la accesibilidad. Decido cómo se ve y se usa la interfaz.\n\nPrefiero recibir capturas y pasos para reproducir.' },
  { id: 2, name: 'Bruno Silva', profile: 'Me encargo de la API, la base de datos SQLite y las exportaciones CSV.\n\nNo toco la interfaz.' },
  { id: 3, name: 'Carla Díaz', profile: 'Llevo el producto y la comunicación con clientes. Defino requerimientos y prioridades.' },
];

// Three mixed bugs: A is told in two separate moments (u2 and u4).
export const MIXED_TEXT = [
  'Hola equipo, buenos días.',
  '',
  'La pantalla de ingreso queda en blanco al apretar Entrar.',
  '',
  'El CSV exportado trae las fechas en formato americano.',
  '',
  'Lo del ingreso solo pasa en Safari.',
  '',
  'Las notificaciones llegan duplicadas.',
  '',
  'Gracias, saludos.',
].join('\n');

export const ATTACHMENTS = [{ id: 10, kind: 'image', extracted: null }];

const seedCache = {};
export async function seed() {
  seedCache.value ??= await loadSeed();
  return structuredClone(seedCache.value);
}

/** Bundle of the initial set; `overrides` replaces text, attachments or members. */
export async function makeBundle(overrides = {}) {
  const { areas, templates } = await seed();
  return {
    text: MIXED_TEXT,
    attachments: ATTACHMENTS.map((a) => ({ ...a })),
    areas,
    templates,
    members: MEMBERS.map((m) => ({ ...m })),
    // The English set, so the assertions on prompt text read in English; the Spanish set has its own tests (prompts.test.js).
    language: 'en',
    ...overrides,
  };
}

// First call for MIXED_TEXT: the four bug points form one group; the greeting and the farewell are discarded.
export const CLASSIFY_ERRORS = {
  groups: [{ unit_ids: [2, 3, 4, 5], area_id: 2, template_id: 2 }],
  discarded: [{ unit_ids: [1], reason: 'saludo' }, { unit_ids: [6], reason: 'despedida' }],
};

// An input with a bug, an idea and a question (each in its own area) plus greeting and farewell.
export const MULTI_TEXT = [
  'Hola equipo.',
  '',
  'El botón Enviar de la vista previa no hace nada cuando hay un adjunto.',
  '',
  'Se me ocurre que los mensajes se podrían agrupar por día.',
  '',
  '¿Quién se encarga de renovar el certificado del dominio?',
  '',
  'Gracias.',
].join('\n');

export const CLASSIFY_MULTI = {
  groups: [
    { unit_ids: [2], area_id: 2, template_id: 2 },
    { unit_ids: [3], area_id: 1, template_id: 1 },
    { unit_ids: [4], area_id: 5, template_id: 5 },
  ],
  discarded: [{ unit_ids: [1], reason: 'saludo' }, { unit_ids: [5], reason: 'despedida' }],
};

export function bugMessage(unit_ids, title, extra = {}) {
  return {
    unit_ids,
    title,
    fields: { steps: 'Abrir la pantalla', expected: 'Que funcione', actual: 'Falla', where: 'Panel' },
    body: `Cuerpo de «${title}».`,
    assignee_ids: [1],
    attachment_ids: [],
    ...extra,
  };
}

/** Correct decomposition of the bug group of MIXED_TEXT: A = u2+u4, B = u3, C = u5. */
export function goodDecomposition() {
  return {
    messages: [
      bugMessage([2, 4], 'Corregir pantalla de ingreso en blanco en Safari'),
      bugMessage([3], 'Corregir formato de fechas en el CSV', { assignee_ids: [2] }),
      bugMessage([5], 'Corregir notificaciones duplicadas', { assignee_ids: [] }),
    ],
  };
}

/** Script for the fake for an analyzer with more than one template: answers according to what it is asked. */
export function scriptByRequest({ classification, decompositions }) {
  return (req) => {
    if (req.schema.properties.groups) return classification;
    const system = req.system.join('\n');
    for (const [templateName, out] of Object.entries(decompositions)) {
      if (system.includes(`Chosen template: ${templateName}`) || system.includes(`Plantilla elegida: ${templateName}`)) return typeof out === 'function' ? out(req) : out;
    }
    throw new Error(`script has no response for: ${system.slice(0, 80)}`);
  };
}

/** The unit numbers [uN] that appear in the text of the last user message of a request. */
export function unitIdsIn(req) {
  const last = req.messages.at(-1);
  const text = typeof last.content === 'string' ? last.content : JSON.stringify(last.content);
  return [...text.matchAll(/\[u(\d+)\]/g)].map((m) => Number(m[1]));
}

export const lastUserText = (req) => {
  const user = [...req.messages].reverse().find((m) => m.role === 'user');
  return typeof user.content === 'string' ? user.content : JSON.stringify(user.content);
};
