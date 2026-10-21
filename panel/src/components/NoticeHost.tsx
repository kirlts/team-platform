import { Check, X } from '@/components/icons'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'
import { useNotices } from '@/lib/notices'
import { cn } from '@/lib/utils'

/**
 * Where the current notice is drawn. It never moves what is being read (J2-B-21, J2-B-25): on the page it floats at the
 * bottom of a phone and, from the width of a tablet, in the empty middle of the top bar, between the name and the bell, where it
 * covers no content and nothing under it needs a click (J3-B-15: at the bottom it hid the pager of the lists). There is one copy and one place:
 * a second copy inside the window of sends was drawn 116.5 px from the top while that window was still closing, and a test measured it there (H-904).
 * Its text says what happened and to whom, the link goes to it, the action undoes it.
 */
export function NoticeHost() {
  const t = useT()
  const { current, dismiss } = useNotices()
  if (!current) return null
  const danger = current.tone === 'danger'
  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-4 z-40 flex justify-center md:inset-x-auto md:bottom-auto md:left-72 md:right-28 md:top-1.5 md:justify-start">
      <div
        key={current.id}
        role={danger ? 'alert' : 'status'}
        data-notice
        className={cn('pop pointer-events-auto flex w-full items-start gap-2 rounded-lg py-1.5 pl-3 pr-1.5 text-sm shadow-pop max-w-xl', danger ? 'text-danger' : 'text-fg')}
      >
        {!danger && <Check size={16} aria-hidden className="mt-1 shrink-0 text-accent" />}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-0.5 self-center">
          <p className="break-words">{current.text}</p>
          {(current.link || current.action) && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm font-semibold">
              {current.link && (
                <Link to={current.link.to} onClick={dismiss} className="inline-flex min-h-6 items-center text-accent hover:underline">
                  {current.link.label}
                </Link>
              )}
              {current.action && (
                <button
                  type="button"
                  className="inline-flex min-h-6 items-center text-accent hover:underline"
                  onClick={() => {
                    const run = current.action!.run
                    dismiss()
                    void run()
                  }}
                >
                  {current.action.label}
                </button>
              )}
            </div>
          )}
        </div>
        <Button size="icon-sm" variant="ghost" aria-label={t('notice.close')} onClick={dismiss} className="touch-target shrink-0">
          <X size={14} aria-hidden />
        </Button>
      </div>
    </div>
  )
}
