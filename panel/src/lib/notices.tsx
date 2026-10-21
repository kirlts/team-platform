import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

/**
 * A notice of the screen: what just happened, said where the person is looking (J1-B-25, J1-B-26).
 * It carries at most one action (Deshacer) and one link (to what was published). It stays until the
 * person closes it or the next one replaces it: there is no timer, so it cannot vanish unread.
 */
export interface Notice {
  text: string
  /** Why it matters when it is a failure; changes the icon and the role (`alert`). */
  tone?: 'info' | 'danger'
  action?: { label: string; run: () => void | Promise<unknown> }
  link?: { to: string; label: string }
}

interface NoticeState extends Notice {
  id: number
}

interface NoticeApi {
  current: NoticeState | null
  show: (notice: Notice) => void
  dismiss: () => void
  /** How many dialogs hold their own copy of the strip: the page's own is not drawn under their overlay. */
  dialogs: number
  setDialogs: (update: (n: number) => number) => void
}

const NoticeContext = createContext<NoticeApi | null>(null)

export function NoticeProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<NoticeState | null>(null)
  const show = useCallback((notice: Notice) => setCurrent((prev) => ({ ...notice, id: (prev?.id ?? 0) + 1 })), [])
  const dismiss = useCallback(() => setCurrent(null), [])
  const [dialogs, setDialogs] = useState(0)
  const api = useMemo(() => ({ current, show, dismiss, dialogs, setDialogs }), [current, show, dismiss, dialogs])
  return <NoticeContext.Provider value={api}>{children}</NoticeContext.Provider>
}

/** Outside a provider (a test of one component) notices go nowhere instead of failing. */
const SILENT: NoticeApi = { current: null, show: () => undefined, dismiss: () => undefined, dialogs: 0, setDialogs: () => undefined }

export function useNotices(): NoticeApi {
  return useContext(NoticeContext) ?? SILENT
}

/** A strip drawn inside a dialog registers while it is mounted, so the page's own copy is not left behind the overlay. */
export function useNoticeInDialog(active: boolean) {
  const { setDialogs } = useNotices()
  useEffect(() => {
    if (!active) return
    setDialogs((n) => n + 1)
    return () => setDialogs((n) => n - 1)
  }, [active, setDialogs])
}
