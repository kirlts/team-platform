import { Check, X } from '@/components/icons'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'
import { useNotices } from '@/lib/notices'
import { cn } from '@/lib/utils'

/**
 * Where the current notice is drawn: a strip under the header, above everything, that does not push the
 * page down (UD-017). Its text says what happened and to whom, the link goes to it, the action undoes it.
 */
export function NoticeHost() {
  const t = useT()
  const { current, dismiss } = useNotices()
  if (!current) return null
  const danger = current.tone === 'danger'
  return (
    <div className="pointer-events-none fixed inset-x-0 top-16 z-50 flex justify-center px-4 sm:justify-end">
      <div
        key={current.id}
        role={danger ? 'alert' : 'status'}
        data-notice
        className={cn('glass-strong pointer-events-auto flex w-full max-w-md items-start gap-2 rounded-lg py-2 pl-3 pr-1.5 text-sm', danger ? 'text-danger' : 'text-fg')}
      >
        {!danger && <Check size={16} aria-hidden className="mt-0.5 shrink-0 text-accent" />}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
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
