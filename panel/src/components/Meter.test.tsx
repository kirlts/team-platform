// J1-B-06: a bar at 0 must not show a figure that is not there. It travels (no `aria-valuenow`) until a step reports.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Meter } from './Meter'

afterEach(cleanup)

describe('Meter', () => {
  it('sin avance real es indeterminada: sin valor y con la marca de trabajo en curso', () => {
    render(<Meter percent={0} label="Progreso" />)
    const bar = screen.getByRole('progressbar', { name: 'Progreso' })
    expect(bar.hasAttribute('aria-valuenow')).toBe(false)
    expect(bar.hasAttribute('data-indeterminate')).toBe(true)
    expect(bar.querySelector('.meter-fill')).toBeNull()
  })

  it('con un paso terminado muestra la cifra real', () => {
    render(<Meter percent={34} label="Progreso" />)
    const bar = screen.getByRole('progressbar', { name: 'Progreso' })
    expect(bar.getAttribute('aria-valuenow')).toBe('34')
    expect(bar.hasAttribute('data-indeterminate')).toBe(false)
    expect((bar.querySelector('.meter-fill') as HTMLElement).style.width).toBe('34%')
  })
})
