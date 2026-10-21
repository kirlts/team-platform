// UD-050 / H-1703: the patterns of the language guard, in one module that both the vitest guard
// (ui-voice.test.ts) and the in-browser detector (scripts/ui-detectors.mjs, rule `voice`) import, so the two
// cannot drift. docs/investigaciones/08-lenguaje-de-instrumento-en-interfaces.md has the rules (R1 to R14).

/** R1. The longest text a catalogue held on 2026-10-21 (measured: docs/investigaciones/08, section 6). */
export const MAX_WORDS = 10
export const MAX_WORDS_ERROR = 14
/** UD-122: a `hint.*` text of Configuración answers the rules of voice but measures its length in characters, not in words. */
export const MAX_HINT_CHARS = 90

export const strip = (text) => text.replace(/\{[A-Za-z]+\}/g, 'X').replace(/«[^»]*»|“[^”]*”/g, 'X')
export const wordsOf = (text) => strip(text).split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w))
export const first = (text) => (wordsOf(text)[0] ?? '').toLowerCase().replace(/[^\p{L}]/gu, '')

export const ES_COLLOQUIAL_IMPERATIVE_LIST =
  'escribe adjunta elige selecciona ingresa introduce haz mira revisa usa pega sube toca pulsa aprieta arrastra prueba intenta espera recuerda verifica comprueba corrige completa confirma vuelve inténtalo escoge busca añade agrega pon'.split(' ')
