// The second block of a screen that is waiting keeps its bars and does not say «Cargando» again.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { I18nProvider } from '@/i18n'
import { LoadState } from './LoadState'

afterEach(cleanup)
const waiting = { isPending: true, isError: false, error: null, failureCount: 0, refetch: () => {} }

describe('LoadState', () => {
  it('says «Cargando» once, in the first block; the quiet one is only bars and is hidden from assistive technology', () => {
    render(<I18nProvider language="es-419"><LoadState query={waiting} /><LoadState query={waiting} rows={2} quiet /></I18nProvider>)
    expect(screen.getAllByText('Cargando')).toHaveLength(1)
    expect(screen.getAllByRole('status')).toHaveLength(1)
  })
})
