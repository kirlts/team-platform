import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Link } from 'react-router'
import { cn } from '@/lib/utils'
import { AlertTriangle, ChevronDown } from '@/components/icons'
import { Meter } from '@/components/Meter'
import { useNotices } from '@/lib/notices'
import { sendPercent } from '@/lib/progress'
import { ComposeBar, type SendDraft } from '@/components/ComposeBar'
import { usePulse } from '@/components/NotifyBadge'
import { Badge } from '@/components/ui/badge'
import { FitList } from '@/components/FitList'
import { LoadState } from '@/components/LoadState'
import { MessageCard } from '@/components/MessageCard'
import { AIRY_GAP, Page } from '@/components/Page'
import { SendDrawer } from '@/components/SendDrawer'
import { Segmented } from '@/components/Segmented'
import { type PendingUpload, type TrayItem } from '@/components/Tray'
import { useErrorText, useFormat, useT } from '@/i18n'
import { invalidateRoots, ME, type MessageQuery } from '@team-platform/client'
import { useEventsSnapshot, useMe, useMessages, useProject, useSends, useTeamClient } from '@team-platform/client/react'
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

/** The date and the time of the day, renewed at each change of minute (idea.md: «fecha y hora actuales»; UD-230). */
function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    let timer = 0
    const arm = () => {
      const current = new Date()
      setNow(current)
      timer = window.setTimeout(arm, 60_000 - (current.getTime() % 60_000))
    }
    timer = window.setTimeout(arm, 60_000 - (Date.now() % 60_000))
    return () => window.clearTimeout(timer)
  }, [])
  return now
}

export function Home() {
  const t = useT()
  const format = useFormat()
  const now = useMinuteClock()
  const errorText = useErrorText()
  const queryClient = useQueryClient()
  const team = useTeamClient()
  const me = useMe().data
  const project = useProject().data
  const desktop = useDesktop()
  const room = useRef<HTMLDivElement>(null)
  const tray = useSends()
  const [uploads, setUploads] = useState<Upload[]>([])
  /** The send in view: the key of an upload that is still going up, or the id of an input the server already has. */
  const [selectedId, setSelectedId] = useState<string | undefined>()
  /** The drawer under the bar (UD-046): it opens by itself when something is sent and the person can fold it; the control above carries the state of the sends. */
  const [drawerOpen, setDrawerOpen] = useState(false)
  /** The drawer as the failure of an upload finds it: the callback of the upload outlives the render that made it. */
  const drawerRef = useRef(false)
  drawerRef.current = drawerOpen
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
    void invalidateRoots(queryClient, ['inputs'])
  }, [started, ended, queryClient])
  // A job that ends may have published messages (auto-publication, UD-070): the feed under the bar shows them without a reload.
  useEffect(() => {
    if (ended > 0) void invalidateRoots(queryClient, ['messages', 'areas'])
  }, [ended, queryClient])

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
        await team.inputs.upload({ text: draft.text, files: draft.files, links: draft.links, asMemberId: draft.asMemberId }, (progress) => setUploads((list) => list.map((u) => (u.key === key ? { ...u, progress } : u))))
        // The server's list first, then the upload leaves: the send passes from one to the other without a moment in which it is neither.
        await invalidateRoots(queryClient, ['inputs'])
        setUploads((list) => list.filter((u) => u.key !== key))
      } catch (err) {
        const reason = errorText(err)
        setUploads((list) => list.map((u) => (u.key === key ? { ...u, error: reason } : u)))
        // With the drawer open the failed send says so in its own pane, with Reintentar; folded, the notice carries the same way out.
        if (!drawerRef.current) notices.show({ tone: 'danger', text: t('compose.sendFailed', { reason }), action: { label: t('common.retry'), run: () => void upload(key, draft) } })
      }
    },
    [errorText, notices, queryClient, t, team],
  )

  const submit = (draft: SendDraft) => {
    const key = crypto.randomUUID()
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
    void invalidateRoots(queryClient, ['inputs'])
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
  // The two lists then get a height of their own: a frame that takes its height from its content would grow with the sixty rows the lists draw to measure themselves.
  const shown = working && drawerOpen && desktop

  return (
    <Page cols="inicio" airy scrolls={shown}>
      {/* From top to bottom (mockup, UD-046): the project and the date, the bar to write, the drawer with what was sent and how it was analyzed, and the latest messages and replies. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-0.5">
        {/* The header says the project's name too: this is the page's title (the mockup has both), so the repeat is declared. */}
        <h1 data-repeat-ok="page-title" className="min-w-0 break-words">
          {project?.name ?? me?.project_name ?? t('nav.home')}
        </h1>
        <time dateTime={now.toISOString()} className="text-sm tabular-nums text-muted">
          {format.longDate(now)}, {format.clock(now)}
        </time>
      </div>

      <section aria-label={t('home.new')} className="flex w-full flex-col gap-3">
        {/* The row keeps its height with or without sends, so the control appearing moves nothing (J2-B-08). */}
        <div className="flex min-h-8 items-center justify-between gap-x-6">
          <h2>{t('home.new')}</h2>
          <div className="flex items-center gap-2">
          {working && (
            // One control, shaped as a button: the state and the progress of the sends are in its face, and it folds and unfolds the drawer (J2-B-07).
            <button
              type="button"
              data-testid="tray-control"
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen((v) => !v)}
              className="btn relative h-8 min-w-0 gap-x-2.5 overflow-hidden border border-transparent px-3 pb-1 text-left text-muted hover:bg-hover hover:text-fg"
            >
              <span className="text-sm font-semibold">{t('tray.title')}</span>
              <TrayState items={items} progress={events.progress} />
              <ChevronDown size={16} aria-hidden className={drawerOpen ? 'shrink-0' : 'shrink-0 -rotate-90'} />
            </button>
          )}
          </div>
        </div>
        <ComposeBar onSubmit={submit} />
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
            // Deleted for real: it leaves the drawer now, and the list confirms it when it catches up (UD-240).
            onDeleted: (id) => {
              setGone((set) => new Set(set).add(id))
              setDiscarded(null)
              setSelectedId(undefined)
            },
            discarded: discarded ? { onUndo: async () => { await discarded.restore(); setGone((set) => { const next = new Set(set); next.delete(discarded.id); return next }); setSelectedId(discarded.id); setDiscarded(null) } } : undefined,
          }}
        />
      )}

      {/* The main block of the page (UD-030): the latest messages and replies. The room takes what the page leaves and never follows the rows; the two lists sit at its
          top in two equal columns, as tall as the taller of them and no taller than the room, where they page (UD-253). On a phone one under the other (J3-A-10). */}
      {desktop ? (
        <div ref={room} data-testid="home-feeds-room" className={cn('min-h-[22rem]', shown ? 'h-[max(28rem,56dvh)] flex-none' : 'min-h-0 flex-1')}>
          <div className="grid max-h-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] gap-x-section">
            <Feed kind="messages" meId={me?.id ?? ''} bound={room} />
            <Feed kind="replies" meId={me?.id ?? ''} bound={room} />
          </div>
        </div>
      ) : (
        <div className={cn('flex flex-col', AIRY_GAP)}>
          <Feed kind="messages" meId={me?.id ?? ''} phone />
          <Feed kind="replies" meId={me?.id ?? ''} phone />
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
          <Badge tone="answered">{t('tray.review', { n: review })}</Badge>
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
        <Badge tone="danger" className="gap-1">
          <AlertTriangle size={12} aria-hidden strokeWidth={2.4} />
          {t('tray.failed', { n: failed })}
        </Badge>
      )}
    </span>
  )
}

