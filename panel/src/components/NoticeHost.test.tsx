// A notice that names its control is drawn next to it from 1024 px, and at the bottom below that (DISENO.md, «Avisos de la pantalla»).
import { act, cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { NoticeProvider, useNotices } from '@/lib/notices'
import { NoticeHost } from './NoticeHost'

afterEach(cleanup)

function Show({ near }: { near?: () => Element | null }) {
  const notices = useNotices()
  return <button onClick={() => notices.show({ text: 'Ana sale de Para', ...(near ? { near } : {}) })}>show</button>
}

function mount(wide: boolean, near?: () => Element | null) {
  Object.assign(window, { matchMedia: () => ({ matches: wide, addEventListener: () => {}, removeEventListener: () => {} }) })
  render(
    <MemoryRouter>
      <NoticeProvider>
        <Show near={near} />
        <NoticeHost />
      </NoticeProvider>
    </MemoryRouter>,
  )
  return act(async () => screen.getByText('show').click())
}

const control = () => ({ getBoundingClientRect: () => ({ top: 400, bottom: 440, right: 1300, left: 1100, width: 200, height: 40, x: 1100, y: 400 }) }) as unknown as Element

describe('a notice next to its control', () => {
  it('from 1024 px sits above the control, aligned to its right edge', async () => {
    await mount(true, control)
    const host = screen.getByRole('status').parentElement as HTMLElement
    expect(host.style.right).toBe(`${window.innerWidth - 1300}px`)
    expect(host.style.bottom).toBe(`${window.innerHeight - 400 + 8}px`)
  })

  it('below 1024 px it keeps its place at the bottom', async () => {
    await mount(false, control)
    const host = screen.getByRole('status').parentElement as HTMLElement
    expect(host.style.right).toBe('')
    expect(host.className).toContain('bottom-4')
  })

  it('without a control it stays in the top bar from 1024 px', async () => {
    await mount(true)
    expect((screen.getByRole('status').parentElement as HTMLElement).className).toContain('lg:top-1.5')
  })
})
