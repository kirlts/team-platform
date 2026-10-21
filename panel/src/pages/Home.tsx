import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { AlertTriangle, ChevronRight } from '@/components/icons'
import { AreaChips } from '@/components/AreaChips'
import { Meter } from '@/components/Meter'
import { useNotices } from '@/lib/notices'
import { sendPercent } from '@/lib/progress'
import { ComposeBar, type SendDraft } from '@/components/ComposeBar'
import { useLookups } from '@/components/lookups'
import { StateMark, useCountsLabel, usePulse } from '@/components/NotifyBadge'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import { FitList } from '@/components/FitList'
import { LoadState } from '@/components/LoadState'
import { MessageCard } from '@/components/MessageCard'
import { Page } from '@/components/Page'
import { NoticeHost } from '@/components/NoticeHost'
import { ReviewPane } from '@/components/ReviewPane'
import { Segmented } from '@/components/Segmented'
import { Tray, type PendingUpload, type TrayItem } from '@/components/Tray'
import { useErrorText, useT } from '@/i18n'
import { ME, serializeQuery, type MessageQuery } from '@/lib/filters'
import { areaCounts, areaMessagesPath, mineCounts } from '@/lib/pending'
import { topState } from '@/lib/states'
import { useEventsSnapshot } from '@/lib/events'
import { useMe, useMessages, useSummary, useTray } from '@/lib/queries'
import { uploadInput } from '@/lib/upload'
import { useDesktop } from '@/lib/useDesktop'

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
  const errorText = useErrorText()
  const queryClient = useQueryClient()
  const me = useMe().data
  const desktop = useDesktop()
  const [feedTab, setFeedTab] = useState<'messages' | 'replies'>('messages')
  const tray = useTray()
  const [uploads, setUploads] = useState<Upload[]>([])
  const [problem, setProblem] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | undefined>()
  /** The sends (tray, original and analysis) are folded until the person opens them; the header carries their state. */
  const [trayOpen, setTrayOpen] = useState(false)
  /** On a phone, whether the list of sends is open above the review. */
  const [listOpen, setListOpen] = useState(false)
  /** The original of a send, open or folded, when the person chose; else open while it is analyzed and folded once ready. */
  const [originalChoice, setOriginalChoice] = useState<Readonly<Record<string, boolean>>>({})
  /** Sends already published or discarded here, hidden until the server's list catches up. */
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set())
  const events = useEventsSnapshot()
  const lastIndex = useRef(0)
  const notices = useNotices()
  /** A send was published or discarded here: the next selection continues the order instead of starting over. */
  const advance = useRef(false)
  /** The send just discarded keeps its place in the window with its own Deshacer; nothing else is opened in its stead (J2-B-22). */
  const [discarded, setDiscarded] = useState<{ id: string; restore: () => Promise<unknown> } | null>(null)

  // The tray follows the stream: a job that starts and a job that ends both bring the list up to date, so the state of a row is never older than its progress bar.
  const started = Object.keys(events.progress).length
  const ended = Object.values(events.progress).filter((p) => p.done).length
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ['inputs'] })
  }, [started, ended, queryClient])

  const inputs = useMemo(() => (tray.data ?? []).filter((i) => !gone.has(i.id)), [tray.data, gone])

  // The review opens on the send that needs the person and is the most recent (ready or failed), never on an old one (J2-B-10);
  // when the one in view goes out it continues with the next ready one, in order of arrival.
  useEffect(() => {
    const at = inputs.findIndex((i) => i.id === selectedId)
    if (at >= 0) {
      lastIndex.current = at
      return
    }
    if (discarded) return
    const waiting = inputs.filter((i) => i.status === 'proposed' || i.status === 'failed')
    const next = advance.current
      ? (inputs.slice(lastIndex.current).find((i) => i.status === 'proposed') ?? inputs.find((i) => i.status === 'proposed') ?? inputs[0])
      : (waiting.at(-1) ?? inputs.at(-1))
    if (next) advance.current = false
    setSelectedId(next?.id)
  }, [inputs, selectedId, discarded])

  // A send that becomes ready while the window is folded says so where the person is looking (J2-B-07).
  const readyCount = inputs.filter((i) => i.status === 'proposed').length
  const readyBefore = useRef<number | null>(null)
  useEffect(() => {
    if (!tray.data) return
    const before = readyBefore.current
    readyBefore.current = readyCount
    if (before !== null && readyCount > before && !trayOpen) notices.show({ text: t('tray.readyNotice', { n: readyCount }), action: { label: t('tray.readyOpen'), run: () => setTrayOpen(true) } })
  }, [readyCount, tray.data]) // eslint-disable-line react-hooks/exhaustive-deps

  // A send that fails says so as an error, with the way to it: a pale chip in the folded control is not enough for something that needs the person (J3-B-14).
  const failedCount = inputs.filter((i) => i.status === 'failed').length
  const failedBefore = useRef<number | null>(null)
  useEffect(() => {
    if (!tray.data) return
    const before = failedBefore.current
    failedBefore.current = failedCount
    if (before !== null && failedCount > before && !trayOpen) notices.show({ tone: 'danger', text: t('tray.failedNotice', { n: failedCount }), action: { label: t('tray.readyOpen'), run: () => setTrayOpen(true) } })
  }, [failedCount, tray.data]) // eslint-disable-line react-hooks/exhaustive-deps

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
    advance.current = true
    if (selectedId) setGone((set) => new Set(set).add(selectedId))
    setSelectedId(undefined)
    void queryClient.invalidateQueries({ queryKey: ['inputs'] })
  }

  // Keyboard through the tray: J or ArrowDown to the next send, K or ArrowUp to the previous. Enter never publishes from here: publishing is a click on Enviar (J2-B-13).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return
      const move = e.key === 'j' || e.key === 'ArrowDown' ? 1 : e.key === 'k' || e.key === 'ArrowUp' ? -1 : 0
      if (move !== 0 && inputs.length > 0) {
        e.preventDefault()
        const at = Math.max(0, inputs.findIndex((i) => i.id === selectedId))
        setSelectedId(inputs[Math.min(inputs.length - 1, Math.max(0, at + move))].id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [inputs, selectedId])

  const selected = inputs.find((i) => i.id === selectedId)
  // The original of a send is folded unless the person opens it (UD-030).
  const originalOpen = !!selected && (originalChoice[selected.id] ?? false)
  const working = items.length > 0
  useEffect(() => {
    if (!working) setTrayOpen(false)
  }, [working])

  return (
    <Page cols={12}>
      {/* The header already says the project's name: the page does not repeat it (UD-026). */}
      <h1 className="sr-only">{t('nav.home')}</h1>
      <Dialog
        open={trayOpen && working}
        onOpenChange={(open) => {
          setTrayOpen(open)
          // Opening the window lands on the most recent send that needs the person, whatever was selected before (J2-B-10).
          if (open) {
            setDiscarded(null)
            const waiting = inputs.filter((i) => i.status === 'proposed' || i.status === 'failed')
            const next = waiting.at(-1) ?? inputs.at(-1)
            if (next) setSelectedId(next.id)
          }
        }}
      >
        <section aria-label={t('home.new')} className="flex flex-col gap-2">
          {/* The row keeps its height with or without sends, so the control appearing moves nothing (J2-B-08). */}
          <div className="flex min-h-9 items-center justify-between gap-x-6">
            <h2>{t('home.new')}</h2>
            <div className="flex min-w-0 items-center gap-4">
              {working && (
                <DialogTrigger asChild>
                  {/* One control, folded and shaped as a button: the state and the progress of the sends are in its face (J2-B-07). */}
                  <button type="button" data-testid="tray-control" className="btn btn-glass relative h-9 min-w-0 gap-x-2.5 overflow-hidden !border-accent !bg-accent-soft/70 px-3.5 pb-1.5 text-left">
                    <span className="text-sm font-bold">{t('tray.title')}</span>
                    <TrayState items={items} progress={events.progress} />
                    <ChevronRight size={16} aria-hidden className="shrink-0" />
                  </button>
                </DialogTrigger>
              )}
            </div>
          </div>
          <ComposeBar onSubmit={submit} problem={problem} />
        </section>
        {working && (
          <DialogContent title={t('tray.title')} data-keys-ok="" onOpenAutoFocus={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement).focus() }} className={`h-[min(88dvh,54rem)] max-w-[72rem] max-md:left-0 max-md:top-0 max-md:h-dvh max-md:max-h-none max-md:w-screen max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-none`}>
            <NoticeHost inDialog />
            <div className="grid min-h-0 flex-1 content-start gap-x-6 gap-y-3 overflow-y-auto p-4 md:grid-cols-[minmax(0,3fr)_minmax(0,9fr)] md:grid-rows-[minmax(0,1fr)] md:overflow-visible" data-lane="tray-dialog">
              {/* On a phone the list folds behind the send in view, so the proposal gets the screen (J2-B-11). */}
              <div className="flex min-h-0 min-w-0 flex-col gap-2">
                {/* With one send there is nothing to choose between: on a phone the list is not drawn at all (J3-B-25). */}
                {items.length > 1 && (
                  <button type="button" aria-expanded={listOpen} onClick={() => setListOpen((v) => !v)} className="btn btn-glass h-9 w-full justify-between px-3 md:hidden">
                    <span className="min-w-0 text-sm font-semibold">{t('tray.pending', { n: items.length })}</span>
                    <ChevronRight size={16} aria-hidden className={listOpen ? 'rotate-90' : ''} />
                  </button>
                )}
                <div className={listOpen && items.length > 1 ? 'flex min-h-0 flex-1 flex-col' : 'flex min-h-0 flex-1 flex-col max-md:hidden'}>
                  <Tray items={items} selectedId={selectedId} hideTextId={originalOpen ? selectedId : undefined} onSelect={(id) => { setDiscarded(null); setSelectedId(id); setListOpen(false) }} bare />
                </div>
              </div>
              <div className="flex min-h-0 min-w-0 flex-col border-line md:border-l md:pl-6">
                <ReviewPane
                  inputId={selectedId}
                  originalOpen={originalOpen}
                  onToggleOriginal={() => selected && setOriginalChoice((c) => ({ ...c, [selected.id]: !originalOpen }))}
                  onClose={finished}
                  onDiscarded={(id, restore) => {
                    // With other sends in the window, the discarded one stays as a placeholder with Deshacer; alone, the notice says it and brings the window back with the send.
                    if (inputs.filter((i) => i.id !== id).length === 0) {
                      notices.show({ text: t('discard.done'), action: { label: t('undo.undo'), run: async () => { await restore(); setTrayOpen(true) } } })
                      return true
                    }
                    setGone((set) => new Set(set).add(id))
                    setSelectedId(undefined)
                    setDiscarded({ id, restore })
                    return true
                  }}
                  discarded={discarded ? { onUndo: async () => { await discarded.restore(); setGone((set) => { const next = new Set(set); next.delete(discarded.id); return next }); setSelectedId(discarded.id); setDiscarded(null) } } : undefined}
                />
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>

      <Attention />

      {/* The main block of the page (UD-030): the latest messages and replies, always in view. On a phone one list at a time, in a frame as tall as the screen (J3-A-10). */}
      {desktop ? (
        <div className="grid min-h-[22rem] flex-1 gap-x-5 gap-y-4 md:min-h-0 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] md:grid-rows-[minmax(0,1fr)]">
          <Feed kind="messages" meId={me?.id ?? ''} />
          <Feed kind="replies" meId={me?.id ?? ''} />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Segmented
            label={t('home.shownFeed')}
            value={feedTab}
            onChange={setFeedTab}
            options={[
              { value: 'messages', label: t('home.latestMessages') },
              { value: 'replies', label: t('home.latestReplies') },
            ]}
          />
          <Feed key={feedTab} kind={feedTab} meId={me?.id ?? ''} phone />
        </div>
      )}

    </Page>
  )
}

