import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { ChevronRight } from '@/components/icons'
import { ComposeBar, type SendDraft } from '@/components/ComposeBar'
import { useLookups } from '@/components/lookups'
import { NotifyBadge, ToneMark } from '@/components/NotifyBadge'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import { FitList } from '@/components/FitList'
import { MessageCard } from '@/components/MessageCard'
import { Page } from '@/components/Page'
import { ReviewPane } from '@/components/ReviewPane'
import { Segmented } from '@/components/Segmented'
import { Tray, type PendingUpload, type TrayItem } from '@/components/Tray'
import { useErrorText, useFormat, useT } from '@/i18n'
import { ME, serializeQuery, type MessageQuery } from '@/lib/filters'
import { areaMessagesPath, areaPendingCounts, mineCounts } from '@/lib/pending'
import { topTone } from '@/lib/priority'
import { useEventsSnapshot } from '@/lib/events'
import { useMe, useMessages, useSummary, useTray } from '@/lib/queries'
import { uploadInput } from '@/lib/upload'

/** One send that is going up to the server: what was sent, how far it is and why it failed, if it did. */
interface Upload {
  key: string
  draft: SendDraft
  at: string
  progress: number
  error?: string
}

/** Elements where a key press is for typing or for the control itself, never for moving through the tray. */
const isTyping = (target: EventTarget | null) => {
  const el = target as HTMLElement | null
  if (!el) return false
  // The dialog of the sends marks itself: the keys of the tray work inside it, but not in another dialog.
  const dialog = el.closest('[role="dialog"]')
  const inOtherDialog = !!dialog && !dialog.hasAttribute('data-keys-ok')
  return el.isContentEditable || inOtherDialog || !!el.closest('input, textarea, select, button, a, [role="menu"], [role="menuitemradio"]')
}

