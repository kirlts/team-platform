// @vitest-environment node
// UD-050: the interface speaks like an instrument, not like a conversation. This test reads the code of the
// interface itself (the two catalogues and the progress phrases the server hands to the panel), never a
// person's text, and fails when a visible text falls in the chatty pattern: a sentence where a label goes, a
// question, the second person, a greeting, a colloquial imperative, an accompanying gerund, a final period.
// docs/investigaciones/08-lenguaje-de-instrumento-en-interfaces.md has the rules (R1 to R14) and their sources.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { en } from './i18n/en'
import { es419 } from './i18n/es-419'
import { progressKey } from './lib/progress-text'

type Lang = 'es' | 'en'
type RuleId = 'length' | 'opening' | 'person' | 'imperative' | 'punctuation' | 'gerund' | 'vague'

/** R1. The longest text a catalogue held on 2026-10-21 (measured: docs/investigaciones/08, section 6). */
const MAX_WORDS = 10
const MAX_WORDS_ERROR = 14

/**
 * Exceptions, by key (catalogue) or by quoted phrase (server). Each one names the rule it lifts and why.
 * A new entry needs a reason a reviewer accepts: "the text is long" is not one.
 */
const EXCEPTIONS: Record<string, { rule: RuleId; why: string }[]> = {
  'analysis.againWarning': [{ rule: 'length', why: 'UD-050: an action that cannot be undone may carry one short impersonal sentence with its consequence' }],
}

const SRC = fileURLToPath(new URL('.', import.meta.url))
const SERVER_SRC = join(SRC, '..', '..', 'src')

