import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Markdown, parseBlocks } from './markdown'

describe('parseBlocks', () => {
  it('reads headings, paragraphs, lists, quotes, code and rules', () => {
    const blocks = parseBlocks('# Título\n\nUna línea\ny otra.\n\n- uno\n- dos\n\n1. a\n2. b\n\n> cita\n\n```\ncódigo\n```\n\n---')
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'list', 'list', 'quote', 'code', 'rule'])
    expect(blocks[1]).toEqual({ type: 'paragraph', text: 'Una línea y otra.' })
    expect(blocks[3]).toEqual({ type: 'list', ordered: true, items: ['a', 'b'] })
  })
})

describe('parseBlocks with breaks', () => {
  it('keeps the line breaks of a paragraph written line by line', () => {
    expect(parseBlocks('**Antes**: a.\n**Después**: b.', { breaks: true })[0]).toEqual({ type: 'paragraph', text: '**Antes**: a.\n**Después**: b.' })
    const html = renderToStaticMarkup(<Markdown breaks source={'**Antes**: a.\n**Después**: b.'} />)
    expect(html).toContain('whitespace-pre-line')
    expect(html).toContain('<strong>Antes</strong>')
  })
})

describe('Markdown', () => {
  it('renders inline spans and keeps only safe links', () => {
    const html = renderToStaticMarkup(<Markdown source={'Texto **fuerte**, *énfasis*, `código` y [sitio](https://example.com) o [malo](javascript:alert(1)).'} />)
    expect(html).toContain('<strong>fuerte</strong>')
    expect(html).toContain('<em>énfasis</em>')
    expect(html).toContain('>código</code>')
    expect(html).toContain('href="https://example.com"')
    expect(html).not.toContain('href="javascript')
    expect(html).toContain('[malo](javascript:alert(1))')
  })

  it('never turns the source into markup', () => {
    const html = renderToStaticMarkup(<Markdown source={'<script>alert(1)</script> y <img src=x onerror=alert(1)>'} />)
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;script&gt;')
  })

  it('puts paragraphs and list items in the shared prose class', () => {
    const html = renderToStaticMarkup(<Markdown source={'Párrafo.\n\n- ítem'} />)
    expect(html.match(/prose-block/g)?.length).toBe(2)
  })
})
