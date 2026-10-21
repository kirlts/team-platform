import { RotateCw, X } from '@/components/icons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useFormat, useT, type MessageKey } from '@/i18n'
import { useJobProgress } from '@/lib/events'
import { firstWords } from '@/lib/first-words'
import type { InputRecord } from '@/lib/types'
import { cn } from '@/lib/utils'
import { FitList } from './FitList'
import { Meter } from './Meter'

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
  const failed = items.filter((i) => (i.kind === 'input' ? i.input.status === 'failed' : !!i.upload.error)).length
  return (
    <section aria-label={t('tray.title')} className="flex min-h-0 min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2>{t('tray.title')}</h2>
        <span className="flex items-center gap-2 text-xs">
          {/* Said at the top, where it is seen even when the failed row is below the fold (J1-B-24). */}
          {failed > 0 && <Badge tone="danger">{t('tray.failedCount', { n: failed })}</Badge>}
          {items.length > 1 && <span className="tabular-nums text-muted">{t('tray.pending', { n: items.length })}</span>}
        </span>
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
  return <p className="break-words text-[13px] leading-snug">{words || (onlyMedia ? t('tray.onlyMedia') : '')}</p>
}

function InputRow({ input, selected, hideText, onSelect }: { input: InputRecord; selected: boolean; hideText: boolean; onSelect: () => void }) {
  const t = useT()
  const format = useFormat()
  const progress = useJobProgress(input.job_id, input.id)
  const running = input.status === 'queued' || input.status === 'extracting' || input.status === 'analyzing'
  const percent = Math.round(progress?.percent ?? input.job?.percent ?? 0)
  const count = input.proposed_count ?? input.proposal?.messages.length ?? 0
  const label = firstWords(input.text)
  // The row in view hands its progress to the review beside it: the same state is not drawn twice (J1-B-08).
  const showProgress = running && input.status !== 'queued' && !selected
  const state = t(STATE_KEY[input.status] ?? 'tray.state.queued')

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
        {/* One badge is filled: the one that waits for a person. The others are quiet (J1-B-09). */}
        {input.status === 'queued' ? (
          <span className="font-semibold">{state}</span>
        ) : (
          <Badge tone={input.status === 'proposed' ? 'solid' : input.status === 'failed' ? 'danger' : 'outline'}>
            {state}
            {showProgress && percent > 0 && <span className="ml-1 tabular-nums">{percent}%</span>}
            {input.status === 'proposed' && <span className="ml-1">· {t('tray.messages', { n: count })}</span>}
          </Badge>
        )}
      </div>
      {!hideText && <Label text={input.text} onlyMedia={input.attachments.length > 0} />}
      {showProgress && <Meter percent={percent} label={t('analysis.progress')} className="h-1.5" />}
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
          {!upload.error && percent > 0 && <span className="ml-1 tabular-nums">{percent}%</span>}
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
        <Meter percent={percent} label={t('compose.upload')} className="h-1.5" />
      )}
    </div>
  )
}
