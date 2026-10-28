// J1-B-06: a bar at 0 must not show a figure that is not there. It travels (no `aria-valuenow`) until a step reports.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Meter } from './Meter'

afterEach(cleanup)

describe('Meter', () => {
  it('without real progress it is indeterminate: no value and with the work-in-progress mark', () => {
    render(<Meter percent={0} label="Progreso" />)
    const bar = screen.getByRole('progressbar', { name: 'Progreso' })
    expect(bar.hasAttribute('aria-valuenow')).toBe(false)
    expect(bar.hasAttribute('data-indeterminate')).toBe(true)
    expect(bar.querySelector('.meter-fill')).toBeNull()
  })

  it('with a finished step it shows the real figure', () => {
    render(<Meter percent={34} label="Progreso" />)
    const bar = screen.getByRole('progressbar', { name: 'Progreso' })
    expect(bar.getAttribute('aria-valuenow')).toBe('34')
    expect(bar.hasAttribute('data-indeterminate')).toBe(false)
    expect((bar.querySelector('.meter-fill') as HTMLElement).style.width).toBe('34%')
  })

  // The fill and the glint measure 100 % of the bar: without a height of its own it was two pixels of border (B7, in AgentWork, ReviewPending and RetryExecute).
  it('has a height of its own, so no use can leave it as a line; a use may replace it', () => {
    render(<><Meter percent={0} label="A" /><Meter percent={40} label="B" /><Meter percent={40} label="C" className="h-1" /></>)
    expect(screen.getByRole('progressbar', { name: 'A' }).className).toContain('h-2.5')
    expect(screen.getByRole('progressbar', { name: 'B' }).className).toContain('h-2.5')
    const own = screen.getByRole('progressbar', { name: 'C' }).className
    expect(own).toContain('h-1')
    expect(own).not.toContain('h-2.5')
  })

  // DISENO.md, «Trabajo de un agente»: the bar of a row is thin; one that ended is still (no glint) and one that failed is danger; a decorative bar is not a progress bar.
  it('the thin bar is 6 px, a bar of a stretch that ended is still and decorative, and a failed one takes danger', () => {
    render(<><Meter thin percent={30} label="Corre" /><Meter thin decorative still percent={100} label="Terminó" /><Meter thin decorative still danger percent={100} label="Falló" /></>)
    const running = screen.getByRole('progressbar', { name: 'Corre' })
    expect(running.className).toContain('h-1.5')
    expect(running.className).not.toContain('h-2.5')
    expect(running.className).not.toContain('meter-still')
    expect(screen.queryByRole('progressbar', { name: 'Terminó' })).toBeNull()
    const [done, failed] = [...document.querySelectorAll('[aria-hidden].meter')] as HTMLElement[]
    expect(done!.className).toContain('meter-still')
    expect(done!.className).not.toContain('meter-danger')
    expect(failed!.className).toContain('meter-danger')
  })
})
