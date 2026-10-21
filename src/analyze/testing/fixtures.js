// Material común de las pruebas del analizador: bundle sobre el juego inicial de plantillas y
// guiones del proveedor falso. No se importa desde código de producción.
import { loadSeed } from '../seed.js';

export const MEMBERS = [
  { id: 1, name: 'Ana Rojas', responsibilities: 'Interfaz y pantallas del panel', domains: 'frontend, accesibilidad' },
  { id: 2, name: 'Bruno Silva', responsibilities: 'API, base de datos y exportaciones', domains: 'backend, SQLite, CSV' },
  { id: 3, name: 'Carla Díaz', responsibilities: 'Producto y comunicación con clientes', domains: 'requerimientos' },
];

// Tres errores mezclados: el A se cuenta en dos momentos separados (u2 y u4).
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

/** Bundle del juego inicial; `overrides` pisa texto, adjuntos o miembros. */
export async function makeBundle(overrides = {}) {
  const { areas, templates } = await seed();
  return {
    text: MIXED_TEXT,
    attachments: ATTACHMENTS.map((a) => ({ ...a })),
    areas,
    templates,
    members: MEMBERS.map((m) => ({ ...m })),
    ...overrides,
  };
}

export const ERROR_AREA = { area_id: 2, template_id: 2 };

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

/** Descomposición correcta del MIXED_TEXT: u1 y u6 descartadas; A = u2+u4, B = u3, C = u5. */
export function goodDecomposition() {
  return {
    messages: [
      bugMessage([2, 4], 'Corregir pantalla de ingreso en blanco en Safari'),
      bugMessage([3], 'Corregir formato de fechas en el CSV', { assignee_ids: [2] }),
      bugMessage([5], 'Corregir notificaciones duplicadas', { assignee_ids: [] }),
    ],
    discarded: [
      { unit_ids: [1], reason: 'saludo' },
      { unit_ids: [6], reason: 'despedida' },
    ],
  };
}

/** Los números de unidad [uN] que aparecen en el texto del último mensaje de usuario de una solicitud. */
export function unitIdsIn(req) {
  const last = req.messages.at(-1);
  const text = typeof last.content === 'string' ? last.content : JSON.stringify(last.content);
  return [...text.matchAll(/\[u(\d+)\]/g)].map((m) => Number(m[1]));
}

export const lastUserText = (req) => {
  const user = [...req.messages].reverse().find((m) => m.role === 'user');
  return typeof user.content === 'string' ? user.content : JSON.stringify(user.content);
};
