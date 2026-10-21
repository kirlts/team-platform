import { RotateCw, X } from '@/components/icons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useFormat, useT, type MessageKey } from '@/i18n'
import { useJobProgress } from '@/lib/events'
import { firstWords } from '@/lib/first-words'
import { useReprocess } from '@/lib/queries'
import type { InputRecord } from '@/lib/types'
import { cn } from '@/lib/utils'
import { FitList } from './FitList'

/** An upload that has not finished, or did not go through: it lives in the browser until the server has the input. */
export interface PendingUpload {
  key: string
  text: string
  at: string
  progress: number
  error?: string
  onRetry: () => void
  onDiscard: () => void
}

export type TrayItem = { kind: 'upload'; upload: PendingUpload } | { kind: 'input'; input: InputRecord }

const STATE_KEY: Record<string, MessageKey> = {
  queued: 'tray.state.queued',
  extracting: 'tray.state.extracting',
  analyzing: 'tray.state.analyzing',
  proposed: 'tray.state.proposed',
  failed: 'tray.state.failed',
}

export const itemKey = (item: TrayItem) => (item.kind === 'upload' ? `upload-${item.upload.key}` : item.input.id)

/**
 * The tray of sends (UD-025): one compact row per input that is still in play, in order of arrival,
 * inside a frame that keeps its height whatever the number of rows (they paginate). A row shows the
 * time, the first words, the state, the live progress and, once ready, the count of proposed messages.
 */
export function Tray({ items, selectedId, hideTextId, onSelect }: { items: readonly TrayItem[]; selectedId: string | undefined; hideTextId?: string; onSelect: (id: string) => void }) {
  const t = useT()
  return (
    <section aria-label={t('tray.title')} className="flex min-h-0 min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2>{t('tray.title')}</h2>
        {items.length > 1 && <span className="text-xs tabular-nums text-muted">{t('tray.pending', { n: items.length })}</span>}
      </div>
      <FitList
        rows={items}
        rowKey={itemKey}
        label={t('tray.list')}
        rowsRole="listbox"
        renderRow={(item) => (item.kind === 'upload' ? <UploadRow upload={item.upload} /> : <InputRow input={item.input} selected={item.input.id === selectedId} hideText={item.input.id === hideTextId} onSelect={() => onSelect(item.input.id)} />)}
      />
    </section>
  )
}

function Label({ text, onlyMedia }: { text: string; onlyMedia: boolean }) {
  const t = useT()
  const words = firstWords(text)
  return <p className="break-words text-sm leading-snug">{words || (onlyMedia ? t('tray.onlyMedia') : '')}</p>
}

function InputRow({ input, selected, hideText, onSelect }: { input: InputRecord; selected: boolean; hideText: boolean; onSelect: () => void }) {
  const t = useT()
  const format = useFormat()
  const progress = useJobProgress(input.job_id, input.id)
  const reprocess = useReprocess()
  const running = input.status === 'queued' || input.status === 'extracting' || input.status === 'analyzing'
  const percent = Math.round(progress?.percent ?? input.job?.percent ?? 0)
  const count = input.proposed_count ?? input.proposal?.messages.length ?? 0
  const tone = input.status === 'proposed' ? 'accent' : input.status === 'failed' ? 'danger' : running && input.status !== 'queued' ? 'answered' : 'neutral'
  const label = firstWords(input.text)

  return (
    <div
      role="option"
      aria-selected={selected}
      aria-label={t('tray.open', { text: label || t('tray.onlyMedia') })}
      onClick={onSelect}
      className={cn('flex cursor-pointer flex-col gap-1 border-b border-line px-3 py-2 last:border-b-0 hover:bg-glass-edge', selected && 'bg-accent-soft/60 shadow-[inset_3px_0_0_var(--color-accent)]')}
    >
      <div className="flex items-center justify-between gap-2 text-xs text-muted">
        <time dateTime={input.created_at} className="tabular-nums">
          {format.stamp(input.created_at)}
        </time>
        <Badge tone={tone}>
          {t(STATE_KEY[input.status] ?? 'tray.state.queued')}
          {running && input.status !== 'queued' && <span className="ml-1 tabular-nums">{percent}%</span>}
          {input.status === 'proposed' && <span className="ml-1">· {t('tray.messages', { n: count })}</span>}
        </Badge>
      </div>
      {!hideText && <Label text={input.text} onlyMedia={input.attachments.length > 0} />}
      {running && (
        <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={t('analysis.progress')} className="meter h-1.5">
          <div className="meter-fill" style={{ width: `${percent}%` }} />
        </div>
      )}
      {input.status === 'failed' && (
        <div>
          <Button
            size="sm"
            variant="secondary"
            disabled={reprocess.isPending}
            onClick={(e) => {
              e.stopPropagation()
              reprocess.mutate(input.id)
            }}
          >
            <RotateCw size={13} aria-hidden /> {t('common.retry')}
          </Button>
        </div>
      )}
    </div>
  )
}

function UploadRow({ upload }: { upload: PendingUpload }) {
  const t = useT()
  const format = useFormat()
  const percent = Math.round(upload.progress * 100)
  return (
    <div className="flex flex-col gap-1 border-b border-line px-3 py-2 last:border-b-0">
      <div className="flex items-center justify-between gap-2 text-xs text-muted">
        <time dateTime={upload.at} className="tabular-nums">
          {format.stamp(upload.at)}
        </time>
        <Badge tone={upload.error ? 'danger' : 'neutral'}>
          {upload.error ? t('tray.state.notSent') : t('tray.state.uploading')}
          {!upload.error && <span className="ml-1 tabular-nums">{percent}%</span>}
        </Badge>
      </div>
      <Label text={upload.text} onlyMedia />
      {upload.error ? (
        <>
          <p role="alert" className="text-xs text-danger">
            {upload.error}
          </p>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={upload.onRetry}>
              <RotateCw size={13} aria-hidden /> {t('common.retry')}
            </Button>
            <Button size="sm" variant="ghost" aria-label={t('tray.discardUpload')} onClick={upload.onDiscard}>
              <X size={13} aria-hidden /> {t('analysis.discard')}
            </Button>
          </div>
        </>
      ) : (
        <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={t('compose.upload')} className="meter h-1.5">
          <div className="meter-fill" style={{ width: `${percent}%` }} />
        </div>
      )}
    </div>
  )
}
