import { Check, X } from '@/components/icons'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'
import { useNoticeInDialog, useNotices } from '@/lib/notices'
import { cn } from '@/lib/utils'

/**
 * Where the current notice is drawn. It never moves what is being read (J2-B-21, J2-B-25): on the page it floats at the
 * bottom, over the page and clear of the header, the side bar and the compose bar; inside the window of sends it takes
 * the title bar, whose only other content is the title and the close button. Its text says what happened and to whom,
 * the link goes to it, the action undoes it.
 */
export function NoticeHost({ inDialog = false }: { inDialog?: boolean }) {
  const t = useT()
  const { current, dismiss, dialogs } = useNotices()
  useNoticeInDialog(inDialog)
  if (!current || (!inDialog && dialogs > 0)) return null
  const danger = current.tone === 'danger'
  return (
    <div className={inDialog ? 'absolute inset-x-2 top-1 z-20 md:left-28 md:right-14 md:top-1.5' : 'pointer-events-none fixed inset-x-4 bottom-4 z-40 flex justify-center'}>
      <div
        key={current.id}
        role={danger ? 'alert' : 'status'}
        data-notice
        className={cn('pop pointer-events-auto flex w-full items-start gap-2 rounded-lg py-1.5 pl-3 pr-1.5 text-sm shadow-pop', !inDialog && 'max-w-xl', danger ? 'text-danger' : 'text-fg')}
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
