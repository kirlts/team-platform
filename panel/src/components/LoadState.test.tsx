// J3-D3-03: the waiting rows of a list keep the place of its rows, with the height of the same row (`--spacing-card-row`), not a figure of their own.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { I18nProvider } from '@/i18n'
import { LoadState } from './LoadState'

afterEach(cleanup)

const waiting = { isPending: true, isError: false, error: null, failureCount: 0, refetch: () => undefined }

const draw = (tall: boolean) =>
  render(
    <I18nProvider language="es-419">
      <LoadState query={waiting} rows={4} tall={tall} />
    </I18nProvider>,
  )

describe('LoadState', () => {
  it('a tall waiting row takes the height token of a row of Mensajes, and a plain one keeps its own', () => {
    draw(true)
    const rows = screen.getAllByTestId('load-row')
    expect(rows).toHaveLength(4)
    for (const r of rows) expect(r.className).toContain('h-card-row')
    cleanup()
    draw(false)
    for (const r of screen.getAllByTestId('load-row')) expect(r.className).not.toContain('h-card-row')
  })

  it('the token that gives the height exists in the stylesheet next to the one of the text block', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8')
    expect(css).toMatch(/--spacing-card-row:\s*\d+px/)
    expect(css).toMatch(/--spacing-card-text:\s*\d+px/)
  })
})
