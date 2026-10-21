import { Check, X } from '@/components/icons'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'
import { useNotices } from '@/lib/notices'
import { cn } from '@/lib/utils'

/**
 * Where the current notice is drawn: a strip under the header, in the flow of the page. It never covers a
 * control (the undo buttons, Enviar and the pager sit where an overlay would land), and the lists under it
 * fit the room that is left (UD-017). Its text says what happened and to whom, the link goes to it, the action undoes it.
 */
export function NoticeHost({ inDialog = false }: { inDialog?: boolean }) {
  const t = useT()
  const { current, dismiss, dialogs } = useNotices()
  if (!current || (!inDialog && dialogs > 0)) return null
  const danger = current.tone === 'danger'
  return (
    <div className={inDialog ? 'shrink-0 px-4 pt-2' : 'shrink-0 px-4 pt-2 md:px-10'}>
      <div
        key={current.id}
        role={danger ? 'alert' : 'status'}
        data-notice
        className={cn('glass-strong flex w-full items-start gap-2 rounded-lg py-1.5 pl-3 pr-1.5 text-sm', danger ? 'text-danger' : 'text-fg')}
      >
        {!danger && <Check size={16} aria-hidden className="mt-1 shrink-0 text-accent" />}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-0.5 self-center">
          <p className="break-words">{current.text}</p>
          {(current.link || current.action) && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] font-semibold">
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
