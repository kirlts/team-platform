// H-3723: the template editor shows «Salida» under «Campos» with the same rows, the type of each entry and the two fixed
// entries; each change is saved as the whole file, and a file the server refuses shows the server's reason in place.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/i18n'
import { buildTemplate, parseTemplateFields, parseTemplateOutput } from '@/lib/template'
import { TemplateContentEditor } from './TemplateEditor'

const FILE = `---
name: Reporte de error
description: Algo que no funciona.
fields:
  - { name: steps, label: Pasos para reproducir, required: true }
output:
  - { name: cause, label: Causa, type: text, required: true }
  - { name: effort, label: "Esfuerzo, estimado", type: text, required: false, enum: [bajo, "medio, alto"] }
  - { name: files, label: Archivos, type: list, required: false }
---
## Método
Leer el input.
`

afterEach(() => cleanup())

const show = (markdown: string, onSave: (next: string) => Promise<unknown>) =>
  render(
    <I18nProvider language="es-419">
      <TemplateContentEditor name="Reporte de error" description="Algo que no funciona." markdown={markdown} onSave={onSave} />
    </I18nProvider>,
  )

describe('template output in the panel', () => {
  it('reads the output block, enum included, and writes it back unchanged', () => {
    const output = parseTemplateOutput(FILE)
    expect(output).toEqual([
      { name: 'cause', label: 'Causa', type: 'text', required: true },
      { name: 'effort', label: 'Esfuerzo, estimado', type: 'text', required: false, enum: ['bajo', 'medio, alto'] },
      { name: 'files', label: 'Archivos', type: 'list', required: false },
    ])
    const again = buildTemplate({ name: 'x', description: 'y', fields: parseTemplateFields(FILE), output, instructions: 'z' })
    expect(parseTemplateOutput(again)).toEqual(output)
    expect(parseTemplateOutput('---\nname: x\n---\ncuerpo')).toBeNull()
    expect(buildTemplate({ name: 'x', description: 'y', fields: [], instructions: 'z' })).not.toContain('output')
  })

  it('shows «Salida» after «Campos», each entry with its type and the fixed «Resultado» and «Resumen»', () => {
    show(FILE, async () => undefined)
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(headings.indexOf('Salida')).toBe(headings.indexOf('Campos') + 1)
    const section = screen.getByRole('region', { name: 'Salida' })
    expect(within(section).getByText('Causa')).toBeTruthy()
    expect(within(section).getByText('bajo · medio, alto')).toBeTruthy()
    expect((within(section).getByRole('combobox', { name: 'Tipo de Archivos' }) as HTMLSelectElement).value).toBe('list')
    expect(within(section).getByText('Resultado')).toBeTruthy()
    expect(within(section).getByText('Resumen')).toBeTruthy()
    expect(within(section).queryByRole('button', { name: /Quitar el campo de salida (Resumen|Resultado)/ })).toBeNull()
  })

  it('a template with no output says «Sin salida» and adding an entry declares the block', async () => {
    const saved: string[] = []
    show(FILE.replace(/output:\n(?: {2}- .*\n)+/, ''), async (next) => void saved.push(next))
    const section = screen.getByRole('region', { name: 'Salida' })
    expect(within(section).getByText('Sin salida')).toBeTruthy()
    fireEvent.click(within(section).getByRole('button', { name: 'Campo de salida' }))
    await waitFor(() => expect(saved).toHaveLength(1))
    expect(parseTemplateOutput(saved[0])).toEqual([{ name: 'dato_nuevo', label: 'Dato nuevo', type: 'text', required: false }])
    expect(parseTemplateFields(saved[0])).toEqual(parseTemplateFields(FILE))
  })

  it('changing the type, the required mark or removing an entry saves the whole file', async () => {
    const saved: string[] = []
    show(FILE, async (next) => void saved.push(next))
    const section = screen.getByRole('region', { name: 'Salida' })
    fireEvent.change(within(section).getByRole('combobox', { name: 'Tipo de Esfuerzo, estimado' }), { target: { value: 'list' } })
    await waitFor(() => expect(saved).toHaveLength(1))
    expect(parseTemplateOutput(saved[0])?.[1]).toEqual({ name: 'effort', label: 'Esfuerzo, estimado', type: 'list', required: false })
    fireEvent.click(within(section).getByRole('button', { name: 'Quitar el campo de salida Archivos' }))
    await waitFor(() => expect(saved).toHaveLength(2))
    expect(parseTemplateOutput(saved[1])?.map((o) => o.name)).toEqual(['cause', 'effort'])
  })

  it('a file the server refuses shows its reason in place', async () => {
    const onSave = vi.fn(async () => {
      throw Object.assign(new Error('output[0].name «summary» es un campo fijo de toda salida y no se declara'), { code: 'template_invalid' })
    })
    show(FILE, onSave)
    fireEvent.click(within(screen.getByRole('region', { name: 'Salida' })).getByRole('button', { name: 'Campo de salida' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/campo fijo/)
  })
})