export function Home() {
  const t = useT()
  const format = useFormat()
  const errorText = useErrorText()
  const queryClient = useQueryClient()
  const me = useMe().data
  const tray = useTray()
  const [now, setNow] = useState(() => new Date())
  const [uploads, setUploads] = useState<Upload[]>([])
  const [problem, setProblem] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | undefined>()
  /** The sends (tray, original and analysis) are folded until the person opens them; the header carries their state. */
  const [trayOpen, setTrayOpen] = useState(false)
  /** The original of a send, open or folded, when the person chose; else open while it is analyzed and folded once ready. */
  const [originalChoice, setOriginalChoice] = useState<Readonly<Record<string, boolean>>>({})
  /** Sends already published or discarded here, hidden until the server's list catches up. */
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set())
  const events = useEventsSnapshot()
  const publishRef = useRef<(() => void) | null>(null)
  const lastIndex = useRef(0)

  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 15_000)
    return () => clearInterval(tick)
  }, [])

  // The tray follows the stream: a job that starts and a job that ends both bring the list up to date, so the state of a row is never older than its progress bar.
  const started = Object.keys(events.progress).length
  const ended = Object.values(events.progress).filter((p) => p.done).length
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ['inputs'] })
  }, [started, ended, queryClient])

  const inputs = useMemo(() => (tray.data ?? []).filter((i) => !gone.has(i.id)), [tray.data, gone])

  // The review opens on the first send that is ready and, when the one in view goes out, on the next one.
  useEffect(() => {
    const at = inputs.findIndex((i) => i.id === selectedId)
    if (at >= 0) {
      lastIndex.current = at
      return
    }
    const next = inputs.slice(lastIndex.current).find((i) => i.status === 'proposed') ?? inputs.find((i) => i.status === 'proposed') ?? inputs[0]
    setSelectedId(next?.id)
  }, [inputs, selectedId])

  /** Uploads one send; the bar is already empty. A failure keeps the draft in its row so the text is never lost. */
  const upload = useCallback(
    async (key: string, draft: SendDraft) => {
      setUploads((list) => list.map((u) => (u.key === key ? { ...u, error: undefined, progress: 0 } : u)))
      try {
        await uploadInput({ text: draft.text, files: draft.files, links: draft.links }, (progress) => setUploads((list) => list.map((u) => (u.key === key ? { ...u, progress } : u))))
        setUploads((list) => list.filter((u) => u.key !== key))
        await queryClient.invalidateQueries({ queryKey: ['inputs'] })
      } catch (err) {
        const reason = errorText(err)
        setUploads((list) => list.map((u) => (u.key === key ? { ...u, error: reason } : u)))
        setProblem(reason)
      }
    },
    [errorText, queryClient],
  )

  const submit = (draft: SendDraft) => {
    const key = crypto.randomUUID()
    setProblem(null)
    setUploads((list) => [...list, { key, draft, at: new Date().toISOString(), progress: 0 }])
    void upload(key, draft)
  }

  const items = useMemo<TrayItem[]>(() => {
    const sending: TrayItem[] = uploads.map((u): TrayItem => {
      const pending: PendingUpload = {
        key: u.key,
        text: u.draft.text,
        at: u.at,
        progress: u.progress,
        error: u.error,
        onRetry: () => void upload(u.key, u.draft),
        onDiscard: () => setUploads((list) => list.filter((x) => x.key !== u.key)),
      }
      return { kind: 'upload', upload: pending }
    })
    return [...inputs.map((input): TrayItem => ({ kind: 'input', input })), ...sending]
  }, [inputs, uploads, upload])

  const finished = () => {
    if (selectedId) setGone((set) => new Set(set).add(selectedId))
    setSelectedId(undefined)
    void queryClient.invalidateQueries({ queryKey: ['inputs'] })
  }

  // Keyboard through the tray: J or ArrowDown to the next send, K or ArrowUp to the previous, Enter publishes the one in view.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return
      const move = e.key === 'j' || e.key === 'ArrowDown' ? 1 : e.key === 'k' || e.key === 'ArrowUp' ? -1 : 0
      if (move !== 0 && inputs.length > 0) {
        e.preventDefault()
        const at = Math.max(0, inputs.findIndex((i) => i.id === selectedId))
        setSelectedId(inputs[Math.min(inputs.length - 1, Math.max(0, at + move))].id)
      } else if (e.key === 'Enter' && publishRef.current) {
        e.preventDefault()
        publishRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [inputs, selectedId])

  const registerPublish = useCallback((fn: (() => void) | null) => {
    publishRef.current = fn
  }, [])

  const selected = inputs.find((i) => i.id === selectedId)
  // The original of a send is folded unless the person opens it (UD-030).
  const originalOpen = !!selected && (originalChoice[selected.id] ?? false)
  const working = items.length > 0

  return (
    <Page cols={12}>
      {/* The header already says the project's name: the page does not repeat it (UD-026). */}
      <h1 className="sr-only">{t('nav.home')}</h1>
      <section aria-label={t('home.new')} className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h2>{t('home.new')}</h2>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
            <time dateTime={now.toISOString()}>
              {format.longDate(now)} <span className="text-accent-deep">{format.clock(now)}</span>
            </time>
          </p>
        </div>
        <ComposeBar onSubmit={submit} problem={problem} />
      </section>

      {working && (
        <Dialog open={trayOpen} onOpenChange={setTrayOpen}>
          {/* One control, folded: the state of the sends is in its face, and the review opens over the page without moving it. */}
          <DialogTrigger asChild>
            <button type="button" data-testid="tray-control" className="glass leaf flex w-full shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left hover:bg-glass-edge">
              <ChevronRight size={16} aria-hidden className="shrink-0" />
              <span className="text-sm font-bold">{t('tray.title')}</span>
              <TrayState items={items} />
              <span className="ml-auto text-xs text-muted">{t('tray.unfold')}</span>
            </button>
          </DialogTrigger>
          <DialogContent title={t('tray.title')} data-keys-ok="" onOpenAutoFocus={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement).focus() }} className="h-[min(88dvh,54rem)] max-w-[72rem]">
            <div className="grid min-h-0 flex-1 gap-x-6 gap-y-4 overflow-y-auto p-4 md:grid-cols-[minmax(0,3fr)_minmax(0,9fr)] md:grid-rows-[minmax(0,1fr)] md:overflow-visible" data-lane="tray-dialog">
              <Tray items={items} selectedId={selectedId} hideTextId={originalOpen ? selectedId : undefined} onSelect={setSelectedId} bare />
              <div className="flex min-h-0 min-w-0 flex-col border-line md:border-l md:pl-6">
                <ReviewPane inputId={selectedId} originalOpen={originalOpen} onToggleOriginal={() => selected && setOriginalChoice((c) => ({ ...c, [selected.id]: !originalOpen }))} onClose={finished} registerPublish={registerPublish} />
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      <Attention />

      {/* The main block of the page (UD-030): the latest messages and replies, always in view. */}
      <div className="grid min-h-[22rem] flex-1 gap-x-5 gap-y-4 md:min-h-0 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] md:grid-rows-[minmax(0,1fr)]">
        <Feed kind="messages" meId={me?.id ?? ''} />
        <Feed kind="replies" meId={me?.id ?? ''} />
      </div>

    </Page>
  )
}

/** The state of the sends in the folded header: how many wait for review, how many are running, how many failed. */
function TrayState({ items }: { items: readonly TrayItem[] }) {
  const t = useT()
  const review = items.filter((i) => i.kind === 'input' && i.input.status === 'proposed').length
  const failed = items.filter((i) => (i.kind === 'input' && i.input.status === 'failed') || (i.kind === 'upload' && i.upload.error)).length
  const running = items.length - review - failed
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {review > 0 && <Badge tone="accent">{t('tray.review', { n: review })}</Badge>}
      {running > 0 && <Badge tone="answered">{t('tray.running', { n: running })}</Badge>}
      {failed > 0 && <Badge tone="danger">{t('tray.failed', { n: failed })}</Badge>}
    </span>
  )
}

