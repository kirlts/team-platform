import { ChevronLeft, ChevronRight } from '@/components/icons'
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useT } from '@/i18n'
import { fitCount, pageRange, total } from '@/lib/fit'
import { useDesktop } from '@/lib/useDesktop'
import { cn } from '@/lib/utils'

/** Rows drawn at once, only while measuring which of them fit. */
const MEASURE_ROWS = 60

/** Height of the pager strip: 32 px buttons, 8 px of padding above and below and a 1 px rule. Measured again once it is drawn. */
const PAGER_HEIGHT = 49

/**
 * A list that fits the frame it is in (UD-017). The frame takes the height its parent gives it; the
 * rows are drawn, measured, and only those that fit stay; the rest are on the next pages, with the
 * range and the two arrows at the foot. The page size is the measured height over the measured rows:
 * it changes when the window, the rows or the frame change, and it is never written down.
 *
 * On a phone the page is allowed to grow with its content, so every row is drawn and there are no pages.
 * `rows` must keep its identity between renders unless the list changed.
 */
export function FitList<T>({
  rows,
  rowKey,
  renderRow,
  empty,
  className,
  label,
  header,
  bare = false,
  rowsRole,
}: {
  rows: readonly T[]
  rowKey: (row: T) => string
  renderRow: (row: T) => ReactNode
  empty?: ReactNode
  className?: string
  /** Accessible name of the list. */
  label?: string
  /** Fixed row of titles above the rows; its height is subtracted from what fits. */
  header?: ReactNode
  /** No glass of its own: the list goes inside another panel. */
  bare?: boolean
  /** ARIA role of the group of rows (`listbox` when each row is an option). */
  rowsRole?: string
}) {
  const t = useT()
  const desktop = useDesktop()
  /** The space the list may take: stable, whatever the list holds. The visible frame hugs its rows inside it. */
  const slot = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const head = useRef<HTMLDivElement>(null)
  const [start, setStart] = useState(0)
  const [history, setHistory] = useState<number[]>([])
  /** Grows when the frame changes size, so a measure taken at another size stops being valid. */
  const [frameVersion, setFrameVersion] = useState(0)
  /** What was measured, and for which list, window, page and frame. A different list, window, page or frame makes it stale. */
  const [fit, setFit] = useState<{ rows: readonly T[]; desktop: boolean; start: number; version: number; n: number; sum: number } | null>(null)
  const first = Math.min(start, Math.max(0, rows.length - 1))
  /** Rows on this page; `null` while it is being measured. */
  const count = fit && fit.rows === rows && fit.desktop === desktop && fit.start === first && fit.version === frameVersion ? fit.n : null

  useEffect(() => {
    const el = slot.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let last = el.clientHeight
    const observer = new ResizeObserver(() => {
      if (Math.abs(el.clientHeight - last) > 0.5) {
        last = el.clientHeight
        setFrameVersion((v) => v + 1)
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const pagerHeight = useRef(0)

  useLayoutEffect(() => {
    if (!desktop || count !== null) return
    const el = body.current
    const box = slot.current
    if (!el || !box) return
    const heights = [...el.children].map((c) => c.getBoundingClientRect().height)
    const remaining = rows.length - first
    const above = head.current?.getBoundingClientRect().height ?? 0
    const stamp = { rows, desktop, start: first, version: frameVersion }
    // Everything left fits without a pager when it is the first page.
    if (first === 0 && heights.length === remaining && total(heights) <= box.clientHeight - above + 0.5) {
      setFit({ ...stamp, n: remaining, sum: total(heights) })
      return
    }
    const pager = pagerHeight.current || PAGER_HEIGHT
    const n = Math.min(remaining, fitCount(heights, box.clientHeight - above - pager))
    setFit({ ...stamp, n, sum: total(heights.slice(0, n)) })
  })

  // A row that changes height after it was measured (its template arrives, a field is edited) makes the measure stale.
  useEffect(() => {
    const el = body.current
    if (!el || !fit || count === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      const sum = total([...el.children].map((c) => c.getBoundingClientRect().height))
      if (Math.abs(sum - fit.sum) > 1) setFrameVersion((v) => v + 1)
    })
    for (const child of el.children) observer.observe(child)
    return () => observer.disconnect()
  })

  const shown = desktop ? rows.slice(first, count === null ? first + MEASURE_ROWS : first + count) : rows
  const pages = desktop && count !== null && (first > 0 || first + count < rows.length)
  const range = pageRange(first, count ?? shown.length, rows.length)

  const go = (to: number, back: boolean) => {
    setHistory((h) => (back ? h.slice(0, -1) : [...h, first]))
    setStart(to)
  }

  return (
    <div ref={slot} className={cn('flex min-h-0 flex-1 flex-col', className)}>
      <div ref={frame} aria-label={label} className={cn('flex max-h-full min-h-0 flex-col overflow-hidden', pages && 'h-full', bare ? 'border-y border-line' : 'glass leaf')}>
      {header && (
        <div ref={head} className="shrink-0">
          {header}
        </div>
      )}
      {rows.length === 0 ? (
        (empty ?? null)
      ) : (
        <>
          <div ref={body} role={rowsRole} aria-label={rowsRole ? label : undefined} className="flex min-h-0 flex-1 flex-col">
            {shown.map((row) => (
              <Fragment key={rowKey(row)}>{renderRow(row)}</Fragment>
            ))}
          </div>
          {pages && (
            <div
              ref={(el) => {
                if (el) pagerHeight.current = el.getBoundingClientRect().height
              }}
              className="flex shrink-0 items-center justify-between gap-3 border-t border-line px-4 py-2 text-sm text-muted"
            >
              <span aria-live="polite" className="tabular-nums">
                {t('pager.range', { from: range.from, to: range.to, total: range.total })}
              </span>
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label={t('pager.previous')}
                  disabled={history.length === 0}
                  onClick={() => go(history[history.length - 1] ?? 0, true)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-edge bg-glass hover:border-accent disabled:opacity-40"
                >
                  <ChevronLeft size={16} aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label={t('pager.next')}
                  disabled={first + (count ?? 0) >= rows.length}
                  onClick={() => go(first + (count ?? 0), false)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-edge bg-glass hover:border-accent disabled:opacity-40"
                >
                  <ChevronRight size={16} aria-hidden />
                </button>
              </span>
            </div>
          )}
        </>
      )}
      </div>
    </div>
  )
}