function Feed({ kind, meId, phone = false, bound }: { kind: 'messages' | 'replies'; meId: string; phone?: boolean; bound?: RefObject<HTMLElement | null> }) {
  const t = useT()
  const [mine, setMine] = useState(false) // Home shows the whole team; «Para mí» is the filter (UD-273)
  const query: MessageQuery = { filters: mine ? [{ prop: 'for', op: 'eq', value: ME }] : [], q: '' }
  const feed = useMessages({ query, meId, repliesFeed: kind === 'replies', enabled: !!meId })
  const rows = useMemo(() => feed.data ?? [], [feed.data])
  const messagesFeed = kind === 'messages'

  const params = new URLSearchParams()
  if (mine) params.append('f', `for:eq:${ME}`)
  if (!messagesFeed) params.append('f', 'replies:eq:con')

  return (
    // A section like «Nuevo mensaje»: its title is a label above, with its filter on the right, and the frame of the rows under it. The frames take the height of the taller of the two.
    // On a phone the section stops at what is left of the screen under the header and the page margins, and the list pages inside it (J3-A-10).
    <section aria-label={messagesFeed ? t('home.latestMessages') : t('home.latestReplies')} className={cn('flex min-h-0 min-w-0 flex-col gap-3', phone && 'max-h-[calc(100dvh-6.5rem)]')}>
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <h2>
          <Link to={`/messages?${params.toString()}`} className="hover:underline">
            {messagesFeed ? t('home.latestMessages') : t('home.latestReplies')}
          </Link>
        </h2>
        <Segmented
          label={messagesFeed ? t('home.shownMessages') : t('home.shownReplies')}
          size="sm"
          quiet
          value={mine ? 'mine' : 'all'}
          onChange={(v) => setMine(v === 'mine')}
          options={[
            { value: 'mine', label: t('home.forMe') },
            { value: 'all', label: t('home.everyone') },
          ]}
        />
      </div>
      <FitList
        fill
        pagedOnPhone={phone}
        bound={bound}
        rows={rows}
        rowKey={(m) => m.id}
        renderRow={(m) => <MessageCard message={m} variant={messagesFeed ? 'message' : 'reply'} />}
        empty={feed.isPending || feed.isError ? <LoadState query={feed} rows={2} /> : <p className="flex items-center justify-center px-4 py-10 text-center text-sm text-muted">{messagesFeed ? t('home.noMessages') : t('home.noReplies')}</p>}
      />
    </section>
  )
}
