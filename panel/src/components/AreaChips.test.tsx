// H-900: the fold behind «+N» must be measured again whenever its measure is dropped, whatever order React runs the effects in.
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'
import { I18nProvider } from '@/i18n'
import { AreaChips } from './AreaChips'

const wrapper = ({ children }: { children: ReactNode }) => <I18nProvider language="es-419">{children}</I18nProvider>

/** jsdom has no layout: a chip counts as wrapped to a second row from the fourth on (offsetTop), and the row has a width. */
const FIT = 3
let width = 300
const originals: Record<string, PropertyDescriptor | undefined> = {}

beforeEach(() => {
  originals.offsetTop = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetTop')
  originals.clientWidth = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth')
  Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
    configurable: true,
    get(this: HTMLElement) {
      const index = [...(this.parentElement?.children ?? [])].indexOf(this)
      return index >= FIT ? 30 : 0
    },
  })
  Object.defineProperty(Element.prototype, 'clientWidth', { configurable: true, get: () => width })
})

afterEach(() => {
  cleanup()
  for (const [key, descriptor] of Object.entries(originals)) {
    const target = key === 'offsetTop' ? HTMLElement.prototype : Element.prototype
    if (descriptor) Object.defineProperty(target, key, descriptor)
    else delete (target as unknown as Record<string, unknown>)[key]
  }
})

const chips = (n: number) => Array.from({ length: n }, (_, i) => <span key={i}>área {i}</span>)

describe('AreaChips', () => {
  it('after mounting, it folds what does not fit and shows the button', () => {
    render(<AreaChips chips={chips(6)} />, { wrapper })
    expect(screen.getAllByText(/^área \d$/)).toHaveLength(FIT)
    const button = screen.getByRole('button', { name: /más/ })
    expect(button.className).not.toMatch(/invisible/)
    expect(button.textContent).toBe('+3')
  })

  it('when the list changes size it measures again and settles', () => {
    const view = render(<AreaChips chips={chips(6)} />, { wrapper })
    view.rerender(<AreaChips chips={chips(8)} />)
    expect(screen.getAllByText(/^área \d$/)).toHaveLength(FIT)
    expect(screen.getByRole('button', { name: /más/ }).textContent).toBe('+5')
  })

  it('when the same list is drawn again with the same props, the measure stays and the button is not stuck hidden', async () => {
    const list = chips(6)
    const view = render(<AreaChips chips={list} />, { wrapper })
    await act(async () => {
      await Promise.resolve()
    })
    view.rerender(<AreaChips chips={list} />)
    expect(screen.getByRole('button', { name: /más/ }).className).not.toMatch(/invisible/)
  })

  it('when the row changes width after settling, it measures again and settles on the new count', () => {
    let notify: () => void = () => {}
    class FakeObserver {
      constructor(callback: () => void) {
        notify = callback
      }
      observe() {}
      disconnect() {}
    }
    const real = globalThis.ResizeObserver
    globalThis.ResizeObserver = FakeObserver as unknown as typeof ResizeObserver
    try {
      render(<AreaChips chips={chips(6)} />, { wrapper })
      act(() => notify())
      expect(screen.getAllByText(/^área \d$/)).toHaveLength(FIT)
      width = 180
      act(() => notify())
      expect(screen.getAllByText(/^área \d$/)).toHaveLength(FIT)
      expect(screen.getByRole('button', { name: /más/ }).className).not.toMatch(/invisible/)
    } finally {
      globalThis.ResizeObserver = real
    }
  })
})
