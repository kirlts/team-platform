#!/usr/bin/env node
// Writes `rows.jsonl`, the invented corpus of the routing method (a small online shop of bicycle parts). Every value is invented; run it to regenerate the file:
//
//   node bench/fixtures/area-method/generate.mjs > bench/fixtures/area-method/rows.jsonl
//
// The corpus is not separable on purpose, so that the tests exercise confusions and not only the happy path:
//   - 12 % of the requests of an area are phrased with the words of a neighbouring area («el costo de envío de un producto» belongs to the catalog), and one in four
//     of those also takes the module of the neighbour;
//   - 5 % of the rows carry the object of a neighbour, the way an extractor errs on an ambiguous summary;
//   - the dimensions are drawn around the mean of the intent with a standard deviation of 0.12, and some rows have no stated maximize or sacrifice;
//   - 15 % of the units hold two requests, and 8 % of the rows come from a recorded meeting (confidential).
import { seededRandom } from '../../../scripts/area-method.mjs'

const rand = seededRandom(20261026)
const pick = (list) => list[Math.floor(rand() * list.length)]
const chance = (p) => rand() < p
const clamp = (x) => Math.min(1, Math.max(0, x))
const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand())
const near = (mean, sd = 0.12) => +clamp(mean + sd * gauss()).toFixed(2)

const AREAS = {
  'pedidos y envíos': {
    size: 120,
    things: [['el aviso de despacho', ['transportista', 'aviso al cliente']], ['la devolución de un pedido', ['devoluciones', 'reembolso de envío']], ['el cálculo del flete', ['transportista', 'tarifas de flete']],
      ['la etiqueta de envío', ['etiquetas', 'impresión de etiquetas']], ['el seguimiento de un paquete', ['seguimiento', 'avisos de ruta']], ['el retiro en bodega', ['despacho', 'retiro en tienda']],
      ['la guía del transportista', ['etiquetas', 'guías']], ['el embalaje de un pedido grande', ['despacho', 'cajas y embalaje']]],
    askers: { Beto: 0.6, Carla: 0.2, Ana: 0.2 }, holder: 'Beto', limit: 'customer_data', limitRate: 0.45, urgency: 0.55,
    maximize: ['envío a tiempo y sin errores', 'etiqueta legible y completa', 'pedido completo en la bodega'], sacrifice: ['diseño de la etiqueta', 'informe de despachos', 'rapidez de la devolución']
  },
  'catálogo y precios': {
    size: 120,
    things: [['el precio de un repuesto', ['precios', 'lista de precios']], ['el descuento por cantidad', ['descuentos', 'precios por mayor']], ['las fotos de la ficha', ['fotos', 'galería']],
      ['el stock publicado', ['stock publicado', 'inventario visible']], ['la compatibilidad de una pieza', ['ficha de producto', 'compatibilidades']], ['la ficha de producto', ['ficha de producto', 'descripciones']],
      ['el costo de envío de un producto', ['precios', 'costo por producto']], ['la oferta de la semana', ['descuentos', 'ofertas']]],
    askers: { Ana: 0.6, Beto: 0.2, Carla: 0.2 }, holder: 'Ana', limit: 'money', limitRate: 0.5, urgency: 0.35,
    maximize: ['precio exacto en cada ficha', 'información completa del repuesto', 'stock real publicado'], sacrifice: ['orden de las fotos', 'rapidez de publicación', 'redacción de la ficha']
  },
  'atención al cliente': {
    size: 120,
    things: [['el reclamo por una garantía', ['garantías', 'plazos de garantía']], ['el horario de atención', ['horario', 'feriados']], ['la respuesta tipo a un cliente', ['respuestas', 'plantillas de respuesta']],
      ['las preguntas frecuentes', ['preguntas frecuentes', 'página de ayuda']], ['el correo de un cliente molesto', ['reclamos', 'tono de la respuesta']],
      ['la devolución de dinero que pide un cliente', ['reclamos', 'reembolsos']], ['el precio que un cliente reclama', ['respuestas', 'diferencias de precio']],
      ['el estado del pedido que consulta un cliente', ['respuestas', 'consultas de estado']]],
    askers: { Carla: 0.6, Ana: 0.2, Beto: 0.2 }, holder: 'Carla', limit: null, limitRate: 0, urgency: 0.7,
    maximize: ['respuesta clara y a tiempo', 'cliente que entiende qué sigue', 'tono amable'], sacrifice: ['tono formal', 'detalle de la respuesta', 'rapidez de la primera respuesta']
  },
  contabilidad: {
    size: 4,
    things: [['una factura de proveedor', ['facturas']], ['el cierre del mes', ['facturas']]],
    askers: { Ana: 1 }, holder: 'Ana', limit: 'money', limitRate: 1, urgency: 0.25,
    maximize: ['cifras exactas'], sacrifice: ['velocidad']
  }
}
const INTENTS = {
  falla: { verbs: ['Arreglar', 'Corregir'], dims: [0.32, 0.6, 0.42, 0.15], weight: 0.28 },
  ajuste: { verbs: ['Cambiar', 'Ajustar'], dims: [0.35, 0.4, 0.3, 0.2], weight: 0.27 },
  pregunta: { verbs: ['Consultar', 'Explicar'], dims: [0.1, 0.15, 0.05, 0.05], weight: 0.25 },
  decisión: { verbs: ['Decidir', 'Elegir'], dims: [0.4, 0.7, 0.6, 0.85], weight: 0.12 },
  'capacidad nueva': { verbs: ['Agregar', 'Crear'], dims: [0.8, 0.5, 0.5, 0.5], weight: 0.08 }
}
const weighted = (table) => { let x = rand() * Object.values(table).reduce((a, b) => a + (typeof b === 'number' ? b : b.weight), 0); for (const [k, v] of Object.entries(table)) { x -= typeof v === 'number' ? v : v.weight; if (x <= 0) return k } return Object.keys(table)[0] }