/**
 * What affects me, at the top of the page (UD-030): the big badge in the color of the highest priority, one chip
 * per priority with its count and the pending of each area. Each chip leads to Mensajes already filtered.
 */
function Attention() {
  const t = useT()
  const summary = useSummary().data
  const { areaTitle } = useLookups()
  const counts = mineCounts(summary)
  const tone = topTone(counts)
  const areas = (summary?.areas ?? []).filter((a) => a.open > 0)
  const mineParams = (status: string) => serializeQuery({ filters: [{ prop: 'for', op: 'eq', value: ME }, { prop: 'status', op: 'eq', value: status }], q: '' }).toString()
  return (
    <section aria-label={t('home.mine')} data-testid="attention" data-tone-top={tone ?? 'none'} className="glass leaf flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5">
      <div className="flex items-center gap-2.5">
        <h2>{t('home.mine')}</h2>
        {tone ? <NotifyBadge counts={counts} data-testid="attention-badge" /> : <span className="text-sm text-muted">{t('home.mineNone')}</span>}
      </div>
      {tone && (
        <ul className="flex flex-wrap items-center gap-1.5">
          {(counts.red ?? 0) > 0 && (
            <li>
              <Link to={`/messages?${mineParams('open')}`} className="rounded-full">
                <ToneMark tone="red" n={counts.red} />
              </Link>
            </li>
          )}
          {(counts.yellow ?? 0) > 0 && (
            <li>
              <Link to={`/messages?${mineParams('answered')}`} className="rounded-full">
                <ToneMark tone="yellow" n={counts.yellow} />
              </Link>
            </li>
          )}
          {(counts.blue ?? 0) > 0 && (
            <li>
              <ToneMark tone="blue" n={counts.blue} />
            </li>
          )}
        </ul>
      )}
      {areas.length > 0 && (
        <nav aria-label={t('home.byArea')} className="flex min-w-0 items-start gap-2 md:ml-auto">
          <span className="shrink-0 pt-1 text-xs font-semibold uppercase tracking-[0.12em] text-muted">{t('home.byArea')}</span>
          {/* With many areas the chips scroll inside two rows: a declared lane, not the page. */}
          <ul data-lane="area-pending" className="scroll-thin flex max-h-[4.25rem] min-w-0 flex-wrap items-center gap-1.5 overflow-y-auto">
            {areas.map((a) => (
              <li key={a.area_id}>
                <Link to={areaMessagesPath(a.area_id)} aria-label={t('home.areaOpen', { title: areaTitle(a.area_id), n: a.open })} data-testid="area-pending" className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-glass-strong py-0.5 pl-2.5 pr-0.5 text-xs font-semibold hover:bg-glass-edge">
                  <span className="min-w-0 break-words">{areaTitle(a.area_id)}</span>
                  <NotifyBadge counts={areaPendingCounts(summary, a.area_id)} size="md" />
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </section>
  )
}

function Feed({ kind, meId }: { kind: 'messages' | 'replies'; meId: string }) {
  const t = useT()
  const [mine, setMine] = useState(true)
  const query: MessageQuery = { filters: mine ? [{ prop: 'for', op: 'eq', value: ME }] : [], q: '' }
  const feed = useMessages({ query, meId, repliesFeed: kind === 'replies', enabled: !!meId })
  const rows = useMemo(() => feed.data ?? [], [feed.data])
  const messagesFeed = kind === 'messages'

  const params = new URLSearchParams()
  if (mine) params.append('f', `for:eq:${ME}`)
  if (!messagesFeed) params.append('f', 'replies:eq:con')

  return (
    <section aria-label={messagesFeed ? t('home.latestMessages') : t('home.latestReplies')} className="glass leaf flex min-h-0 min-w-0 flex-col gap-2 px-1 pb-1 pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3">
        <h2 className="text-base">
          <Link to={`/messages?${params.toString()}`} className="hover:underline">
            {messagesFeed ? t('home.latestMessages') : t('home.latestReplies')}
          </Link>
        </h2>
        <Segmented
          label={messagesFeed ? t('home.shownMessages') : t('home.shownReplies')}
          size="sm"
          value={mine ? 'mine' : 'all'}
          onChange={(v) => setMine(v === 'mine')}
          options={[
            { value: 'mine', label: messagesFeed ? t('home.forMe') : t('home.involveMe') },
            { value: 'all', label: messagesFeed ? t('home.everyone') : t('home.all') },
          ]}
        />
      </div>
      <FitList
        bare
        rows={rows}
        rowKey={(m) => m.id}
        renderRow={(m) => <MessageCard message={m} variant={messagesFeed ? 'message' : 'reply'} />}
        empty={<p className="px-3 py-6 text-center text-sm text-muted">{feed.isPending ? t('common.loading') : messagesFeed ? t('home.noMessages') : t('home.noReplies')}</p>}
      />
    </section>
  )
}
