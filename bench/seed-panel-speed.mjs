// Synthetic data for the panel speed bench: the same shape and size as a team's real history (a message list of one
// page of 50, a history of 39 sends with proposal and units), with invented text. No real person or content in it.
//   DATA_DIR=/path node bench/seed-panel-speed.mjs
import { loadConfig } from '../src/config.js'
import { initializeDatabase, openInitialized, run, get, all, tx } from '../src/db/index.js'
import { seedDefaults } from '../src/db/seed.js'
import { createMember } from '../src/domain/members.js'

const config = loadConfig()
await initializeDatabase(config, { seed: seedDefaults })
const db = openInitialized(config)

const WORDS = 'el cuadro muestra los intentos que cierran la cuenta y los minutos que queda cerrada por lo que el rótulo promete un historial que no existe botón título pantalla lista mensaje área plantilla campo texto cambio ajuste revisar corregir ficha panel equipo agenda aviso estado cerrado abierto respondido'.split(' ')
let seed = 7
const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647
const sentence = (n) => Array.from({ length: n }, () => WORDS[Math.floor(rnd() * WORDS.length)]).join(' ')

tx(db, () => {
  if (get(db, 'SELECT COUNT(*) AS n FROM messages').n > 0) return
  const editor = createMember(db, { email: 'bench@example.org', name: 'Bench', role: 'editor' })
  const other = createMember(db, { email: 'otra@example.org', name: 'Otra persona', role: 'member' })
  const areas = all(db, 'SELECT id FROM areas ORDER BY id')
  const templates = all(db, 'SELECT id, area_id FROM templates ORDER BY id')
  const now = Date.now()
  for (let i = 0; i < 39; i++) {
    const text = sentence(60)
    const units = Array.from({ length: 12 }, (_, u) => ({ id: u + 1, text: sentence(22) }))
    const r = run(db, "INSERT INTO inputs (author_id, text, content_hash, status, created_at, updated_at) VALUES (?, ?, ?, 'published', ?, ?)", editor, text, `bench-${i}`, now - i * 3_600_000, now - i * 3_600_000)
    const inputId = Number(r.lastInsertRowid)
    const proposal = { messages: Array.from({ length: 4 }, (_, k) => ({ area_id: String(areas[k % areas.length].id), template_id: String(templates[k % templates.length].id), title: sentence(14), body: sentence(45), fields: { tipo: 'texto', motivo: sentence(18), actual: sentence(20), expected: sentence(10), where: sentence(15) }, assignee_ids: [String(editor)], attachment_ids: [], unit_ids: [String(k + 1)] })), discarded: [] }
    run(db, 'INSERT INTO proposals (input_id, payload_json, units_json, created_at) VALUES (?, ?, ?, ?)', inputId, JSON.stringify(proposal), JSON.stringify(units), now)
    if (i < 13) {
      for (let k = 0; k < 4; k++) {
        const t = templates[(i + k) % templates.length]
        const status = ['open', 'answered', 'closed'][(i + k) % 3]
        const m = run(db, 'INSERT INTO messages (input_id, area_id, template_id, author_id, title, body, fields_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          inputId, t.area_id, t.id, i % 2 ? editor : other, sentence(14), sentence(55), JSON.stringify({ tipo: 'texto', motivo: sentence(18), actual: sentence(20), expected: sentence(10), where: sentence(15) }), status, now - (i * 4 + k) * 1_800_000)
        const id = Number(m.lastInsertRowid)
        run(db, 'INSERT INTO message_assignees (message_id, member_id) VALUES (?, ?)', id, editor)
        if (status !== 'open') run(db, 'INSERT INTO replies (message_id, author_id, body, created_at) VALUES (?, ?, ?, ?)', id, other, sentence(30), now - (i * 4 + k) * 1_700_000)
      }
    }
  }
})
console.log('messages', get(db, 'SELECT COUNT(*) AS n FROM messages').n, 'inputs', get(db, 'SELECT COUNT(*) AS n FROM inputs').n)
db.close()
