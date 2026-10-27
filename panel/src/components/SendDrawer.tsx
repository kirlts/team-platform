import { AlertTriangle, RotateCw } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { useLookups } from './lookups'
import { Meter } from './Meter'
import { OriginalFrame } from './InputPreview'
import { ReviewPane } from './ReviewPane'
import { SendSwitcher, type PendingUpload, type TrayItem } from './Tray'

type ReviewProps = Parameters<typeof ReviewPane>[0]

/**
 * The drawer under the bar of Inicio (mockup «desplegable dinámico»): it opens by itself when something is sent and shows
 * that send where the person is looking, the original on the left and what the model made of it on the right, without another click
 * (UD-046). With several sends in a row (UD-025) it shows the current one and a compact selector of the others, in the same place.
 * It is a block of the page and not a window: it is as tall as what it shows (at least 20 rem: the floor that keeps its height from the queue to the proposal, H-703, J3-B-04; the blank band it leaves under a short original is the price H-730 recorded) and, with it open, the page scrolls (UD-110, which amends UD-017).
 */
export function SendDrawer({ items, selectedId, onSelect, review }: { items: readonly TrayItem[]; selectedId: string | undefined; onSelect: (id: string) => void; review: Omit<ReviewProps, 'inputId'> }) {
  const t = useT()
  const upload = items.find((i) => i.kind === 'upload' && i.upload.key === selectedId)
  return (
    <section
      aria-label={t('tray.title')}
      data-testid="send-drawer"
      data-keys-ok=""
      className="glass leaf flex min-w-0 flex-col gap-3 p-4 md:min-h-[20rem] md:shrink-0"
    >
      <SendSwitcher items={items} selectedId={selectedId} onSelect={onSelect} />
      {upload?.kind === 'upload' ? <UploadPane upload={upload.upload} /> : <ReviewPane inputId={selectedId} {...review} />}
    </section>
  )
}

/** A send that is still going up: what was written and the progress of the upload, or why it did not go. The text is never lost. */
function UploadPane({ upload }: { upload: PendingUpload }) {
  const t = useT()
  const { memberName } = useLookups()
  const percent = Math.round(upload.progress * 100)
  const addressing = [
    upload.recipientIds?.length ? `${t('compose.to')}: ${upload.recipientIds.map(memberName).filter(Boolean).join(', ')}` : '',
    upload.asMemberId ? `${t('compose.sendAs')}: ${memberName(upload.asMemberId)}` : '',
  ].filter(Boolean)
  // A send of text alone has nothing to upload: it is being sent (the wording follows what travels).
  const sending = upload.names.length === 0
  return (
    <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:grid-rows-[minmax(0,1fr)]">
      <OriginalFrame>
        {upload.text && <p className="scroll-thin min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words px-1 text-sm">{upload.text}</p>}
        {addressing.length > 0 && (
          <ul aria-label={t('recipients.label')} className="flex flex-col gap-0.5 px-1 text-xs text-muted">
            {addressing.map((line) => (
              <li key={line} className="break-words">
                {line}
              </li>
            ))}
          </ul>
        )}
        {upload.names.length > 0 && (
          <ul aria-label={t('media.attachments')} className="flex flex-col gap-0.5 text-xs text-muted">
            {upload.names.map((n, i) => (
              <li key={i} className="break-words">
                {n}
              </li>
            ))}
          </ul>
        )}
      </OriginalFrame>
      <section aria-label={t('analysis.title')} className={cn('leaf border border-transparent flex min-h-0 min-w-0 flex-col gap-3 self-start bg-surface p-4 md:w-full')}>
        <div className="flex min-h-8 items-center gap-2">
          <h2>{t('analysis.title')}</h2>
        </div>
        {upload.error ? (
          <>
            <div role="alert" className="flex items-start gap-3 rounded-md bg-danger-soft p-4 text-sm text-danger">
              <AlertTriangle size={16} aria-hidden className="mt-0.5 shrink-0" />
              <p className="min-w-0 [overflow-wrap:anywhere]">{t('compose.sendFailed', { reason: upload.error })}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={upload.onRetry}>
                <RotateCw size={14} aria-hidden /> {t('common.retry')}
              </Button>
              <Button variant="ghost" aria-label={t('tray.discardUpload')} onClick={upload.onDiscard}>
                {t('analysis.discard')}
              </Button>
            </div>
          </>
        ) : (
          <div data-ui-stage="progress" className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span>{t(sending ? 'tray.state.sending' : 'tray.state.uploading')}</span>
              {percent > 0 && <span className="tabular-nums text-muted">{percent} %</span>}
            </div>
            <Meter percent={percent} label={t(sending ? 'compose.sending' : 'compose.upload')} className="h-2.5" />
          </div>
        )}
      </section>
    </div>
  )
}
