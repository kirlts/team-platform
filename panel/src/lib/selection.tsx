import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

/**
 * The rows a person marked in a list, to delete them at once (UD-253). Memory only, one per list: it is emptied by Cancelar,
 * by Escape, and after Borrar. `canMark` says which rows carry a check box: only what this person may delete.
 */
export interface Selection {
  marked: ReadonlySet<string>
  isMarked: (id: string) => boolean
  toggle: (id: string, on: boolean) => void
  /** Adds these rows to what is marked (the mark-all button: the rows of the page). */
  add: (ids: readonly string[]) => void
  clear: () => void
}

export function useSelection(): Selection {
  const [marked, setMarked] = useState<ReadonlySet<string>>(() => new Set())
  const toggle = useCallback(
    (id: string, on: boolean) =>
      setMarked((prev) => {
        const next = new Set(prev)
        if (on) next.add(id)
        else next.delete(id)
        return next
      }),
    [],
  )
  const add = useCallback((ids: readonly string[]) => setMarked((prev) => new Set([...prev, ...ids])), [])
  const clear = useCallback(() => setMarked((prev) => (prev.size ? new Set() : prev)), [])

  // Escape empties the selection, unless something above the list (a dialog, a field) took the key first.
  const any = marked.size > 0
  useEffect(() => {
    if (!any) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) && target.getAttribute('role') !== 'checkbox') return
      clear()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [any, clear])

  return useMemo(() => ({ marked, isMarked: (id: string) => marked.has(id), toggle, add, clear }), [marked, toggle, add, clear])
}

/** The selection of the list a row is in, with the rule of which rows may be marked. Rows outside a selectable list get `null`. */
export interface SelectionScope extends Selection {
  canMark: (id: string) => boolean
}

const SelectionContext = createContext<SelectionScope | null>(null)

export function SelectionProvider({ scope, children }: { scope: SelectionScope; children: ReactNode }) {
  return <SelectionContext.Provider value={scope}>{children}</SelectionContext.Provider>
}

export function useSelectionScope(): SelectionScope | null {
  return useContext(SelectionContext)
}
