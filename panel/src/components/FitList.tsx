import { ChevronLeft, ChevronRight } from '@/components/icons'
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useT } from '@/i18n'
import { fitCount, pageRange, total } from '@/lib/fit'
import { cn } from '@/lib/utils'

/** Rows drawn at once, only while measuring which of them fit. */
const MEASURE_ROWS = 60

function useDesktop(): boolean {
  const [desktop, setDesktop] = useState(() => window.matchMedia('(min-width: 768px)').matches)
  useEffect(() => {
    const query = window.matchMedia('(min-width: 768px)')
    const sync = () => setDesktop(query.matches)
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])
  return desktop
}

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
}: {
  rows: readonly T[]
  rowKey: (row: T) => string
  renderRow: (row: T) => ReactNode
  empty?: ReactNode
  className?: string
  /** Nombre accesible de la lista. */
  label?: string
  /** Fila de títulos fija sobre las filas; su alto se descuenta del que cabe. */
  header?: ReactNode
  /** Sin vidrio propio: la lista va dentro de otro panel. */
  bare?: boolean
}) {
  const t = useT()
  const desktop = useDesktop()
  const frame = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const head = useRef<HTMLDivElement>(null)
  const [start, setStart] = useState(0)
  const [history, setHistory] = useState<number[]>([])
  /** Rows on this page; `null` while it is being measured. */
  const [count, setCount] = useState<number | null>(null)

  // A new list or a new window: measure again from the page we are on.
  useEffect(() => {
    setCount(null)
    setStart((s) => Math.min(s, Math.max(0, rows.length - 1)))
  }, [rows, desktop])

  useEffect(() => {
    const el = frame.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let last = el.clientHeight
    const observer = new ResizeObserver(() => {
      if (Math.abs(el.clientHeight - last) > 0.5) {
        last = el.clientHeight
        setCount(null)
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const pagerHeight = useRef(0)

  useLayoutEffect(() => {
    if (!desktop || count !== null) return
    const el = body.current
    const box = frame.current
    if (!el || !box) return
    const heights = [...el.children].map((c) => c.getBoundingClientRect().height)
    const remaining = rows.length - start
    // Everything left fits without a pager when it is the first page.
    const above = head.current?.getBoundingClientRect().height ?? 0
    if (start === 0 && heights.length === remaining && total(heights) <= box.clientHeight - above + 0.5) {
      setCount(remaining)
      return
    }
    const pager = pagerHeight.current || 40
    setCount(Math.min(remaining, fitCount(heights, box.clientHeight - above - pager)))
  })

  const shown = desktop ? rows.slice(start, count === null ? start + MEASURE_ROWS : start + count) : rows
  const pages = desktop && count !== null && (start > 0 || start + count < rows.length)
  const range = pageRange(start, count ?? shown.length, rows.length)

  const go = (to: number, back: boolean) => {
    setHistory((h) => (back ? h.slice(0, -1) : [...h, start]))
    setStart(to)
    setCount(null)
  }

  return (
    <div ref={frame} aria-label={label} className={cn('flex min-h-0 flex-1 flex-col overflow-hidden', bare ? 'border-y border-line' : 'glass leaf', className)}>
      {header && (
        <div ref={head} className="shrink-0">
          {header}
        </div>
      )}
      {rows.length === 0 ? (
        (empty ?? null)
      ) : (
        <>
          <div ref={body} className="flex min-h-0 flex-1 flex-col">
            {shown.map((row) => (
              <Fragment key={rowKey(row)}>{renderRow(row)}</Fragment>
            ))}
          </div>
          {pages && (
            <div
              ref={(el) => {
                if (el) pagerHeight.current = el.getBoundingClientRect().height
              }}
              className="flex shrink-0 items-center justify-between gap-3 border-t border-line px-4 py-2 text-xs text-muted"
            >
              <span aria-live="polite" className="tabular-nums">
                {t('pager.range', range)}
              </span>
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label={t('pager.previous')}
                  disabled={history.length === 0}
                  onClick={() => go(history[history.length - 1] ?? 0, true)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-edge bg-glass hover:border-accent disabled:opacity-40"
                >
                  <ChevronLeft size={14} aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label={t('pager.next')}
                  disabled={start + (count ?? 0) >= rows.length}
                  onClick={() => go(start + (count ?? 0), false)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-edge bg-glass hover:border-accent disabled:opacity-40"
                >
                  <ChevronRight size={14} aria-hidden />
                </button>
              </span>
            </div>
          )}
        </>
      )}
    </div>
  )
}
