// Decomposition bank of one send into one or several messages (Martin, 2026-10-25: a send must become between one and several messages).
//
// The 12 sends are synthetic and about a delivery-route product (the fictional team of bench/fixtures.json); none holds data of a
// person. Each one is written as tagged segments: the request a segment belongs to (`r1`, `r2`… or null for a greeting or a
// sign-off that asks for nothing), so the expected units are computed by the analyzer's own numbering and never typed by hand.
//
// The test project has 4 areas, each with its template of the initial set (ids of templates/areas.json):
//   2 Error · 3 Nueva funcionalidad · 5 Pregunta · 1 Idea
import { numberUnits } from '../../src/analyze/units.js';

export const AREA_IDS = [2, 3, 5, 1];
const ERROR = 2;
const FEATURE = 3;
const QUESTION = 5;
const IDEA = 1;

const t = (req, text) => ({ req, text });

/** Units of one fragment on its own: text of the send, or one attachment of the given kind. */
function countUnits(kind, text) {
  const bundle = kind === 'text' ? { text, attachments: [] } : { text: '', attachments: [{ id: 1, kind, extracted: text }] };
  return numberUnits(bundle).length;
}

/**
 * @param {{id: string, title: string, why: string, text: Array, attachments?: Array, requests: Record<string, {area: number, attachments?: number[]}>}} def
 * `text`: segments of the written message (joined by blank lines). `attachments`: `{id, kind, name, segments, join}`; each segment is a line
 * of what the extractor wrote. `requests`: for each request its expected area; its template is the one of that area.
 */
function build(def) {
  const attachments = (def.attachments ?? []).map((a) => ({ id: a.id, kind: a.kind, name: a.name, extracted: a.segments.map((s) => s.text).join(a.join ?? '\n') }));
  // A segment that is an array is one run-on paragraph: its clauses are joined by a space and the analyzer numbers it as a single unit,
  // so the cut pass has to cut it. `cuts` records where, so the fake provider can answer like a perfect reader.
  const paragraphs = def.text.map((seg) => (Array.isArray(seg) ? { runOn: seg } : { seg }));
  const input = { id: def.id, title: def.title, kind: 'envio', description: def.why, text: paragraphs.map((p) => (p.runOn ? p.runOn.map((c) => c.text).join(' ') : p.seg.text)).join('\n\n'), attachments };

  // Expected units are those AFTER the cuts: sequential over the text and then over each attachment, in order.
  const owner = new Map(); // unit id -> request (null = discarded)
  const cuts = [];
  let next = 1; // numbering after the cuts
  let before = 1; // numbering before the cuts (what the analyzer sees when it is asked to cut)
  for (const p of paragraphs) {
    if (p.runOn) {
      const starts = p.runOn.slice(1).map((c) => c.text.split(/\s+/).slice(0, 4).join(' '));
      const joined = p.runOn.map((c) => c.text).join(' ');
      for (const at of starts) if (joined.indexOf(at) !== joined.lastIndexOf(at)) throw new Error(`${def.id}: «${at}» is not unique in its paragraph`);
      cuts.push({ unit_id: before, starts });
      for (const c of p.runOn) owner.set(next++, c.req);
      before += 1;
    } else {
      const n = countUnits('text', p.seg.text);
      for (let i = 0; i < n; i += 1) owner.set(next++, p.seg.req);
      before += n;
    }
  }
  for (const a of def.attachments ?? []) {
    for (const s of a.segments) {
      const n = countUnits(a.kind, s.text);
      for (let i = 0; i < n; i += 1) owner.set(next++, s.req);
    }
  }
  const total = numberUnits({ text: input.text, attachments }).length;
  const runOnExtra = paragraphs.filter((p) => p.runOn).reduce((n, p) => n + p.runOn.length - 1, 0);
  if (total + runOnExtra !== owner.size) throw new Error(`${def.id}: the segments number ${owner.size} units after the cuts and the analyzer ${total} plus ${runOnExtra} cut parts`);

  const order = Object.keys(def.requests);
  const messages = order.map((req) => {
    const unit_ids = [...owner].filter(([, r]) => r === req).map(([id]) => id);
    if (unit_ids.length === 0) throw new Error(`${def.id}: request ${req} has no units`);
    const area = def.requests[req].area;
    const own = (def.attachments ?? []).filter((a) => a.segments.some((s) => s.req === req)).map((a) => a.id);
    return { id: req, title: def.requests[req].title ?? req, area_id: area, template_id: area, unit_ids, attachment_ids: own };
  });
  const discarded = [...owner].filter(([, r]) => r === null).map(([id]) => ({ unit_ids: [id], reason: 'greeting or sign-off' }));
  return { id: def.id, input, expected: { id: def.id, messages, discarded, cuts }, why: def.why };
}

