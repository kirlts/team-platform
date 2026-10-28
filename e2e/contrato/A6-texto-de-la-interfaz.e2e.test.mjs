// A6: the interface speaks in short texts, without internal jargon and without the second person.
// The catalogues are guarded by panel/src/ui-voice.test.ts; this walks the screens as the Editor sees them, with real data, and judges the text that is
// RENDERED: what a person wrote (messages, replies, areas, members, project) is skipped, everything else is the interface's own.
import assert from 'node:assert/strict'
import { before, describe, test } from 'node:test'
import { FILES, harness, settled } from './harness.mjs'
import { voicePatterns } from '../../panel/src/ui-voice-patterns.mjs'

let h
before(async () => { h = await harness() })

/** Internal vocabulary that must never reach a screen: decision and finding codes, and the names of modules and of the machinery. */
const JARGON = String.raw`(?<![\p{L}])(?:UD-\d+|H-\d{3,}|HP-\d+|execute|deliver|job|jobs|payload|endpoint|webhook|handler|worker|sha256|spans?|traceparent|scriptedAnalyze|Límite booleano)(?![\p{L}])`
/** A text longer than this in one element is a paragraph, not an interface label: only a person's own text may be that long. */
const MAX_CHARS = 120
/** Second person and the imperatives of address: the rules `person` and `imperative` of the language guard (UD-050), as data. */
const VOICE = voicePatterns('es').filter((p) => p.id === 'person' || p.id === 'imperative')

/** The texts a person wrote, as the API holds them: they are content, not interface. */
async function peopleTexts () {
  const api = h.api('ana')
  const texts = []
  const add = (...values) => values.filter((v) => typeof v === 'string' && v.trim()).forEach((v) => texts.push(v))
  const list = async (url) => { const r = (await api.get(url)).data; return Array.isArray(r) ? r : (r?.items ?? []) }
  for (const m of await list('/members')) add(m.name, m.email, m.profile)
  for (const a of await list('/areas')) { add(a.title, a.description); for (const g of a.guards ?? []) add(g.text, g.mechanism); for (const t of (await list(`/areas/${a.id}/templates`))) add(t.name, t.description, t.body_markdown) }
  const project = (await api.get('/settings/project')).data
  add(project?.name, project?.description)
  for (const row of await list('/messages?limit=100')) {
    const m = (await api.get(`/messages/${row.id}`)).data
    add(m.title, m.body, ...Object.values(m.fields ?? {}).filter((v) => typeof v === 'string'))
    for (const r of m.replies ?? []) add(r.body, r.forward_comment, r.comment, ...(r.attachments ?? []).map((a) => a.name))
    for (const a of m.attachments ?? []) add(a.name)
  }
  return texts
}

/** Opens every fold of the screen (one level, as the kit allows) so the text inside is rendered too. */
async function openFolds (page) {
  const folds = page.locator('main h2 > button[aria-expanded="false"]')
  for (let guard = 0; guard < 12 && (await folds.count()) > 0; guard++) { await folds.first().click(); await settled(page) }
}

/** The findings of one rendered screen. */
function judge (page, people) {
  return page.evaluate(({ people, voice, jargon, max }) => {
    const squash = (t) => t.replace(/\s+/g, ' ').trim()
    const content = people.map(squash).filter(Boolean)
    const rules = voice.map((p) => ({ id: p.id, re: new RegExp(p.source, p.flags) }))
    const jargonRe = new RegExp(jargon, 'iu')
    const out = []
    const seen = new Set()
    for (const el of document.body.querySelectorAll('*')) {
      if (['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT'].includes(el.tagName) || !el.checkVisibility?.({ checkVisibilityCSS: true })) continue
      if (el.closest('textarea, [data-user-text], [contenteditable], [aria-hidden=true]')) continue
      const own = squash([...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' '))
      if (!own) continue
      const whole = squash(el.textContent ?? '')
      if (content.some((p) => p.includes(own) || p.includes(whole) || (p.length >= 8 && whole.includes(p)))) continue
      const problems = []
      for (const r of rules) if (r.re.test(own)) problems.push(r.id === 'person' ? 'second person' : 'imperative of address')
      if (jargonRe.test(own)) problems.push('internal jargon')
      if (own.length > max) problems.push(`${own.length} characters`)
      for (const p of problems) {
        const key = `${p}|${own}`
        if (!seen.has(key)) { seen.add(key); out.push(`${p}: «${own.slice(0, 90)}»`) }
      }
    }
    return out
  }, { people, voice: VOICE, jargon: JARGON, max: MAX_CHARS })
}

describe('A6: the screens speak short, internal-jargon-free, in no second person', () => {
  test('A6: Inicio, Mensajes, a message, Áreas, an area, Equipo, Conexiones and Configuración have no text that breaks the voice', async () => {
    // A message with everything on it: media, recipients, replies, a forward.
    const rich = await h.message(h.unique('A6 mensaje completo'), { as: 'bruno', recipients: ['claude', 'carla'], files: [FILES.photo(), FILES.audio(), FILES.pdf()] })
    await h.api('carla').post(`/messages/${rich}/replies`, { body: 'Respuesta de Carla', kind: 'answer' })
    await h.api('ana').post(`/messages/${rich}/forward`, { member_id: String(h.people.diego.id), comment: 'Lo mira Diego' })
    const people = await peopleTexts()
    const area = ((await h.api('ana').get('/areas')).data.items ?? (await h.api('ana').get('/areas')).data)[0]

    const screens = [['Inicio', '/'], ['Mensajes', '/messages'], ['un mensaje', `/messages/${rich}`], ['Áreas', '/areas'], ['un área', `/areas/${area.id}`], ['Equipo', '/team'], ['Conexiones', '/connections'], ['Configuración', '/settings']]
    const { page, context } = await h.open('ana', { viewport: { width: 1440, height: 900 } })
    const findings = []
    try {
      for (const [name, route] of screens) {
        await page.goto(`${h.origin}${route}`)
        await page.locator('main#main').waitFor()
        await page.waitForLoadState('networkidle').catch(() => {})
        await settled(page)
        await openFolds(page)
        for (const f of await judge(page, people)) findings.push(`${name}: ${f}`)
      }
    } finally { await context.close() }
    assert.deepEqual(findings, [], `A6: the interface shows ${findings.length} text(s) outside the voice:\n${findings.join('\n')}`)
  })
})
