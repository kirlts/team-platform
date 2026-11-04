import { useCallback, useState } from 'react'
import { useInRouterContext, useLocation, useNavigate, useSearchParams } from 'react-router'

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

/** Marks, in the state of the entry of the history, that this entry was pushed by `show` for the window with that id. */
const PUSHED = 'windowPushedFor'

/**
 * A window with an identity of its own (the profile of a member, a gallery, the guards of an area, the menu of a phone) is open when the address says so:
 * `?v=<id>`. Opening it pushes an entry, so Atrás closes the window and stays in the page (TP-14); a reload keeps it open; and an address pasted in another tab
 * shows the page with the window open. Closing it goes back to the entry that opened it, or, when the person arrived by the address, removes `v` in place.
 * The window is open because of the address and for no other reason: there is no second copy of its state to keep in step.
 */
export function useUrlWindow(id: string) {
  // Outside a router (the test of one component) the window is local state. Whether there is a router does not change while a component lives,
  // so the same hook is called in every render of it.
  const inRouter = useInRouterContext()
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return inRouter ? useRoutedWindow(id) : useLocalWindow()
}

function useLocalWindow() {
  const [open, setOpen] = useState(false)
  return { open, show: () => setOpen(true), hide: () => setOpen(false), setOpen }
}

function useRoutedWindow(id: string) {
  const location = useLocation()
  const navigate = useNavigate()
  const open = id !== '' && new URLSearchParams(location.search).get(WINDOW_PARAM) === id
  const target = (set: boolean) => {
    const next = new URLSearchParams(location.search)
    if (set) next.set(WINDOW_PARAM, id)
    else next.delete(WINDOW_PARAM)
    const search = next.toString()
    return { pathname: location.pathname, search: search ? `?${search}` : '', hash: location.hash }
  }
  const show = () => navigate(target(true), { state: { [PUSHED]: id } })
  const hide = () => {
    if ((location.state as Record<string, unknown> | null)?.[PUSHED] === id) navigate(-1)
    else navigate(target(false), { replace: true })
  }
  return { open, show, hide, setOpen: (value: boolean) => (value ? show() : hide()) }
}

/**
 * The gallery over a page as a window of the address: the same pair `[open, setOpen]` the components kept in state (`open` is the index of the medium in
 * view, or null), now open because the address says `?v=<key>`. The index stays in the component; an address pasted in another tab opens on the first.
 */
export function useUrlGallery(key: string) {
  const win = useUrlWindow(key)
  const [index, setIndex] = useState(0)
  const open: number | null = win.open ? index : null
  const setOpen = (to: number | null) => {
    if (to === null) {
      if (win.open) win.hide()
      return
    }
    setIndex(to)
    win.show()
  }
  return [open, setOpen] as const
}
