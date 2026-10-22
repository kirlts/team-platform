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
import { PROGRESS_PHRASES } from '../../src/domain/progress-phrases.js'
import { breaksVoice, voicePatterns } from './ui-voice-patterns.mjs'

type Lang = 'es' | 'en'
type RuleId = 'length' | 'opening' | 'person' | 'imperative' | 'punctuation' | 'gerund' | 'vague'
// The rules and their patterns live in ./ui-voice-patterns.mjs (H-1703), shared with the in-browser detector.

/** The only files that may name a `hint.*` key or draw a SettingHint: Configuración and the components it is made of (UD-122). */
const HINT_FILES = new Set([
  'pages/Settings.tsx',
  'components/SettingHint.tsx',
  'components/ProjectEditor.tsx',
  'components/InstallationSettings.tsx', // H-3722: project name and analysis framing, mounted only in Configuración
  'components/ProviderSettings.tsx',
  'components/PublicationSetting.tsx',
  'components/UiTelemetrySetting.tsx',
  'components/DataReset.tsx',
  'components/QueuePanel.tsx',
  'components/AuditLog.tsx',
])

/**
 * Exceptions, by key (catalogue) or by quoted phrase (server). Each one names the rule it lifts and why.
 * A new entry needs a reason a reviewer accepts: "the text is long" is not one.
 */
const EXCEPTIONS: Record<string, { rule: RuleId; why: string }[]> = {
  'analysis.againWarning': [{ rule: 'length', why: 'UD-050: an action that cannot be undone may carry one short impersonal sentence with its consequence' }],
}

const SRC = fileURLToPath(new URL('.', import.meta.url))

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

/**
 * The phrases the server hands to the panel as progress: the Spanish texts of its catalogue (H-3722), with each variable
 * as `X`. `src/domain/progress-phrases.test.js` checks that no emitter of the server writes a text outside it.
 */
function progressPhrases(): { file: string; code: string; text: string }[] {
  return Object.entries(PROGRESS_PHRASES as Record<string, Record<string, string | { one: string; other: string }>>).flatMap(([code, entry]) => {
    const message = entry['es-419']
    return (typeof message === 'string' ? [message] : [message.one, message.other]).map((text) => ({ file: `progress-phrases.js:${code}`, code, text: text.replace(/\{\w+\}/g, 'X') }))
  })
}

const BAD: [string, Lang, RuleId][] = [
  ['Nota de voz con su transcripción y los detalles del archivo adjunto', 'es', 'length'],
  ['Aquí puedes ver tus mensajes', 'es', 'opening'],
  ['Todavía no hay nada', 'es', 'opening'],
  ['Lo enviaste tú', 'es', 'person'],
  ['Elige un envío', 'es', 'imperative'],
  ['Revísala y publícala', 'es', 'person'],
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
const GOOD: [string, Lang][] = [
  ['Nota de voz', 'es'], ['Enviado por mí', 'es'], ['Leyendo adjuntos', 'es'], ['Sin mensajes', 'es'], ['Correo en uso', 'es'],
  ['Voice note', 'en'], ['Sent by me', 'en'], ['Reading attachments', 'en'], ['No messages', 'en'], ['Email in use', 'en'],
]

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

  it('every progress code of the server maps to a key of the catalogues, so the language of the account applies (H-1502, H-3722)', () => {
    const unmapped = progressPhrases()
      .map((p) => p.code)
      .filter((code) => !progressKey(code))
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

  it('the hint keys only appear in Configuración (UD-122)', () => {
    const used: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) walk(path)
        else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !path.includes(join('src', 'i18n'))) {
          if (/['"`]hint\.|SettingHint/.test(readFileSync(path, 'utf8'))) used.push(relative(SRC, path).split('\\').join('/'))
        }
      }
    }
    walk(SRC)
    expect(used.filter((f) => !HINT_FILES.has(f))).toEqual([])
    expect(used).toContain('pages/Settings.tsx')
  })

  it('the hint rules fail what they name: 91 characters, second person, an opening, an imperative, a gerund, an adjective (UD-122)', () => {
    const exact = 'Contexto en markdown que recibe el análisis con cada mensaje y que todo el equipo lee ya'.padEnd(90, 'x')
    expect(exact).toHaveLength(90)
    expect(breaksVoice('hint.probe', exact, 'es')).toBeNull()
    expect(breaksVoice('hint.probe', `${exact}x`, 'es')).toBe('length')
    expect(breaksVoice('hint.probe', 'Nombre que aparece en los mensajes, la lista de respuestas y las menciones del resto del equipo', 'es')).toBe('length')
    expect(breaksVoice('hint.probe', 'Aquí se elige el idioma de la cuenta', 'es')).toBe('opening')
    expect(breaksVoice('hint.probe', 'Si cambias el idioma, tu cuenta lo recuerda', 'es')).toBe('person')
    expect(breaksVoice('hint.probe', 'Elige el idioma de la cuenta', 'es')).toBe('imperative')
    expect(breaksVoice('hint.probe', 'Mostrando el idioma de esta cuenta en toda la interfaz', 'es')).toBe('gerund')
    expect(breaksVoice('hint.probe', 'Un ajuste robusto del idioma', 'es')).toBe('vague')
    expect(breaksVoice('hint.probe', 'Idioma de la interfaz.', 'es')).toBe('punctuation')
    expect(breaksVoice('hint.probe', 'Language you can choose for your account', 'en')).toBe('person')
    // Outside Configuración the limit stays at ten words.
    expect(breaksVoice('areas.probe', 'Contexto en markdown que recibe el análisis con cada mensaje del equipo', 'es')).toBe('length')
  })

  it('the rules themselves catch the pattern they name', () => {
    for (const [text, lang, rule] of BAD) expect(breaksVoice('probe', text, lang), text).toBe(rule)
    for (const [text, lang] of GOOD) expect(breaksVoice('probe', text, lang), text).toBeNull()
  })

  it('the exported patterns, which the in-browser detector reads, agree with the guard on its own samples (H-1703)', () => {
    const matches = (text: string, lang: Lang) => voicePatterns(lang).filter((p) => new RegExp(p.source, p.flags).test(text)).map((p) => p.id)
    for (const [text, lang, rule] of BAD) expect(matches(text, lang), text).toContain(rule)
    for (const [text, lang] of GOOD) expect(matches(text, lang), text).toEqual([])
    // The third person of the verbs that end like a preterite is not a second person.
    expect(matches('Existe una copia', 'es')).toEqual([])
  })

  it('no text of the catalogues that the guard accepts is flagged by the patterns', () => {
    const flagged: string[] = []
    for (const [catalog, lang] of [[es419, 'es'], [en, 'en']] as const) {
      for (const [key, message] of Object.entries(catalog)) {
        for (const text of variants(message)) {
          if (breaksVoice(key, text, lang) || /\{|«|“/.test(text)) continue
          // An error text may run to MAX_WORDS_ERROR words; the pattern for length knows only the common limit.
          const ids = voicePatterns(lang).filter((p) => new RegExp(p.source, p.flags).test(text)).map((p) => p.id).filter((id) => !(id === 'length' && (/(^|\.)error\./.test(key) || key.startsWith('hint.'))))
          if (ids.length) flagged.push(`${lang} ${key} [${ids}]: ${text}`)
        }
      }
    }
    expect(flagged).toEqual([])
  })
})
