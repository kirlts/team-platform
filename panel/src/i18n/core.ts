// The translation core, without React: languages, plurals, variables and date formats. The two
// catalogs live in es-419.ts and en.ts; every visible string of the panel is one of their keys
// (UD-018), and src/i18n.test.ts checks that both have the same keys.

export const LANGUAGES = ['es-419', 'en'] as const
export type Language = (typeof LANGUAGES)[number]
export const DEFAULT_LANGUAGE: Language = 'es-419'

/** A message is a string, or a pair of strings chosen by the plural rule of the language for `n`. */
export type Message = string | { one: string; other: string }
export type Vars = Record<string, string | number>

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value)
}

/** The language of a browser before there is an account: Spanish for any Spanish locale, English for the rest. */
export function detectLanguage(navigatorLanguage: string | undefined): Language {
  return navigatorLanguage?.toLowerCase().startsWith('en') ? 'en' : DEFAULT_LANGUAGE
}

/** Fills `{name}` placeholders. A placeholder without a value stays visible so the gap is noticed. */
export function interpolate(text: string, vars?: Vars): string {
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole))
}

export function translate(catalog: Record<string, Message>, language: Language, key: string, vars?: Vars): string {
  const entry = catalog[key]
  if (entry === undefined) return key
  if (typeof entry === 'string') return interpolate(entry, vars)
  const n = Number(vars?.n ?? 0)
  const form = new Intl.PluralRules(language).select(n) === 'one' ? entry.one : entry.other
  return interpolate(form, vars)
}

export interface Formats {
  /** «20 de octubre de 2026» / «October 20, 2026». */
  longDate: (d: Date) => string
  /** «14:30». */
  clock: (d: Date) => string
  /** «hoy 14:30», «ayer 09:05» or «20 oct 14:30»; the words come from the catalog through `words`. */
  stamp: (iso: string, now?: Date) => string
  /** Full date and time for a tooltip: «20 de octubre de 2026, 14:30». */
  fullStamp: (iso: string) => string
  /** «12 KB». */
  fileSize: (bytes?: number) => string
}

export function createFormats(language: Language, words: { today: string; yesterday: string }): Formats {
  const date = new Intl.DateTimeFormat(language, { day: 'numeric', month: 'long', year: 'numeric' })
  const time = new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit', hour12: false })
  const short = new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short' })
  const number = new Intl.NumberFormat(language, { maximumFractionDigits: 1 })
  const clock = (d: Date) => time.format(d)
  const full = new Intl.DateTimeFormat(language, { dateStyle: 'full', timeStyle: 'short', hour12: false })
  return {
    longDate: (d) => date.format(d),
    fullStamp: (iso) => (Number.isNaN(new Date(iso).getTime()) ? '' : full.format(new Date(iso))),
    clock,
    stamp: (iso, now = new Date()) => {
      const d = new Date(iso)
      if (Number.isNaN(d.getTime())) return ''
      const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
      const diff = Math.round((day(now) - day(d)) / 86_400_000)
      const hour = clock(d)
      if (diff === 0) return `${words.today} ${hour}`
      if (diff === 1) return `${words.yesterday} ${hour}`
      return `${short.format(d).replace('.', '')} ${hour}`
    },
    fileSize: (bytes) => {
      if (bytes === undefined) return ''
      if (bytes < 1024) return `${bytes} B`
      if (bytes < 1024 * 1024) return `${number.format(Math.round(bytes / 1024))} KB`
      return `${number.format(bytes / 1024 / 1024)} MB`
    },
  }
}
