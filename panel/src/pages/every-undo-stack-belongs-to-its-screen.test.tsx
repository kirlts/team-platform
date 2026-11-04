// TP-12 (soft-locks 2026-11-04). The undo stack belongs to what is on screen: React Router keeps the element of a route when only `:id` changes, so the stack
// of message 10 (and the global Ctrl+Z) used to follow the person to message 11 and revert the title of the one left behind.
// Fails on the tree before the change: `messages/:id` rendered `<MessageDetail />` with no key, so the sheet mounted once for both ids.
import { act, cleanup, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { MemoryRouter, Route, Routes, useNavigate, useParams } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const mounts: string[] = []
vi.mock('./MessageDetail', () => ({
  // A stand-in for the sheet that owns a stack: it counts how many times it is mounted, as the real one creates its `useUndoStack` on each mount.
  MessageDetail: function MessageDetail() {
    const { id } = useParams()
    useEffect(() => {
      mounts.push(id ?? '')
    }, []) // eslint-disable-line react-hooks/exhaustive-deps
    return <p>sheet {id}</p>
  },
}))

import { MessageDetailRoute } from './MessageDetailRoute'

afterEach(() => {
  cleanup()
  mounts.length = 0
})

let go: (to: string) => void = () => {}
function Nav() {
  go = useNavigate()
  return null
}

describe('each message has its own sheet, and so its own undo stack', () => {
  it('goes from message 10 to message 11 with a new mount of the sheet', () => {
    render(
      <MemoryRouter initialEntries={['/messages/10']}>
        <Nav />
        <Routes>
          <Route path="messages/:id" element={<MessageDetailRoute />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByText('sheet 10')).toBeTruthy()
    act(() => go('/messages/11'))
    expect(screen.getByText('sheet 11')).toBeTruthy()
    expect(mounts).toEqual(['10', '11'])
  })

  it('the app routes messages/:id through the keyed element and nowhere else renders the sheet', () => {
    const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')
    expect(app).toMatch(/path="messages\/:id" element=\{<MessageDetailRoute \/>\}/)
    expect(app).not.toMatch(/<MessageDetail \/>/)
  })
})
