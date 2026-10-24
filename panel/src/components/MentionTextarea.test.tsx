// UD-275: «@» opens the list of members, filtered by what is typed, driven by the keyboard; picking leaves the token in the text and the member in the
// picked list; the highlight of a token in a reply comes from the ids, not from reading the text.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { I18nProvider } from '@/i18n'
import { activeMentions, insertMention, matchMembers, mentionQuery, splitMentions } from '@/lib/mention'
import type { Member } from '@team-platform/client'
import { MentionTextarea } from './MentionTextarea'

beforeAll(() => {
  Object.assign(window, { matchMedia: () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }) })
  Object.assign(Element.prototype, { hasPointerCapture: () => false, setPointerCapture: () => {}, releasePointerCapture: () => {}, scrollIntoView: () => {} })
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never
})
afterEach(cleanup)

const members = [
  { id: '2', name: 'Ana Pérez', email: 'a@x.org', role: 'member', kind: 'person', active: true },
  { id: '3', name: 'Claude', email: 'c@x.org', role: 'member', kind: 'agent', active: true },
  { id: '5', name: 'Carla', email: 'ca@x.org', role: 'member', kind: 'person', active: true },
] as Member[]

function Field({ onState }: { onState?: (s: { text: string; picked: Member[] }) => void }) {
  const [text, setText] = useState('')
  const [picked, setPicked] = useState<Member[]>([])
  onState?.({ text, picked })
  return (
    <I18nProvider language="es-419">
      <MentionTextarea aria-label="Respuesta" value={text} onChange={setText} candidates={members} picked={picked} onPick={setPicked} />
    </I18nProvider>
  )
}
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value, selectionStart: value.length, selectionEnd: value.length } })
const names = () => screen.queryAllByRole('option').map((o) => o.querySelector('[data-mention-name]')?.textContent)

describe('the helpers of «@»', () => {
  it('finds the word being typed only when it starts with «@» at the beginning or after a space', () => {
    expect(mentionQuery('hola @Cl', 8)).toEqual({ start: 5, query: 'Cl' })
    expect(mentionQuery('@', 1)).toEqual({ start: 0, query: '' })
    expect(mentionQuery('correo a@b.org', 14)).toBeNull()
    expect(mentionQuery('hola @Claude ya', 15)).toBeNull()
  })
  it('filters by name without caring for case or accents, and replaces the word with the token', () => {
    expect(matchMembers(members, 'perez').map((m) => m.name)).toEqual(['Ana Pérez'])
    expect(matchMembers(members, 'C').map((m) => m.name)).toEqual(['Claude', 'Carla'])
    expect(insertMention('hola @Cl y más', 5, 8, 'Claude')).toEqual({ text: 'hola @Claude  y más', caret: 13 })
  })
  it('a token the person erased drops its mention, and the highlight follows the picked names', () => {
    expect(activeMentions('hola @Claude', members).map((m) => m.name)).toEqual(['Claude'])
    expect(splitMentions('hola @Claude, ¿ves?', ['Claude'])).toEqual([{ text: 'hola ', mention: false }, { text: '@Claude', mention: true }, { text: ', ¿ves?', mention: false }])
    expect(splitMentions('sin nadie', [])).toEqual([{ text: 'sin nadie', mention: false }])
  })
})

describe('the field with «@»', () => {
  it('opens on «@», filters while typing and closes when the word is no longer a mention', () => {
    render(<Field />)
    const field = screen.getByRole('combobox', { name: 'Respuesta' })
    type(field, 'hola ')
    expect(names()).toEqual([])
    type(field, 'hola @')
    expect(names()).toEqual(['Ana Pérez', 'Claude', 'Carla'])
    type(field, 'hola @cla')
    expect(names()).toEqual(['Claude'])
    type(field, 'hola @zzz')
    expect(screen.getByText('Sin coincidencias')).toBeTruthy()
    type(field, 'hola @cla ya')
    expect(names()).toEqual([])
  })

  it('arrows move, Enter picks: the token is in the text, the member is picked and the list closes', () => {
    let state: { text: string; picked: Member[] } = { text: '', picked: [] }
    render(<Field onState={(s) => (state = s)} />)
    const field = screen.getByRole('combobox', { name: 'Respuesta' })
    type(field, '@c')
    expect(screen.getAllByRole('option').map((o) => o.getAttribute('aria-selected'))).toEqual(['true', 'false'])
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    expect(screen.getAllByRole('option').map((o) => o.getAttribute('aria-selected'))).toEqual(['false', 'true'])
    fireEvent.keyDown(field, { key: 'ArrowDown' }) // wraps
    fireEvent.keyDown(field, { key: 'ArrowUp' })
    expect(field.getAttribute('aria-activedescendant')).toMatch(/-1$/)
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(state.text).toBe('@Carla ')
    expect(state.picked.map((m) => m.id)).toEqual(['5'])
    expect(names()).toEqual([])
  })

  it('Escape closes the list without picking, and the text stays', () => {
    let state: { text: string; picked: Member[] } = { text: '', picked: [] }
    render(<Field onState={(s) => (state = s)} />)
    const field = screen.getByRole('combobox', { name: 'Respuesta' })
    type(field, '@a')
    expect(names().length).toBe(3)
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(names()).toEqual([])
    expect(state.text).toBe('@a')
    expect(state.picked).toEqual([])
  })

  it('a touch on a name picks it (pointer down) and the member stays picked', () => {
    let state: { text: string; picked: Member[] } = { text: '', picked: [] }
    render(<Field onState={(s) => (state = s)} />)
    const field = screen.getByRole('combobox', { name: 'Respuesta' })
    type(field, 'hola @')
    fireEvent.pointerDown(screen.getByRole('option', { name: /Claude/ }).querySelector('button')!)
    expect(state.text).toBe('hola @Claude ')
    expect(state.picked.map((m) => m.name)).toEqual(['Claude'])
  })
})