export const ES_COLLOQUIAL_IMPERATIVES = new Set(ES_COLLOQUIAL_IMPERATIVE_LIST)
export const ES_PERSON = /(?<![\p{L}])(tú|tu|tus|tuyo|tuya|tuyos|tuyas|usted|ustedes|vos|te|ti|contigo|puedes|tienes|debes|quieres|necesitas|sabes|eres|estás|haces|ves|podés|tenés)(?![\p{L}])/iu
/** Second person of the preterite (enviaste, escribiste). The third person of these verbs ends the same way. */
export const ES_PRETERITE = /(?<![\p{L}])(\p{L}+(?:aste|iste))(?![\p{L}])/giu
export const ES_THIRD_PERSON = new Set(['existe', 'insiste', 'persiste', 'asiste', 'resiste', 'consiste', 'subsiste', 'desiste', 'triste'])
/** Imperative with a clitic pronoun attached: the accent sits before the pronoun. */
export const ES_CLITIC_IMPERATIVE = /(?<![\p{L}])\p{L}*[áéíóú]\p{L}{0,2}[ae](la|lo|las|los)(?![\p{L}])/iu
export const preterite = (text) => [...text.matchAll(ES_PRETERITE)].some((m) => !ES_THIRD_PERSON.has(m[1].toLowerCase()))
export const EN_PERSON = /(?<![\p{L}'])(you|your|yours|yourself|we|our|ours|let's|please)(?![\p{L}])/iu
export const ES_OPENING = /^(aquí|ya|todavía|aún|hola|bienvenid[oa]s?|gracias|oops|ups|parece que|vaya)(?![\p{L}])/iu
export const EN_OPENING = /^(here|already|yet|still|hi|hello|welcome|thanks|thank you|oops|sorry|looks like|seems|it seems|nothing)(?![\p{L}])/iu
export const ES_ANYWHERE = /(?<![\p{L}])(todavía|aún no|por ahora)(?![\p{L}])/iu
export const EN_ANYWHERE = /(?<![\p{L}])yet(?![\p{L}])/iu
export const VAGUE = /(?<![\p{L}])(simplemente|fácilmente|realmente|sencillamente|robust[oa]s?|integral(es)?|sin duda|seamless|seamlessly|simply|easily|effortless(ly)?|robust|powerful)(?![\p{L}])/iu

/** The rules every visible text answers to. Returns the broken rule id or null. */
export function breaksVoice(key, text, lang) {
  const plain = strip(text)
  const words = wordsOf(text)
  const isError = /(^|\.)error\./.test(key)
  if (key.startsWith('hint.')) {
    if (plain.length > MAX_HINT_CHARS) return 'length'
  } else if (words.length > (isError ? MAX_WORDS_ERROR : MAX_WORDS)) return 'length'
  if ((lang === 'es' ? ES_OPENING : EN_OPENING).test(plain.trim()) || (lang === 'es' ? ES_ANYWHERE : EN_ANYWHERE).test(plain)) return 'opening'
  if ((lang === 'es' ? ES_PERSON : EN_PERSON).test(plain) || (lang === 'es' && (preterite(plain) || ES_CLITIC_IMPERATIVE.test(plain)))) return 'person'
  if (lang === 'es' && ES_COLLOQUIAL_IMPERATIVES.has(first(text))) return 'imperative'
  // R7: no question, no exclamation, no ellipsis in three dots, no final period, one sentence.
  if (/[?¿!¡]/.test(plain) || /\.\.\./.test(plain) || /\.\s*$/.test(plain) || /[.]\s+\p{Lu}/u.test(plain)) return 'punctuation'
  // R8: a gerund opens only a state of one or two words.
  if (words.length > 2 && (lang === 'es' ? /(ando|iendo|yendo)$/ : /ing$/).test(first(text))) return 'gerund'
  if (VAGUE.test(plain)) return 'vague'
  return null
}

const src = (re) => ({ source: re.source, flags: re.flags })

/**
 * The same rules as data, for the detector that runs inside a page: `{ id, lang, source, flags }`, each tested with
 * `new RegExp(source, flags)` against the text of one element. The guard strips `{placeholders}` and quoted spans
 * before it counts and matches; a rendered page has neither, so the patterns work on the plain text. `breaksVoice` is
 * the reference: `ui-voice.test.ts` checks that the patterns and the function agree on the guard's own samples.
 */
export const VOICE_PATTERNS = [
  // length: more than MAX_WORDS words separated by spaces.
  { id: 'length', lang: 'any', source: `^\\s*(?:\\S+\\s+){${MAX_WORDS}}\\S+`, flags: 'u' },
  { id: 'opening', lang: 'es', ...src(ES_OPENING) },
  { id: 'opening', lang: 'es', ...src(ES_ANYWHERE) },
  { id: 'opening', lang: 'en', ...src(EN_OPENING) },
  { id: 'opening', lang: 'en', ...src(EN_ANYWHERE) },
  { id: 'person', lang: 'es', ...src(ES_PERSON) },
  { id: 'person', lang: 'es', source: ES_PRETERITE.source, flags: ES_PRETERITE.flags.replace('g', '') },
  { id: 'person', lang: 'es', ...src(ES_CLITIC_IMPERATIVE) },
  { id: 'person', lang: 'en', ...src(EN_PERSON) },
  { id: 'imperative', lang: 'es', source: `^\\s*(?:${ES_COLLOQUIAL_IMPERATIVE_LIST.join('|')})(?![\\p{L}])`, flags: 'iu' },
  { id: 'punctuation', lang: 'any', source: '[?¿!¡]|\\.\\.\\.|\\.\\s*$|[.]\\s+\\p{Lu}', flags: 'u' },
  { id: 'gerund', lang: 'es', source: '^\\s*\\p{L}*(?:ando|iendo|yendo)\\s+\\S+\\s+\\S', flags: 'iu' },
  { id: 'gerund', lang: 'en', source: '^\\s*\\p{L}*ing\\s+\\S+\\s+\\S', flags: 'iu' },
  { id: 'vague', lang: 'any', ...src(VAGUE) },
]

/**
 * Patterns for one language, as the detector takes them. The third-person list of the preterite rule has no regex
 * form that stays short, so the few verbs it admits are removed by a lookahead.
 */
export function voicePatterns(lang = 'es') {
  return VOICE_PATTERNS.filter((p) => p.lang === lang || p.lang === 'any').map((p) => {
    if (p.id === 'person' && p.source === ES_PRETERITE.source) {
      return { ...p, source: `(?<![\\p{L}])(?!(?:${[...ES_THIRD_PERSON].join('|')})(?![\\p{L}]))${p.source}` }
    }
    return p
  })
}
