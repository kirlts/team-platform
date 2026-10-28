// J3-D3-01: on a phone the brand is one line («[Nombre] TEAM» does not break in two); the name of the instance is the part that gives way.
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Wordmark } from './Wordmark'

afterEach(cleanup)

describe('Wordmark', () => {
  it('on a phone the text is one line, TEAM does not shrink and only the name of the instance can be cut with an ellipsis', () => {
    const { container } = render(<Wordmark project="Desarrollo" name="Team" />)
    const text = container.querySelector('.wordmark > span:last-child') as HTMLElement
    expect(text.className).toContain('max-md:whitespace-nowrap')
    expect(text.className).toContain('max-md:flex')
    const project = container.querySelector('.wordmark-project') as HTMLElement
    expect(project.className).toContain('max-md:truncate')
    expect(project.className).toContain('max-md:min-w-0')
    expect((text.lastElementChild as HTMLElement).className).toContain('max-md:shrink-0')
    expect(text.textContent).toBe('Desarrollo Team')
  })

  it('a phone has no tracking (measured: half of the tracking of the host did not fit at 360 px)', () => {
    const { container } = render(<Wordmark name="Team" />)
    expect((container.firstElementChild as HTMLElement).className).toContain('max-md:tracking-normal')
  })
})