const strip = (text: string) => text.replace(/\{[A-Za-z]+\}/g, 'X').replace(/«[^»]*»|“[^”]*”/g, 'X')
const wordsOf = (text: string) => strip(text).split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w))
const first = (text: string) => (wordsOf(text)[0] ?? '').toLowerCase().replace(/[^\p{L}]/gu, '')
const ES_COLLOQUIAL_IMPERATIVES = new Set(
  'escribe adjunta elige selecciona ingresa introduce haz mira revisa usa pega sube toca pulsa aprieta arrastra prueba intenta espera recuerda verifica comprueba corrige completa confirma vuelve inténtalo escoge busca añade agrega pon'.split(' ')
)
const ES_PERSON = /(?<![\p{L}])(tú|tu|tus|tuyo|tuya|tuyos|tuyas|usted|ustedes|vos|te|ti|contigo|puedes|tienes|debes|quieres|necesitas|sabes|eres|estás|haces|ves|podés|tenés)(?![\p{L}])/iu
/** Second person of the preterite (enviaste, escribiste). The third person of these verbs ends the same way. */
const ES_PRETERITE = /(?<![\p{L}])(\p{L}+(?:aste|iste))(?![\p{L}])/giu
const ES_THIRD_PERSON = new Set(['existe', 'insiste', 'persiste', 'asiste', 'resiste', 'consiste', 'subsiste', 'desiste', 'triste'])
const preterite = (text: string) => [...text.matchAll(ES_PRETERITE)].some((m) => !ES_THIRD_PERSON.has(m[1].toLowerCase()))
const EN_PERSON = /(?<![\p{L}'])(you|your|yours|yourself|we|our|ours|let's|please)(?![\p{L}])/iu
const ES_OPENING = /^(aquí|ya|todavía|aún|hola|bienvenid[oa]s?|gracias|oops|ups|parece que|vaya)(?![\p{L}])/iu
const EN_OPENING = /^(here|already|yet|still|hi|hello|welcome|thanks|thank you|oops|sorry|looks like|seems|it seems|nothing)(?![\p{L}])/iu
const ES_ANYWHERE = /(?<![\p{L}])(todavía|aún no|por ahora)(?![\p{L}])/iu
const EN_ANYWHERE = /(?<![\p{L}])yet(?![\p{L}])/iu
const VAGUE = /(?<![\p{L}])(simplemente|fácilmente|realmente|sencillamente|robust[oa]s?|integral(es)?|sin duda|seamless|seamlessly|simply|easily|effortless(ly)?|robust|powerful)(?![\p{L}])/iu

/** The rules every visible text answers to. Returns the broken rule or null. */
export function breaksVoice(key: string, text: string, lang: Lang): RuleId | null {
  const plain = strip(text)
  const words = wordsOf(text)
  const isError = /(^|\.)error\./.test(key)
  if (words.length > (isError ? MAX_WORDS_ERROR : MAX_WORDS)) return 'length'
  if ((lang === 'es' ? ES_OPENING : EN_OPENING).test(plain.trim()) || (lang === 'es' ? ES_ANYWHERE : EN_ANYWHERE).test(plain)) return 'opening'
  if ((lang === 'es' ? ES_PERSON : EN_PERSON).test(plain) || (lang === 'es' && preterite(plain))) return 'person'
  if (lang === 'es' && ES_COLLOQUIAL_IMPERATIVES.has(first(text))) return 'imperative'
  // R7: no question, no exclamation, no ellipsis in three dots, no final period, one sentence.
  if (/[?¿!¡]/.test(plain) || /\.\.\./.test(plain) || /\.\s*$/.test(plain) || /[.]\s+\p{Lu}/u.test(plain)) return 'punctuation'
  // R8: a gerund opens only a state of one or two words.
  if (words.length > 2 && (lang === 'es' ? /(ando|iendo|yendo)$/ : /ing$/).test(first(text))) return 'gerund'
  if (VAGUE.test(plain)) return 'vague'
  return null
}

function variants(message: unknown): string[] {
  if (typeof message === 'string') return [message]
  if (message && typeof message === 'object') return Object.values(message as Record<string, string>)
  return []
}

function violations(catalog: Record<string, unknown>, lang: Lang) {
  const out: string[] = []
  for (const [key, message] of Object.entries(catalog)) {
    for (const text of variants(message)) {
      const rule = breaksVoice(key, text, lang)
      if (rule && !EXCEPTIONS[key]?.some((e) => e.rule === rule)) out.push(`${lang} ${key} [${rule}]: ${text}`)
    }
  }
  return out
}

function serverFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'testing' || name === 'node_modules' ? [] : serverFiles(path)
    return /\.js$/.test(name) && !/\.test\.js$/.test(name) ? [path] : []
  })
}

