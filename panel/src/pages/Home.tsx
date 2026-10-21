import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { cn } from '@/lib/utils'
import { AlertTriangle, ChevronDown } from '@/components/icons'
import { AreaChips } from '@/components/AreaChips'
import { Meter } from '@/components/Meter'
import { useNotices } from '@/lib/notices'
import { sendPercent } from '@/lib/progress'
import { ComposeBar, type SendDraft } from '@/components/ComposeBar'
import { useLookups } from '@/components/lookups'
import { StateMark, useCountsLabel, usePulse } from '@/components/NotifyBadge'
import { Badge } from '@/components/ui/badge'
import { FitList } from '@/components/FitList'
import { LoadState } from '@/components/LoadState'
import { MessageCard } from '@/components/MessageCard'
import { Page } from '@/components/Page'
import { SendDrawer } from '@/components/SendDrawer'
import { Segmented } from '@/components/Segmented'
import { type PendingUpload, type TrayItem } from '@/components/Tray'
import { useErrorText, useFormat, useT } from '@/i18n'
import { ME, serializeQuery, type MessageQuery } from '@/lib/filters'
import { areaCounts, areaMessagesPath, mineCounts } from '@/lib/pending'
import { topState } from '@/lib/states'
import { useEventsSnapshot } from '@/lib/events'
import { useMe, useMessages, useProject, useSends, useSummary } from '@/lib/queries'
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
  // The drawer of the sends is not a dialog: its keys work in it, but not inside a dialog that is open over the page (the gallery).
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
  const project = useProject().data
  const desktop = useDesktop()
  const [feedTab, setFeedTab] = useState<'messages' | 'replies'>('messages')
  const tray = useSends()
  const [uploads, setUploads] = useState<Upload[]>([])
  const [problem, setProblem] = useState<string | null>(null)
  /** The send in view: the key of an upload that is still going up, or the id of an input the server already has. */
  const [selectedId, setSelectedId] = useState<string | undefined>()
  /** The drawer under the bar (UD-046): it opens by itself when something is sent and the person can fold it; the control above carries the state of the sends. */
  const [drawerOpen, setDrawerOpen] = useState(false)
  /** Sends already published or discarded here, hidden until the server's list catches up. */
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set())
  const events = useEventsSnapshot()
  const notices = useNotices()
  /** The person just sent something: the drawer moves to that send as soon as the server has it, whatever else is waiting for review. */
  const followNew = useRef(false)
  /** The inputs the server had when the last send went out: the first one that is not in it is that send. */
  const knownIds = useRef<ReadonlySet<string>>(new Set())
  /** The send just discarded keeps its place in the drawer with its own Deshacer; nothing else is opened in its stead (J2-B-22). */
  const [discarded, setDiscarded] = useState<{ id: string; restore: () => Promise<unknown> } | null>(null)

  // The tray follows the stream: a job that starts and a job that ends both bring the list up to date, so the state of a row is never older than its progress bar.
  const started = Object.keys(events.progress).length
  const ended = Object.values(events.progress).filter((p) => p.done).length
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ['inputs'] })
  }, [started, ended, queryClient])

  const inputs = useMemo(() => (tray.data ?? []).filter((i) => !gone.has(i.id)), [tray.data, gone])

  const items = useMemo<TrayItem[]>(() => {
    const sending: TrayItem[] = uploads.map((u): TrayItem => {
      const pending: PendingUpload = {
        key: u.key,
        text: u.draft.text,
        names: [...u.draft.files.map((f) => f.name), ...u.draft.links],
        at: u.at,
        progress: u.progress,
        error: u.error,
        onRetry: () => void upload(u.key, u.draft),
        onDiscard: () => setUploads((list) => list.filter((x) => x.key !== u.key)),
      }
      return { kind: 'upload', upload: pending }
    })
    // Newest first, as the history is: what is still going up is the newest of all.
    return [...sending.reverse(), ...inputs.map((input): TrayItem => ({ kind: 'input', input }))]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputs, uploads])
  const ids = useMemo(() => items.map((i) => (i.kind === 'upload' ? i.upload.key : i.input.id)), [items])

  // The drawer opens on the send the person just made, and otherwise on the newest one (UD-070): the history is the list, newest first.
  useEffect(() => {
    if (followNew.current) {
      const fresh = inputs.filter((i) => !knownIds.current.has(i.id)).at(-1)
      if (fresh) {
        followNew.current = false
        setDiscarded(null)
        setSelectedId(fresh.id)
        return
      }
      // While the upload is going up it is the send in view.
      if (selectedId && ids.includes(selectedId)) return
    }
    if (ids.includes(selectedId ?? '')) return
    if (discarded) return
    // The drawer opens on the newest send; the control already says if an older one failed or waits.
    setSelectedId(inputs[0]?.id)
  }, [inputs, ids, selectedId, discarded])

  // A send that becomes ready while the drawer is folded says so where the person is looking (J2-B-07).
  const readyCount = inputs.filter((i) => i.status === 'proposed').length
  const readyBefore = useRef<number | null>(null)
  useEffect(() => {
    if (!tray.data) return
    const before = readyBefore.current
    readyBefore.current = readyCount
    if (before !== null && readyCount > before && !drawerOpen) notices.show({ text: t('tray.readyNotice', { n: readyCount }), action: { label: t('tray.readyOpen'), run: () => setDrawerOpen(true) } })
  }, [readyCount, tray.data]) // eslint-disable-line react-hooks/exhaustive-deps

  // A send that is published while the drawer is folded says so where the person is looking, with the way to it.
  const publishedCount = inputs.filter((i) => i.status === 'published').length
  const publishedBefore = useRef<number | null>(null)
  useEffect(() => {
    if (!tray.data) return
    const before = publishedBefore.current
    publishedBefore.current = publishedCount
    if (before !== null && publishedCount > before && !drawerOpen) notices.show({ text: t('tray.publishedNotice', { n: publishedCount - before }), action: { label: t('tray.readyOpen'), run: () => setDrawerOpen(true) } })
  }, [publishedCount, tray.data]) // eslint-disable-line react-hooks/exhaustive-deps

  // A send that fails says so as an error, with the way to it: a pale chip in the folded control is not enough for something that needs the person (J3-B-14).
  const failedCount = inputs.filter((i) => i.status === 'failed').length
  const failedBefore = useRef<number | null>(null)
  useEffect(() => {
    if (!tray.data) return
    const before = failedBefore.current
    failedBefore.current = failedCount
    if (before !== null && failedCount > before && !drawerOpen) notices.show({ tone: 'danger', text: t('tray.failedNotice', { n: failedCount }), action: { label: t('tray.readyOpen'), run: () => setDrawerOpen(true) } })
  }, [failedCount, tray.data]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Uploads one send; the bar is already empty. A failure keeps the draft in its row so the text is never lost. */
  const upload = useCallback(
    async (key: string, draft: SendDraft) => {
      setUploads((list) => list.map((u) => (u.key === key ? { ...u, error: undefined, progress: 0 } : u)))
      try {
        await uploadInput({ text: draft.text, files: draft.files, links: draft.links }, (progress) => setUploads((list) => list.map((u) => (u.key === key ? { ...u, progress } : u))))
        // The server's list first, then the upload leaves: the send passes from one to the other without a moment in which it is neither.
        await queryClient.invalidateQueries({ queryKey: ['inputs'] })
        setUploads((list) => list.filter((u) => u.key !== key))
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
    // What was sent is shown in the drawer under the bar, at once and without another click (UD-046).
    knownIds.current = new Set((tray.data ?? []).map((i) => i.id))
    followNew.current = true
    setDiscarded(null)
    setSelectedId(key)
    setDrawerOpen(true)
    void upload(key, draft)
  }

  /** A proposal the system could not publish by itself was published by hand: the send stays in view, now as published. */
  const finished = () => {
    void queryClient.invalidateQueries({ queryKey: ['inputs'] })
  }

  // Keyboard through the sends: J or ArrowDown to the next send, K or ArrowUp to the previous. Enter never publishes from here: publishing is a click on Enviar (J2-B-13).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return
      const move = e.key === 'j' || e.key === 'ArrowDown' ? 1 : e.key === 'k' || e.key === 'ArrowUp' ? -1 : 0
      if (move !== 0 && ids.length > 1) {
        e.preventDefault()
        const at = Math.max(0, ids.indexOf(selectedId ?? ''))
        setSelectedId(ids[Math.min(ids.length - 1, Math.max(0, at + move))])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ids, selectedId])

  // The drawer is drawn only while there is something in it. Its open state is not reset when the list is empty for a moment: a send passes from the
  // browser's upload to the server's list in two steps (the cache notifies after the upload leaves), and that gap must not fold it.
  const working = items.length > 0

  // With a send open the page is taller than the window and its region scrolls (UD-110, which amends UD-017); at rest it fits.
  const shown = working && drawerOpen && desktop

  return (
    <Page cols="inicio" airy scrolls={shown}>
      {/* From top to bottom (mockup, UD-046): what affects me, the project and the date, the bar to write, the drawer with what was sent and how it was analyzed, and the latest messages and replies. */}
      <Attention />

      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-0.5">
        {/* The header says the project's name too: this is the page's title (the mockup has both), so the repeat is declared. */}
        <h1 data-repeat-ok="page-title" className="min-w-0 break-words">
          {project?.name ?? me?.project_name ?? t('nav.home')}
        </h1>
        <time dateTime={new Date().toISOString()} className="text-sm tabular-nums text-muted">
          {format.longDate(new Date())}
        </time>
      </div>

      <section aria-label={t('home.new')} className="mx-auto flex w-full max-w-compose flex-col gap-3 md:py-block [@media(min-height:1000px)]:md:py-section">
        {/* The row keeps its height with or without sends, so the control appearing moves nothing (J2-B-08). */}
        <div className="flex min-h-7 items-center justify-between gap-x-6">
          <h2>{t('home.new')}</h2>
          {working && (
            // One control, shaped as a button: the state and the progress of the sends are in its face, and it folds and unfolds the drawer (J2-B-07).
            <button
              type="button"
              data-testid="tray-control"
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen((v) => !v)}
              className="btn relative h-7 min-w-0 gap-x-2.5 overflow-hidden border border-transparent px-3 pb-1.5 text-left text-muted hover:bg-hover hover:text-fg"
            >
              <span className="text-sm font-bold">{t('tray.title')}</span>
              <TrayState items={items} progress={events.progress} />
              <ChevronDown size={16} aria-hidden className={drawerOpen ? 'shrink-0' : 'shrink-0 -rotate-90'} />
            </button>
          )}
        </div>
        <ComposeBar onSubmit={submit} problem={problem} />
      </section>

      {working && drawerOpen && (
        <SendDrawer
          items={items}
          selectedId={selectedId}
          onSelect={(id) => {
            setDiscarded(null)
            setSelectedId(id)
          }}
          review={{
            onClose: finished,
            onDiscarded: (id, restore) => {
              // With other sends in the drawer, the discarded one stays as a placeholder with Deshacer; alone, the notice says it and brings the drawer back with the send.
              if (inputs.filter((i) => i.id !== id).length === 0 && uploads.length === 0) {
                notices.show({ text: t('discard.done'), action: { label: t('undo.undo'), run: async () => { await restore(); setDrawerOpen(true) } } })
                return true
              }
              setGone((set) => new Set(set).add(id))
              setSelectedId(undefined)
              setDiscarded({ id, restore })
              return true
            },
            discarded: discarded ? { onUndo: async () => { await discarded.restore(); setGone((set) => { const next = new Set(set); next.delete(discarded.id); return next }); setSelectedId(discarded.id); setDiscarded(null) } } : undefined,
          }}
        />
      )}

      {/* The main block of the page (UD-030): the latest messages and replies, always in view. On a phone one list at a time, in a frame as tall as the screen (J3-A-10). */}
      {desktop ? (
        <div className={cn('grid min-h-[22rem] flex-1 gap-x-section gap-y-block md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] md:grid-rows-[minmax(0,1fr)]', shown ? 'md:min-h-[28rem]' : 'md:min-h-0')}>
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
  const published = items.filter((i) => i.kind === 'input' && i.input.status === 'published').length
  const running = items.length - review - failed - published
  // The bar of the sends in progress: the mean of each one's own figure; with none started it travels (indeterminate).
  const figures = items.flatMap((i) => (i.kind === 'upload' ? (i.upload.error ? [] : [Math.round(i.upload.progress * 100)]) : ['proposed', 'failed', 'published'].includes(i.input.status) ? [] : [sendPercent(i.input, progress[i.input.job_id ?? ''])]))
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
      {published > 0 && review + running + failed === 0 && <Badge tone="neutral">{t('tray.published', { n: published })}</Badge>}
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
 * From 768 px the strip has a height of its own (one row of chips of up to two lines) and does not wrap: while the chips measure themselves they are
 * all drawn, and a strip that grew with them moved the two lists below it at every measure, so both lists drew their measuring rows again and the
 * thumbnails asked for their files without end (H-1405).
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
    <section aria-label={t('home.mine')} data-testid="attention" data-state-top={top ?? 'none'} className="glass leaf flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-1 md:h-12 md:flex-nowrap md:overflow-hidden">
      <h2>{t('home.mine')}</h2>
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
        <div aria-hidden className="min-h-6" />
      ) : (
        <>
          <h2 className="md:border-l md:border-line md:pl-4">{t('home.byArea')}</h2>
          <AreaChips
            className="min-w-0 flex-1 basis-60 md:basis-0"
            chips={areas.map((a) => (
              <span key={a.area_id} data-testid="area-pending" className="inline-flex min-h-6 max-w-[24rem] flex-wrap items-center gap-x-1.5 rounded-2xl border border-line-strong px-2 py-px text-xs font-semibold leading-tight">
                <span className="min-w-0 break-words">{areaTitle(a.area_id)}</span>
                {(['open', 'answered'] as const).map(
                  (status) =>
                    areaCounts(summary, a.area_id)[status] > 0 && (
                      <Link key={status} to={areaMessagesPath(a.area_id, status)} aria-label={t('areas.countOf', { title: areaTitle(a.area_id), count: label({ [status]: areaCounts(summary, a.area_id)[status] }) })} className="rounded-full hover:bg-glass-edge">
                        <StateMark status={status} n={areaCounts(summary, a.area_id)[status]} plain className="min-h-0" />
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
