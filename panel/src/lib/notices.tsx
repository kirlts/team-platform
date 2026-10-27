import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'

/**
 * A notice of the screen: what just happened, said where the person is looking (J1-B-25, J1-B-26).
 * It carries at most one action (Deshacer) and one link (to what was published). It leaves by itself (UD-253): after
 * `NOTICE_MS`, or `NOTICE_ACTION_MS` when it carries something to click, counted while neither the pointer nor the focus is on it.
 * Escape or the next notice also take it away.
 */
export interface Notice {
  text: string
  /** Why it matters when it is a failure; changes the icon and the role (`alert`). */
  tone?: 'info' | 'danger'
  action?: { label: string; run: () => void | Promise<unknown> }
  link?: { to: string; label: string }
  /** The control that caused it. From 1024 px the notice is drawn next to it and not in the top bar, so what happened is read where it was done. */
  near?: () => Element | null
}

/** Token `--notice-ms` of DISENO.md: the longest notice text (13 words) read at 190 words per minute, plus one second to notice it. */
export const NOTICE_MS = 5000
/** Token `--notice-action-ms` of DISENO.md: the same reading plus the time to reach Deshacer or the link. */
export const NOTICE_ACTION_MS = 8000

export function noticeDuration(notice: Notice): number {
  return notice.action || notice.link ? NOTICE_ACTION_MS : NOTICE_MS
}

interface NoticeState extends Notice {
  id: number
}

interface NoticeApi {
  current: NoticeState | null
  show: (notice: Notice) => void
  dismiss: () => void
}

const NoticeContext = createContext<NoticeApi | null>(null)

export function NoticeProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<NoticeState | null>(null)
  /** Every notice gets its own id, so a new one replaces the previous and starts its own count even with the same text. */
  const seq = useRef(0)
  const show = useCallback((notice: Notice) => setCurrent({ ...notice, id: ++seq.current }), [])
  const dismiss = useCallback(() => setCurrent(null), [])
  const api = useMemo(() => ({ current, show, dismiss }), [current, show, dismiss])
  return <NoticeContext.Provider value={api}>{children}</NoticeContext.Provider>
}

/** Outside a provider (a test of one component) notices go nowhere instead of failing. */
const SILENT: NoticeApi = { current: null, show: () => undefined, dismiss: () => undefined }

export function useNotices(): NoticeApi {
  return useContext(NoticeContext) ?? SILENT
}