/** The phrases the server hands to the panel as progress: `report('…')`, `phrase: '…'`, `new Deferred(ms, '…')`, `phraseText || '…'`. */
function progressPhrases(): { file: string; text: string }[] {
  const found: { file: string; text: string }[] = []
  const patterns = [
    /\breport\(\s*(['"`])((?:\\.|(?!\1).)*?)\1/g,
    /\bphrase:\s*(['"`])((?:\\.|(?!\1).)*?)\1/g,
    /\bnew Deferred\([^,]+,\s*(['"`])((?:\\.|(?!\1).)*?)\1/g,
    /\bphraseText\s*\|\|\s*(['"`])((?:\\.|(?!\1).)*?)\1/g,
    /\.(?:advance|finish)\(\s*(['"`])((?:\\.|(?!\1).)*?)\1/g,
    /\bfinish\(phrase\s*=\s*(['"`])((?:\\.|(?!\1).)*?)\1/g,
    /\bphrase:\s*`([^`]*)`/g,
  ]
  for (const file of serverFiles(SERVER_SRC)) {
    const source = readFileSync(file, 'utf8')
    for (const re of patterns) {
      for (const m of source.matchAll(re)) {
        const text = (m[2] ?? m[1]).replace(/\$\{[^}]*\}/g, 'X')
        found.push({ file: relative(SERVER_SRC, file), text })
      }
    }
  }
  return found
}

describe('the interface speaks like an instrument (UD-050)', () => {
  it('Spanish catalogue: no text falls in the chatty pattern', () => {
    expect(violations(es419, 'es')).toEqual([])
  })

  it('English catalogue: same rules, same register', () => {
    expect(violations(en, 'en')).toEqual([])
  })

  it('progress phrases of the server: same rules as a Spanish catalogue text', () => {
    const phrases = progressPhrases()
    expect(phrases.length).toBeGreaterThan(15)
    const out = phrases
      .map(({ file, text }) => ({ file, text, rule: breaksVoice('progress.phrase', text, 'es') }))
      .filter((p) => p.rule && !EXCEPTIONS[p.text]?.some((e) => e.rule === p.rule))
      .map((p) => `${p.file} [${p.rule}]: ${p.text}`)
    expect(out).toEqual([])
  })

  it('every phrase of the server maps to a key of the catalogues, so the language of the account applies (H-1502)', () => {
    const unmapped = progressPhrases()
      .map((p) => p.text.replace('Transcripción: X X', 'Transcripción: 3 trozos').replace(/X/g, '3'))
      .filter((text) => !progressKey(text))
    expect(unmapped).toEqual([])
  })

  it('every exception still lifts something: none is left over', () => {
    const live = new Set<string>()
    for (const [catalog, lang] of [[es419, 'es'], [en, 'en']] as const) {
      for (const [key, message] of Object.entries(catalog)) {
        for (const text of variants(message)) {
          const rule = breaksVoice(key, text, lang)
          if (rule && EXCEPTIONS[key]?.some((e) => e.rule === rule)) live.add(`${key}:${rule}`)
        }
      }
    }
    for (const t of progressPhrases()) {
      const rule = breaksVoice('progress.phrase', t.text, 'es')
      if (rule && EXCEPTIONS[t.text]?.some((e) => e.rule === rule)) live.add(`${t.text}:${rule}`)
    }
    const stale = Object.entries(EXCEPTIONS).flatMap(([key, list]) => list.filter((e) => !live.has(`${key}:${e.rule}`)).map((e) => `${key}:${e.rule}`))
    expect(stale).toEqual([])
  })

  it('the rules themselves catch the pattern they name', () => {
    const bad: [string, Lang, RuleId][] = [
      ['Nota de voz con su transcripción y los detalles del archivo adjunto', 'es', 'length'],
      ['Aquí puedes ver tus mensajes', 'es', 'opening'],
      ['Todavía no hay nada', 'es', 'opening'],
      ['Lo enviaste tú', 'es', 'person'],
      ['Elige un envío', 'es', 'imperative'],
      ['¿Qué quieres hacer?', 'es', 'person'],
      ['Guardado.', 'es', 'punctuation'],
      ['¡Guardado!', 'es', 'punctuation'],
      ['Leyendo el documento con paciencia', 'es', 'gerund'],
      ['Una experiencia simplemente fluida', 'es', 'vague'],
      ['Here you can see your messages', 'en', 'opening'],
      ['You sent it', 'en', 'person'],
      ['Please enter an email', 'en', 'person'],
      ['Reading the document patiently now', 'en', 'gerund'],
      ['Saved.', 'en', 'punctuation'],
    ]
    for (const [text, lang, rule] of bad) expect(breaksVoice('probe', text, lang), text).toBe(rule)
    const good: [string, Lang][] = [
      ['Nota de voz', 'es'], ['Enviado por mí', 'es'], ['Leyendo adjuntos', 'es'], ['Sin mensajes', 'es'], ['Correo en uso', 'es'],
      ['Voice note', 'en'], ['Sent by me', 'en'], ['Reading attachments', 'en'], ['No messages', 'en'], ['Email in use', 'en'],
    ]
    for (const [text, lang] of good) expect(breaksVoice('probe', text, lang), text).toBeNull()
  })
})
