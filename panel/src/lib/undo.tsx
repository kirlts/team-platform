import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useT } from '@/i18n'
import { useNotices } from './notices'

/** One thing a person did that can be taken back: how to undo it and how to do it again. */
export interface UndoOp {
  /** Short description for the tooltip of the buttons. */
  label: string
  undo: () => unknown | Promise<unknown>
  redo: () => unknown | Promise<unknown>
}

export interface UndoStack {
  /**
   * Runs `redo` (the change) and, if it succeeds, records the operation; a new operation clears what could be redone.
   * With `announce` the strip under the header says what happened and carries Deshacer, so a change that is not
   * written anywhere else on the screen (closing, deactivating, replacing) is confirmed where the person looks (J2-A-18).
   */
  run: (op: UndoOp, options?: { announce?: string | ((result: unknown) => string) }) => Promise<void>
  undo: () => Promise<void>
  redo: () => Promise<void>
  undoCount: number
  redoCount: number
  /** Label of the next operation to undo and to redo, if any. */
  undoLabel: string | undefined
  redoLabel: string | undefined
  /** An undo or redo is in flight. */
  busy: boolean
  /** Forgets both lists: what they would restore no longer exists (the proposal was replaced by a new analysis). */
  clear: () => void
}

/**
 * The pure core of the stack, without React: two lists and the rules between them. Kept apart so
 * it can be tested on its own. Memory only: nothing here is persisted and a reload empties it.
 */
export function createUndoCore() {
  const past: UndoOp[] = []
  const future: UndoOp[] = []
  return {
    past,
    future,
    async run(op: UndoOp) {
      const result = await op.redo()
      past.push(op)
      future.length = 0
      return result
    },
    async undo() {
      const op = past[past.length - 1]
      if (!op) return
      await op.undo()
      past.pop()
      future.push(op)
    },
    async redo() {
      const op = future[future.length - 1]
      if (!op) return
      await op.redo()
      future.pop()
      past.push(op)
    },
  }
}

/** One stack per screen. Ctrl+Z and Ctrl+Shift+Z (or Ctrl+Y) work anywhere except inside a text field, which keeps its own. */
export function useUndoStack(): UndoStack {
  const core = useRef(createUndoCore()).current
  const t = useT()
  const notices = useNotices()
  const [, setVersion] = useState(0)
  const [busy, setBusy] = useState(false)
  const bump = useCallback(() => setVersion((v) => v + 1), [])

  const guarded = useCallback(
    async (fn: () => Promise<void>) => {
      setBusy(true)
      try {
        await fn()
      } finally {
        setBusy(false)
        bump()
      }
    },
    [bump],
  )

  const latest = useRef<UndoStack | null>(null)

  const stack = useMemo<UndoStack>(
    () => ({
      run: (op, options) =>
        guarded(async () => {
          const result = await core.run(op)
          const text = typeof options?.announce === 'function' ? options.announce(result) : options?.announce
          if (text) notices.show({ text, action: { label: t('undo.undo'), run: () => latest.current?.undo() } })
        }),
      // Said after the fact, in words, so a person who undoes knows what came back (J1-B-16).
      undo: () =>
        guarded(async () => {
          const label = core.past[core.past.length - 1]?.label
          await core.undo()
          if (label) notices.show({ text: t('undo.done', { label }) })
        }),
      redo: () =>
        guarded(async () => {
          const label = core.future[core.future.length - 1]?.label
          await core.redo()
          if (label) notices.show({ text: t('undo.redone', { label }) })
        }),
      undoCount: core.past.length,
      redoCount: core.future.length,
      undoLabel: core.past[core.past.length - 1]?.label,
      redoLabel: core.future[core.future.length - 1]?.label,
      busy,
      clear: () => {
        core.past.length = 0
        core.future.length = 0
        bump()
      },
    }),
    // The counts are read from the lists on every render; `version` is what changes them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [core, guarded, bump, busy, core.past.length, core.future.length, notices, t],
  )

  latest.current = stack
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const key = e.key.toLowerCase()
      const wantsRedo = (key === 'z' && e.shiftKey) || key === 'y'
      const wantsUndo = key === 'z' && !e.shiftKey
      if (!wantsRedo && !wantsUndo) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      e.preventDefault()
      const current = latest.current
      if (!current || current.busy) return
      void (wantsRedo ? current.redo() : current.undo())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return stack
}

const UndoContext = createContext<UndoStack | null>(null)

/** Gives the screen's stack to every component under it, so an editor deep in the tree can record its change. */
export function UndoProvider({ stack, children }: { stack: UndoStack; children: ReactNode }) {
  return <UndoContext.Provider value={stack}>{children}</UndoContext.Provider>
}

/** The stack of the screen this component is in; throws outside a screen that provides one. */
export function useUndo(): UndoStack {
  const stack = useContext(UndoContext)
  if (!stack) throw new Error('useUndo needs an UndoProvider above it')
  return stack
}

/** The stack if the screen has one; components that also live on screens without editing use this. */
export function useOptionalUndo(): UndoStack | null {
  return useContext(UndoContext)
}