/** The state of the sends in the folded control: how many wait for review, how many run (with their progress), how many failed. */
function TrayState({ items, progress }: { items: readonly TrayItem[]; progress: Readonly<Record<string, { percent: number }>> }) {
  const t = useT()
  const review = items.filter((i) => i.kind === 'input' && i.input.status === 'proposed').length
  const failed = items.filter((i) => (i.kind === 'input' && i.input.status === 'failed') || (i.kind === 'upload' && i.upload.error)).length
  const running = items.length - review - failed
  // The bar of the sends in progress: the mean of each one's own figure; with none started it travels (indeterminate).
  const figures = items.flatMap((i) => (i.kind === 'upload' ? (i.upload.error ? [] : [Math.round(i.upload.progress * 100)]) : ['proposed', 'failed'].includes(i.input.status) ? [] : [sendPercent(i.input, progress[i.input.job_id ?? ''])]))
  const mean = figures.length ? Math.round(figures.reduce((n, v) => n + v, 0) / figures.length) : 0
  const pulse = usePulse(review)
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {review > 0 && (
        <span data-pulse={pulse} className="rounded-full">
          <Badge tone="accent">{t('tray.review', { n: review })}</Badge>
        </span>
      )}
      {running > 0 && (
        <>
          <Badge tone="neutral">{t('tray.running', { n: running })}</Badge>
          <Meter percent={mean} label={t('analysis.progress')} className="absolute inset-x-3.5 bottom-1 h-1" />
        </>
      )}
      {failed > 0 && (
        <Badge tone="danger" className="gap-1 border border-danger">
          <AlertTriangle size={12} aria-hidden strokeWidth={2.4} />
          {t('tray.failed', { n: failed })}
        </Badge>
      )}
    </span>
  )
}

