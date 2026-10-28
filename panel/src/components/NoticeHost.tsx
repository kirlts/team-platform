import { useEffect, useRef, useState } from 'react'
import { Check } from '@/components/icons'
import { Link } from 'react-router'
import { noticeDuration, useNotices } from '@/lib/notices'
import { cn } from '@/lib/utils'

/**
 * Where the current notice is drawn. It never moves what is being read (J2-B-21, J2-B-25) and it is centered on the window (UD-253):
 * at the bottom up to 1023 px and, from 1024 px, in the top bar, where it covers no content and nothing under it needs a click
 * (J3-B-15). There the name of the project takes up to 16 rem on the left, so the notice is at most the width minus twice that and never
 * reaches it; at 768 px that left 256 px and the text broke into three lines, so a tablet keeps it at the bottom. One copy, one place (H-904).
 * It leaves by itself (UD-253): the count stops while the pointer or the focus is on it, and Escape takes it away. There is no
 * close button: a status that leaves alone and pauses for whoever reaches it meets WCAG 2.2.1 without one.
 * Its text says what happened and to whom, the link goes to it, the action undoes it.
 */
export function NoticeHost() {
  const { current, dismiss } = useNotices()
  if (!current) return null
  return <NoticeView key={current.id} notice={current} dismiss={dismiss} />
}

function NoticeView({ notice, dismiss }: { notice: NonNullable<ReturnType<typeof useNotices>['current']>; dismiss: () => void }) {
  const danger = notice.tone === 'danger'
  const duration = noticeDuration(notice)
  const [held, setHeld] = useState({ pointer: false, focus: false })
  const paused = held.pointer || held.focus
  /** What is left of the count; a pause keeps it and the count resumes from there. */
  const left = useRef(duration)

  useEffect(() => {
    if (paused) return
    const started = performance.now()
    const timer = window.setTimeout(dismiss, left.current)
    return () => {
      window.clearTimeout(timer)
      left.current = Math.max(0, left.current - (performance.now() - started))
    }
  }, [paused, dismiss])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      // A window open over the page takes Escape for itself, unless the focus is on the notice.
      const inside = document.activeElement?.closest('[data-notice]')
      if (!inside && document.querySelector('[role=dialog]')) return
      dismiss()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [dismiss])

  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-4 z-40 flex justify-center lg:inset-x-0 lg:bottom-auto lg:top-1.5">
      <div
        role={danger ? 'alert' : 'status'}
        aria-live={danger ? 'assertive' : 'polite'}
        data-notice
        data-notice-ms={duration}
        data-paused={paused || undefined}
        onPointerEnter={() => setHeld((h) => ({ ...h, pointer: true }))}
        onPointerLeave={() => setHeld((h) => ({ ...h, pointer: false }))}
        onFocus={() => setHeld((h) => ({ ...h, focus: true }))}
        onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setHeld((h) => ({ ...h, focus: false }))}
        className={cn('pop pointer-events-auto flex min-h-9 max-w-xl items-start lg:max-w-[min(36rem,calc(100vw-32rem))] gap-2 rounded-lg px-3 py-1.5 text-sm shadow-pop', danger ? 'text-danger' : 'text-fg')}
      >
        {!danger && <Check size={16} aria-hidden className="mt-0.5 shrink-0 text-accent" />}
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-0.5 self-center">
          <p className="break-words">{notice.text}</p>
          {(notice.link || notice.action) && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm font-semibold">
              {notice.link && (
                <Link to={notice.link.to} onClick={dismiss} className="inline-flex min-h-6 items-center text-accent hover:underline pointer-coarse:min-h-11">
                  {notice.link.label}
                </Link>
              )}
              {notice.action && (
                <button
                  type="button"
                  className="inline-flex min-h-6 items-center text-accent hover:underline pointer-coarse:min-h-11"
                  onClick={() => {
                    const run = notice.action!.run
                    dismiss()
                    void run()
                  }}
                >
                  {notice.action.label}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
