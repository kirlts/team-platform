import { useCallback } from 'react'
import { useSearchParams } from 'react-router'

/**
 * What orders the navigation lives in the URL or in the history of the browser, not in component state (TP-14, TP-18).
 *
 * The policy of the history (decided with soft-locks 2026-11-04, `docs/USER-DECISIONS.md`):
 *   - REPLACE the entry: the search, a filter, a state tab, an order. They refine one view; Atrás leaves the view and does not walk through the
 *     refinements (`Messages.tsx`, `AreaView.tsx`).
 *   - PUSH an entry: the page of a list, a window with an identity of its own (`?v=`), opening a record and changing the route. Atrás
 *     goes back to the previous page, closes the window, or returns from the record to the list at the page it was left.
 *
 * Parameters in use: `f` and `q` (filters and search, `@team-platform/client`), `p` (the page of a list: the offset of its first row, absent on the
 * first page) and `v` (the window that is open, by identity).
 */

/** The parameter that carries the page of a list. */
export const PAGE_PARAM = 'p'
/** The parameter that carries the window that is open. */
export const WINDOW_PARAM = 'v'

/** The page of a list as the URL holds it: the offset of the first row, and how to move it. Changing page pushes; a correction of the page replaces. */
export interface UrlPage {
  start: number
  onChange: (start: number, options?: { replace?: boolean }) => void
}

export function useUrlPage(param: string = PAGE_PARAM): UrlPage {
  const [params, setParams] = useSearchParams()
  const raw = Number(params.get(param))
  const start = Number.isInteger(raw) && raw > 0 ? raw : 0
  const onChange = useCallback(
    (next: number, options?: { replace?: boolean }) =>
      setParams(
        (previous) => {
          const out = new URLSearchParams(previous)
          if (next > 0) out.set(param, String(next))
          else out.delete(param)
          return out
        },
        { replace: options?.replace ?? false },
      ),
    [param, setParams],
  )
  return { start, onChange }
}