/**
 * What affects me, at the top of the page (UD-030): one chip per priority with its count and one per area with
 * what is open or answered in it. Both rows use the same chip, quiet (UD-036), and the same kind of label; each chip leads to
 * Mensajes already filtered (UD-028). The areas take one row: those that do not fit fold behind «+N» (J3-A-06, J3-A-10).
 */
function Attention() {
  const t = useT()
  const summary = useSummary().data
  const { areaTitle } = useLookups()
  const counts = mineCounts(summary)
  const label = useCountsLabel()
  const top = topState(counts)
  const areas = (summary?.areas ?? []).filter((a) => a.open + a.answered > 0)
  const mineParams = (status: string) => serializeQuery({ filters: [{ prop: 'for', op: 'eq', value: ME }, { prop: 'status', op: 'eq', value: status }], q: '' }).toString()
  return (
    <section aria-label={t('home.mine')} data-testid="attention" data-state-top={top ?? 'none'} className="glass leaf grid grid-cols-1 items-center gap-x-4 gap-y-1 px-4 py-2.5 md:grid-cols-[auto_minmax(0,1fr)] md:gap-y-2">
      <h2 className="min-w-16">{t('home.mine')}</h2>
      <div className="flex min-h-6 items-center">
        {!top ? (
          <span className="text-sm text-muted">{t('home.mineNone')}</span>
        ) : (
          <ul className="flex flex-wrap items-center gap-1.5">
            {(['open', 'answered'] as const).map(
              (status) =>
                (counts[status] ?? 0) > 0 && (
                  <li key={status}>
                    <Link to={`/messages?${mineParams(status)}`} className="rounded-full">
                      <StateMark status={status} n={counts[status]} />
                    </Link>
                  </li>
                ),
            )}
          </ul>
        )}
      </div>
      {/* The row is always there, with the height of one chip: an area that gets something pending does not push the lists down (J3-B-15). */}
      {areas.length === 0 ? (
        <div aria-hidden className="min-h-6 md:col-span-2" />
      ) : (
        <>
          <h2 className="min-w-16 max-md:mt-1.5">{t('home.byArea')}</h2>
          <AreaChips
            chips={areas.map((a) => (
              <span key={a.area_id} data-testid="area-pending" className="inline-flex min-h-6 max-w-[24rem] flex-wrap items-center gap-x-1.5 rounded-2xl border border-line-strong px-2 py-px text-xs font-semibold leading-tight">
                <span className="min-w-0 break-words">{areaTitle(a.area_id)}</span>
                {(['open', 'answered'] as const).map(
                  (status) =>
                    areaCounts(summary, a.area_id)[status] > 0 && (
                      <Link key={status} to={areaMessagesPath(a.area_id, status)} aria-label={t('areas.countOf', { title: areaTitle(a.area_id), count: label({ [status]: areaCounts(summary, a.area_id)[status] }) })} className="rounded-full hover:bg-glass-edge">
                        <StateMark status={status} n={areaCounts(summary, a.area_id)[status]} plain />
                      </Link>
                    ),
                )}
              </span>
            ))}
          />
        </>
      )}
    </section>
  )
}

function Feed({ kind, meId, phone = false }: { kind: 'messages' | 'replies'; meId: string; phone?: boolean }) {
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
    // On a phone the frame is as tall as what is left of the screen under the header and the page margins, and the list pages inside it (J3-A-10).
    <section aria-label={messagesFeed ? t('home.latestMessages') : t('home.latestReplies')} className={`glass leaf flex min-h-0 min-w-0 flex-col gap-2 px-1 pb-1 pt-3 ${phone ? 'h-[calc(100dvh-6.5rem)]' : ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-3">
        {/* On a phone the switch above already names the list. */}
        <h2 className={phone ? 'sr-only' : 'text-base'}>
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
        pagedOnPhone={phone}
        rows={rows}
        rowKey={(m) => m.id}
        renderRow={(m) => <MessageCard message={m} variant={messagesFeed ? 'message' : 'reply'} />}
        empty={feed.isPending || feed.isError ? <LoadState query={feed} rows={2} /> : <p className="px-3 py-6 text-center text-sm text-muted">{messagesFeed ? t('home.noMessages') : t('home.noReplies')}</p>}
      />
    </section>
  )
}
