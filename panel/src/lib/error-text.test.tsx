import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { I18nProvider, useErrorText, type Language } from '@/i18n'
import { TeamApiError } from '@team-platform/client'

// H-44: the server's sentence for a code is never what a person reads; the catalog of the account's language is.
function textOf(language: Language, error: unknown) {
  const wrapper = ({ children }: { children: ReactNode }) => <I18nProvider language={language}>{children}</I18nProvider>
  return renderHook(() => useErrorText(), { wrapper }).result.current(error)
}

describe('useErrorText', () => {
  const rejected = new TeamApiError(422, 'Unknown text provider «x» in TEXT_PROVIDER', 'provider_invalid')

  it('translates the code of a rejected provider in both languages, never the server sentence', () => {
    expect(textOf('es-419', rejected)).toBe('El proveedor o el modelo no es válido')
    expect(textOf('en', rejected)).toBe('The provider or the model is not valid')
  })

  it('falls back to the server message only for a code the catalog does not know', () => {
    expect(textOf('en', new TeamApiError(500, 'something new', 'brand_new_code'))).toBe('something new')
  })
})