const DEFS = [
  {
    id: 'e01-un-pedido-con-captura',
    title: 'One request with its screenshot',
    why: 'Control: one request and its evidence must stay one message.',
    text: [
      t('r1', 'En la app del repartidor, al terminar una entrega el botón Confirmar queda gris y no deja cerrar la parada.'),
      t('r1', 'Me pasó ayer con tres paradas seguidas, en el teléfono de la empresa.'),
    ],
    attachments: [{ id: 1, kind: 'image', name: 'confirmar.png', segments: [t('r1', 'Pantalla de la parada 4 de la ruta: el botón Confirmar entrega aparece en gris, debajo del campo Firma vacío.')] }],
    requests: { r1: { area: ERROR } },
  },
  {
    id: 'e02-dos-areas-distintas',
    title: 'Two requests of two areas',
    why: 'An error and a new feature in one text: two messages, each with its own area.',
    text: [
      t(null, 'Equipo, les dejo dos cosas de hoy.'),
      t('r1', 'El reporte semanal se exporta con las fechas en formato americano y la bodega lo lee al revés.'),
      t('r2', 'Quiero que el panel muestre un mapa con la posición en vivo de cada repartidor.'),
      t('r2', 'Lo usaría el encargado de bodega para reasignar rutas sin llamar por teléfono.'),
    ],
    requests: { r1: { area: ERROR }, r2: { area: FEATURE } },
  },
  {
    id: 'e03-dos-del-mismo-area',
    title: 'Two requests of the same area',
    why: 'Two independent errors in one text: two messages of the same area, not one fused.',
    text: [
      t('r1', 'Primero: la búsqueda de clientes no encuentra nombres con tilde, por ejemplo Peñalolén no aparece si escribo Penalolen.'),
      t('r2', 'Segundo: al duplicar una ruta, la copia queda sin repartidor asignado y la original también lo pierde.'),
      t('r2', 'Esto último ya nos hizo perder una mañana de reparto.'),
    ],
    requests: { r1: { area: ERROR }, r2: { area: ERROR } },
  },
  {
    id: 'e04-tres-areas',
    title: 'Three requests of three areas in one dictated sentence',
    why: 'A dictated paragraph with no full stop: an error, a question to a person and an idea in a single unit. Three messages, three areas.',
    text: [[
      t('r1', 'oye las paradas aparecen duplicadas en la pantalla de ruta desde la actualización del martes'),
      t('r2', 'y otra cosa Tomás cuántas rutas por día aguanta el servidor antes de ponerse lento porque lo necesito para la propuesta de precio'),
      t('r3', 'y se me ocurre que podríamos agrupar las entregas por edificio para que el repartidor suba una sola vez'),
    ]],
    requests: { r1: { area: ERROR }, r2: { area: QUESTION }, r3: { area: IDEA } },
  },
  {
    id: 'e05-cinco-mezclados',
    title: 'Five requests of four areas in one text',
    why: 'The widest case: five points, two of them of the same area, with a sign-off that asks nothing.',
    text: [
      t(null, 'Hola equipo, vacié la cabeza de la semana en este mensaje.'),
      t('r1', 'La app del repartidor se cierra sola cuando se pierde la señal en medio de una entrega.'),
      t('r2', 'El correo de aviso al cliente llega sin el nombre del repartidor, sale el campo vacío.'),
      t('r3', 'Quiero poder filtrar las rutas del panel por comuna y por franja horaria.'),
      t('r4', '¿Alguien sabe qué proveedor de mapas estamos usando y cuánto nos cuesta por mes?'),
      t('r5', 'Quizás deberíamos ofrecer retiro en tienda como alternativa al despacho.'),
      t(null, 'Eso es todo por ahora, gracias.'),
    ],
    requests: { r1: { area: ERROR }, r2: { area: ERROR }, r3: { area: FEATURE }, r4: { area: QUESTION }, r5: { area: IDEA } },
  },
  {
    id: 'e06-captura-de-uno-solo',
    title: 'A screenshot that belongs to only one of two requests',
    why: 'The attachment goes with the error it shows and not with the question next to it.',
    text: [
      t('r1', 'Mira la captura: el total de la ruta suma 12 paradas pero en la lista hay 11.'),
      t('r2', '¿El cliente de Providencia ya firmó el contrato de este mes o seguimos esperando?'),
    ],
    attachments: [{ id: 1, kind: 'image', name: 'total-ruta.png', segments: [t('r1', 'Resumen de la ruta 7 con el texto Total: 12 paradas y una lista de 11 filas debajo.')] }],
    requests: { r1: { area: ERROR }, r2: { area: QUESTION } },
  },
  {
    id: 'e07-pregunta-de-investigacion-y-arreglo',
    title: 'A research question next to a fix, in one sentence',
    why: 'An open question that someone has to research and a plain fix in one sentence: they do not go in one message.',
    text: [[
      t('r1', 'El botón Exportar CSV del panel no hace nada cuando hay más de mil filas,'),
      t('r2', 'y además quiero saber qué opciones hay para notificar al cliente por WhatsApp en vez de correo y cuánto cuesta cada una antes de decidir si lo pedimos.'),
    ]],
    requests: { r1: { area: ERROR }, r2: { area: QUESTION } },
  },
  {
    id: 'e08-audio-tres-pedidos',
    title: 'A transcribed voice note with three requests',
    why: 'A voice note: each request is a run of segments and no text is written.',
    text: [],
    attachments: [{
      id: 1,
      kind: 'audio',
      name: 'nota-de-voz.m4a',
      segments: [
        t('r1', '[00:00-00:09] Voz: Les dejo tres cosas rápidas mientras manejo. Lo primero, el panel se queda cargando para siempre cuando abro la ruta del lunes.'),
        t('r1', '[00:09-00:17] Voz: Pasa solo con ese día, los demás abren bien.'),
        t('r2', '[00:17-00:28] Voz: Lo segundo, quiero que el repartidor pueda dejar una nota de voz en la parada, por ejemplo cuando no hay nadie en casa.'),
        t('r3', '[00:28-00:38] Voz: Y lo tercero es una duda: ¿cuántos reclamos por entrega fallida tuvimos el mes pasado?'),
      ],
    }],
    requests: { r1: { area: ERROR }, r2: { area: FEATURE }, r3: { area: QUESTION } },
  },
  {
    id: 'e09-tres-capturas-tres-pedidos',
    title: 'Three screenshots, one per request',
    why: 'Each screenshot goes with its own message and with no other.',
    text: [
      t('r1', 'El mapa del panel no carga las calles de la zona norte.'),
      t('r2', 'Quiero poder ordenar la lista de repartidores por nombre.'),
      t('r3', 'El botón Cerrar jornada de la barra inferior no responde cuando lo toco.'),
    ],
    attachments: [
      { id: 1, kind: 'image', name: 'mapa.png', segments: [t('r1', 'Mapa del panel con la zona norte en blanco y un aviso Sin datos de calles.')] },
      { id: 2, kind: 'image', name: 'lista.png', segments: [t('r2', 'Tabla de repartidores con la cabecera Nombre sin flecha de orden.')] },
      { id: 3, kind: 'image', name: 'botones.png', segments: [t('r3', 'Barra inferior con el botón Cerrar jornada y un círculo de carga que no termina.')] },
    ],
    requests: { r1: { area: ERROR }, r2: { area: FEATURE }, r3: { area: ERROR } },
  },
  {
    id: 'e10-lista-con-vinetas',
    title: 'A bulleted list of three requests',
    why: 'A bulleted list: one message per bullet, grouped by their areas.',
    text: [
      t(null, 'Pendientes que me anoté después de la reunión con el cliente:'),
      t('r1', '- El PDF de la guía de despacho sale cortado en el borde derecho.'),
      t('r2', '- La guía de despacho debería llevar el código de barras del pedido.'),
      t('r3', '- Quiero poder cambiar la dirección de entrega una vez que la ruta está en curso.'),
    ],
    requests: { r1: { area: ERROR }, r2: { area: FEATURE }, r3: { area: FEATURE } },
  },
  {
    id: 'e11-documento-compartido',
    title: 'A document attached for two requests',
    why: 'One document that carries two points, one of each area: both messages cite it.',
    text: [t(null, 'Adjunto el documento de la reunión con el cliente, con dos puntos que ya les comenté.')],
    attachments: [{
      id: 1,
      kind: 'pdf',
      name: 'acta-reunion.pdf',
      join: '\n\n',
      segments: [
        t('r1', 'El cliente reporta que las ventanas de entrega de la tarde se muestran una hora corridas en el panel.'),
        t('r2', 'El cliente pide que el panel permita imprimir la hoja de ruta de cada repartidor en una sola página.'),
      ],
    }],
    requests: { r1: { area: ERROR }, r2: { area: FEATURE } },
  },
  {
    id: 'e12-vuelve-al-primer-tema',
    title: 'A request that the person comes back to',
    why: 'The person starts with an error, talks about another request and comes back to the error: two messages, the first with two runs.',
    text: [
      t('r1', 'Las notificaciones push de la app del repartidor llegan con retraso de varios minutos.'),
      t('r2', 'Cambiando de tema, quiero que el cliente pueda reprogramar su entrega desde el correo de aviso.'),
      t('r1', 'Volviendo a las notificaciones, el retraso es peor cuando el teléfono está en ahorro de batería.'),
    ],
    requests: { r1: { area: ERROR }, r2: { area: FEATURE } },
  },
];

export const ENVIOS = DEFS.map(build);
