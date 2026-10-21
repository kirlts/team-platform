import { Badge } from '@/components/ui/badge'
import { useFormat, useT, type MessageKey } from '@/i18n'
import { useJobProgress } from '@/lib/events'
import { firstWords } from '@/lib/first-words'
import { sendPercent } from '@/lib/progress'
import type { InputRecord } from '@/lib/types'
import { cn } from '@/lib/utils'

/** An upload that has not finished, or did not go through: it lives in the browser until the server has the input. */
export interface PendingUpload {
  key: string
  text: string
  /** Names of the files and addresses of the links that go with the text. */
  names: string[]
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
  published: 'tray.state.published',
  failed: 'tray.state.failed',
}

export const itemKey = (item: TrayItem) => (item.kind === 'upload' ? `upload-${item.upload.key}` : item.input.id)

/**
 * The sends in play (UD-025), as a compact selector inside the drawer of Inicio (UD-046): one small option per send, in order
 * of arrival, in a single row that scrolls sideways when there are many; with one send it is not drawn. An option shows the time, the state with
 * its live progress and, once ready, how many messages were proposed. Each one carries its first words so they can be told apart.
 */
export function SendSwitcher({ items, selectedId, onSelect }: { items: readonly TrayItem[]; selectedId: string | undefined; onSelect: (id: string) => void }) {
  const t = useT()
  if (items.length < 2) return null
  return (
    <div role="listbox" aria-label={t('tray.list')} data-testid="send-switcher" className="scroll-thin flex min-w-0 items-stretch gap-1.5 overflow-x-auto pb-1">
      {items.map((item, index) => (
        // On a phone two options fill the row exactly, so none is cut at the edge; from the third on the row scrolls.
        <div key={itemKey(item)} className="w-[calc((100%-0.375rem)/2)] shrink-0 md:w-44">
          {item.kind === 'upload' ? <UploadOption n={index + 1} upload={item.upload} selected={item.upload.key === selectedId} onSelect={() => onSelect(item.upload.key)} /> : <InputOption n={index + 1} input={item.input} selected={item.input.id === selectedId} onSelect={() => onSelect(item.input.id)} />}
        </div>
      ))}
    </div>
  )
}

function Label({ text, onlyMedia }: { text: string; onlyMedia: boolean }) {
  const t = useT()
  const words = firstWords(text)
  // The first words repeat the start of the original beside the analysis, on purpose: it is how a send is told from the others.
  return (
    <p data-repeat-ok="send-label" className="break-words text-xs leading-snug md:text-sm">
      {words || (onlyMedia ? t('tray.onlyMedia') : '')}
    </p>
  )
}

const OPTION = 'flex h-full w-full cursor-pointer flex-col gap-1 rounded-md border border-line px-2.5 py-1.5 text-left hover:bg-glass-edge'
const OPTION_SELECTED = 'border-accent bg-accent-soft/60 shadow-[inset_0_-3px_0_var(--color-accent)]'

/** The order of arrival: what tells two sends with the same words apart. The time stays in the title and for a screen reader, so the row keeps its height. */
function Ordinal({ n, at }: { n: number; at: string }) {
  const t = useT()
  const format = useFormat()
  return (
    <span className="min-w-0 text-xs font-semibold text-fg" title={format.stamp(at)}>
      {t('tray.ordinal', { n })}
      <time dateTime={at} className="sr-only">
        {` ${format.stamp(at)}`}
      </time>
    </span>
  )
}

function InputOption({ n, input, selected, onSelect }: { n: number; input: InputRecord; selected: boolean; onSelect: () => void }) {
  const t = useT()
  const progress = useJobProgress(input.job_id, input.id)
  const running = input.status === 'queued' || input.status === 'extracting' || input.status === 'analyzing'
  const percent = sendPercent(input, progress)
  const count = input.proposed_count ?? input.proposal?.messages.length ?? 0
  const label = firstWords(input.text, 6)
  const state = t(STATE_KEY[input.status] ?? 'tray.state.queued')
  return (
    <button type="button" role="option" aria-selected={selected} aria-label={t('tray.open', { text: label || t('tray.onlyMedia') })} onClick={onSelect} className={cn(OPTION, selected && OPTION_SELECTED)}>
      <span className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
        <Ordinal n={n} at={input.created_at} />
        <Badge tone={input.status === 'proposed' ? 'solid' : input.status === 'failed' ? 'danger' : input.status === 'published' ? 'neutral' : 'outline'}>
          {state}
          {running && input.status !== 'queued' && percent > 0 && <span className="ml-1 tabular-nums">{percent}%</span>}
          {(input.status === 'proposed' || input.status === 'published') && <span className="ml-1">· {input.status === 'published' ? (input.messages?.length ?? count) : count}</span>}
        </Badge>
      </span>
      <Label text={input.text} onlyMedia={input.attachments.length > 0} />
    </button>
  )
}

function UploadOption({ n, upload, selected, onSelect }: { n: number; upload: PendingUpload; selected: boolean; onSelect: () => void }) {
  const t = useT()
  const percent = Math.round(upload.progress * 100)
  return (
    <button type="button" role="option" aria-selected={selected} aria-label={t('tray.open', { text: firstWords(upload.text, 6) || t('tray.onlyMedia') })} onClick={onSelect} className={cn(OPTION, selected && OPTION_SELECTED)}>
      <span className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
        <Ordinal n={n} at={upload.at} />
        <Badge tone={upload.error ? 'danger' : 'neutral'}>
          {upload.error ? t('tray.state.notSent') : t('tray.state.uploading')}
          {!upload.error && percent > 0 && <span className="ml-1 tabular-nums">{percent}%</span>}
        </Badge>
      </span>
      <Label text={upload.text} onlyMedia />
    </button>
  )
}
