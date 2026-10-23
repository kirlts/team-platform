// The mark appears only for a proposal the example server marked as simulated; against the real API (which never sends the field) nothing is drawn.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'
import { I18nProvider } from '@/i18n'
import type { Proposal } from '@team-platform/client'
import { SimulatedMark } from './SimulatedMark'

afterEach(cleanup)

const wrap = (node: ReactNode) => render(<I18nProvider language="es-419">{node}</I18nProvider>)
const proposal = (extra: Partial<Proposal>): Proposal => ({ messages: [], discarded: [], ...extra })

describe('SimulatedMark', () => {
  it('says «Servidor de ejemplo» for a simulated proposal', () => {
    wrap(<SimulatedMark proposal={proposal({ simulated: true })} />)
    expect(screen.getByText('Servidor de ejemplo')).toBeTruthy()
  })
  it('draws nothing for a proposal without the field, as the real API sends it, or without a proposal', () => {
    const first = wrap(<SimulatedMark proposal={proposal({})} />)
    expect(first.container.textContent).toBe('')
    first.unmount()
    const second = wrap(<SimulatedMark proposal={null} />)
    expect(second.container.textContent).toBe('')
  })
})
