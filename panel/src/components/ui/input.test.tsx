// J3-D3-02: the field is 44 px tall on a phone (the height of a finger) and keeps its 40 px from 768 px.
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Input } from './input'

afterEach(cleanup)

describe('Input', () => {
  it('is h-10 on a pointer and h-11 below 768 px', () => {
    const { container } = render(<Input aria-label="x" />)
    const cls = (container.firstElementChild as HTMLElement).className
    expect(cls).toContain('h-10')
    expect(cls).toContain('max-md:h-11')
  })
})