const names = Object.keys(AREAS)
const neighbours = (area) => names.filter((n) => n !== area && n !== 'contabilidad')
const requests = []
for (const [object, area] of Object.entries(AREAS)) {
  for (let i = 0; i < area.size; i++) {
    const intent = weighted(INTENTS)
    const spec = INTENTS[intent]
    const crossed = object !== 'contabilidad' && chance(0.12)
    const [thing, thingModules] = crossed ? pick(AREAS[pick(neighbours(object))].things) : pick(area.things)
    // An extractor usually names a module of the area even when the words are a neighbour's; one in four takes the neighbour's module.
    const module = crossed && !chance(0.25) ? pick(pick(area.things)[1]) : pick(thingModules)
    const labelled = object !== 'contabilidad' && chance(0.05) ? pick(neighbours(object)) : object
    const limits = area.limit && chance(area.limitRate) ? [area.limit] : []
    const holderIsPerson = intent === 'decisión' ? chance(0.9) : chance(0.06)
    const who = weighted(area.askers)
    requests.push({
      sortKey: rand(), object: labelled, intent, who, summary: `${pick(spec.verbs)} ${thing}`, module,
      dims: { understand_vs_create: near(spec.dims[0]), severity: near(spec.dims[1] + (limits.includes('money') ? 0.1 : 0)), irreversibility: near(spec.dims[2] + (limits.includes('money') ? 0.15 : 0)), missing_value: near(holderIsPerson ? 0.8 : spec.dims[3]) },
      value_holder: holderIsPerson ? 'person' : 'model', holder: holderIsPerson ? (chance(0.8) ? area.holder : who) : '', limits,
      maximize: chance(0.7) ? pick(area.maximize) : '', sacrifice: chance(0.6) ? pick(area.sacrifice) : '', urgency: near(area.urgency + (intent === 'falla' ? 0.1 : 0)), correction: intent === 'falla' && chance(0.3)
    })
  }
}
requests.sort((a, b) => a.sortKey - b.sortKey)

const start = Date.parse('2026-03-02')
const rows = []
let unit = 0
for (let i = 0; i < requests.length;) {
  const size = chance(0.15) && i + 1 < requests.length ? 2 : 1
  const confidential = chance(0.08)
  const date = new Date(start + Math.floor(((i / requests.length) * 56 + rand() * 3) * 86400000)).toISOString().slice(0, 10)
  unit++
  const author = requests[i].who // one message has one author
  for (const r of requests.slice(i, i + size)) {
    const { sortKey: _drop, dims } = r
    rows.push({
      unit: `u${String(unit).padStart(3, '0')}`, date, who: author, to: chance(0.9) ? 'Asistente' : pick(['Ana', 'Beto', 'Carla']), summary: r.summary, intent: r.intent, object: r.object, module: r.module,
      understand_vs_create: dims.understand_vs_create, severity: dims.severity, irreversibility: dims.irreversibility, missing_value: dims.missing_value, value_holder: r.value_holder, holder: r.holder,
      limits: r.limits, maximize: r.maximize, sacrifice: r.sacrifice, urgency: r.urgency, correction: r.correction, source: confidential ? 'reunión semanal' : 'chat del equipo', confidential
    })
  }
  i += size
}
process.stdout.write(`${rows.map((r) => JSON.stringify(r)).join('\n')}\n`)
