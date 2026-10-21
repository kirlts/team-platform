import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import { createFormats, DEFAULT_LANGUAGE, translate, type Formats, type Language, type Message, type Vars } from './core'
import { en } from './en'
import { es419 } from './es-419'
import type { MessageKey } from './es-419'

export type { Language, MessageKey, Vars }
export { LANGUAGES, detectLanguage, isLanguage } from './core'

const CATALOGS: Record<Language, Record<string, Message>> = { 'es-419': es419, en }

interface I18n {
  language: Language
  t: (key: MessageKey, vars?: Vars) => string
  /** Whether the catalog has this key; for keys built at run time, such as `error.<code>`. */
  has: (key: string) => boolean
  format: Formats
}

const I18nContext = createContext<I18n | null>(null)

/** The language of the panel. It comes from the account (`me.language`); changing it re-renders every string at once. */
export function I18nProvider({ language, children }: { language: Language; children: ReactNode }) {
  const t = useCallback((key: MessageKey, vars?: Vars) => translate(CATALOGS[language], language, key, vars), [language])
  const has = useCallback((key: string) => key in CATALOGS[language], [language])
  const value = useMemo<I18n>(
    () => ({ language, t, has, format: createFormats(language, { today: t('time.today'), yesterday: t('time.yesterday') }) }),
    [language, t, has],
  )
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18n {
  const value = useContext(I18nContext)
  if (!value) throw new Error('useI18n needs an I18nProvider above it')
  return value
}

/** `const t = useT()`; then `t('nav.home')` or `t('messages.count', { n: 3 })`. */
export function useT() {
  return useI18n().t
}

/** Date, time and size formats in the language of the account. */
export function useFormat(): Formats {
  return useI18n().format
}

export { DEFAULT_LANGUAGE }

/** The text of any error for a person: the translation of its API code, else the server's message, else a generic line. */
export function useErrorText(): (err: unknown) => string {
  const { t, has } = useI18n()
  return useCallback(
    (err: unknown) => {
      const code = typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: unknown }).code) : ''
      if (code && has(`error.${code}`)) return t(`error.${code}` as MessageKey)
      const message = err instanceof Error ? err.message : ''
      return message || t('error.generic')
    },
    [t, has],
  )
}
