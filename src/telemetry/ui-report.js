// The text of the interface report (UD-091): `scripts/ui-report.mjs` prints it. A pure function of the summary that
// `GET /api/telemetry/ui-summary` returns, so a test can read it without a server.

const pct = (x) => (x === null || x === undefined ? '-' : `${(x * 100).toFixed(1)} %`)
const num = (x) => (x === null || x === undefined ? '-' : String(x))
const secs = (ms) => (ms === null || ms === undefined ? '-' : `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`)
const ms = (x) => (x === null || x === undefined ? '-' : `${x} ms`)

/** A plain-text table: header, rule and rows, each column as wide as its longest cell. */
export function table (head, rows) {
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)))
  const line = (cells) => cells.map((c, i) => (i === 0 ? String(c).padEnd(widths[i]) : String(c).padStart(widths[i]))).join('  ')
  return [line(head), widths.map((w) => '-'.repeat(w)).join('  '), ...rows.map(line)].join('\n')
}

const TASK_NAMES = { send_publish: 'Enviar y publicar', reply: 'Responder', close: 'Cerrar' }
const SCREEN_NAMES = { home: 'Inicio', messages: 'Mensajes', 'message-detail': 'Mensaje', areas: 'Áreas', connections: 'Conexiones', team: 'Equipo', settings: 'Configuración', login: 'Entrada', 'not-found': 'No encontrada' }
const RATINGS = { good: 'bueno', 'needs-improvement': 'a mejorar', poor: 'malo' }

export function renderReport (s) {
  const out = []
  out.push(`Telemetría de interfaz, del ${s.window.since.slice(0, 16).replace('T', ' ')} al ${s.window.until.slice(0, 16).replace('T', ' ')} (UTC)`)
  out.push(`${s.sessions} sesiones, ${s.events} eventos`)

  const tasks = Object.entries(s.tasks)
  out.push('', 'Tareas (duración y esfuerzo de las completadas; percentiles p50, p75, p95)')
  out.push(tasks.length === 0
    ? 'Sin tareas en la ventana.'
    : table(['Tarea', 'Inicios', 'Completas', 'Abandono', 'Falla', 'Duración p50', 'p95', 'Clics p50', 'p95', 'Desplazamientos p50', 'p95'],
      tasks.map(([id, t]) => [TASK_NAMES[id] ?? id, t.started, t.completed, pct(t.abandon_rate), pct(t.failure_rate), secs(t.duration_ms.p50), secs(t.duration_ms.p95), num(t.clicks.p50), num(t.clicks.p95), num(t.scroll_events.p50), num(t.scroll_events.p95)])))

  const send = s.tasks.send_publish
  if (send?.stages_ms) {
    out.push('', 'Etapas del envío (tramo propio de cada una)')
    out.push(table(['Etapa', 'Medidas', 'p50', 'p75', 'p95'], [
      ['Clic en Enviar a primer cambio visible', 'feedback'],
      ['Primer cambio a análisis visible', 'analysis'],
      ['Análisis visible a publicado', 'publish']
    ].map(([label, key]) => [label, send.stages_ms[key].n, secs(send.stages_ms[key].p50), secs(send.stages_ms[key].p75), secs(send.stages_ms[key].p95)])))
  }

  const screens = Object.entries(s.screens)
  out.push('', 'Pantallas')
  out.push(screens.length === 0
    ? 'Sin visitas en la ventana.'
    : table(['Pantalla', 'Visitas', 'Pintado p75', 'Estancia p50', 'Clics/visita p50', 'Teclado', 'Errores/100', 'CLS p75', 'INP p75', 'LCP p75'],
      screens.map(([id, v]) => [SCREEN_NAMES[id] ?? id, v.visits, ms(v.render_ms.p75), secs(v.dwell_ms.p50), num(v.clicks_per_visit.p50), pct(v.keyboard_share), num(v.errors_per_100_visits),
        v.vitals.cls_p75 === null ? '-' : `${v.vitals.cls_p75} ${RATINGS[v.vitals.cls_rating]}`,
        v.vitals.inp_ms_p75 === null ? '-' : `${v.vitals.inp_ms_p75} ms ${RATINGS[v.vitals.inp_rating]}`,
        v.vitals.lcp_ms_p75 === null ? '-' : `${v.vitals.lcp_ms_p75} ms ${RATINGS[v.vitals.lcp_rating]}`])))
  const long = screens.filter(([, v]) => v.vitals.long_tasks > 0)
  if (long.length > 0) out.push('', 'Tareas largas (más de 50 ms)', table(['Pantalla', 'Cantidad', 'Tiempo total'], long.map(([id, v]) => [SCREEN_NAMES[id] ?? id, v.vitals.long_tasks, ms(v.vitals.long_task_ms)])))

  out.push('', `Errores: ${s.errors.total} (${s.errors.per_100_navigations} por cada 100 navegaciones)`)
  const kinds = Object.entries(s.errors.by_kind)
  if (kinds.length > 0) out.push(table(['Tipo', 'Cantidad'], kinds))
  if (s.errors.top_endpoints.length > 0) out.push('', table(['Ruta con más errores', 'Errores'], s.errors.top_endpoints.map((e) => [e.endpoint, e.errors])))

  out.push('', `Entrada: teclado ${pct(s.input.keyboard_share)} (${s.input.key_presses} teclas contra ${s.input.pointer_presses} punteros)`)
  out.push('', 'Ventanas (ancho, visitas)', table(['Ancho', 'Visitas'], s.viewports.map((v) => [v.width, v.visits])))

  out.push('', `Peores recorridos por clics hasta completar (${s.worst_journeys.length})`)
  out.push(s.worst_journeys.length === 0
    ? 'Sin tareas completadas.'
    : table(['Tarea', 'Clics', 'Desplazamientos', 'Teclas', 'Pantallas', 'Duración', 'Cuándo (UTC)', 'Sesión'],
      s.worst_journeys.map((w) => [TASK_NAMES[w.task] ?? w.task, w.clicks, w.scroll_events, w.key_presses, w.screens, secs(w.duration_ms), w.at.slice(0, 16).replace('T', ' '), w.session.slice(0, 8)])))
  return out.join('\n')
}
