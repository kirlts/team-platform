import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { AlertTriangle, ChevronDown } from '@/components/icons'
import { AreaChips } from '@/components/AreaChips'
import { Meter } from '@/components/Meter'
import { Button } from '@/components/ui/button'
import { useNotices } from '@/lib/notices'
import { sendPercent } from '@/lib/progress'
import { ComposeBar, type SendDraft } from '@/components/ComposeBar'
import { useLookups } from '@/components/lookups'
import { NotifyBadge, ToneMark, usePulse } from '@/components/NotifyBadge'
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
import { areaMessagesPath, areaPendingCounts, mineCounts } from '@/lib/pending'
import { topTone } from '@/lib/priority'
import { useEventsSnapshot } from '@/lib/events'
import { useMe, useMessages, useProject, useSummary, useTray } from '@/lib/queries'
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
  const tray = useTray()
  const [uploads, setUploads] = useState<Upload[]>([])
  const [problem, setProblem] = useState<string | null>(null)
  /** The send in view: the key of an upload that is still going up, or the id of an input the server already has. */
  const [selectedId, setSelectedId] = useState<string | undefined>()
  /** The drawer under the bar (UD-046): it opens by itself when something is sent and the person can fold it; the control above carries the state of the sends. */
  const [drawerOpen, setDrawerOpen] = useState(false)
  /** Sends already published or discarded here, hidden until the server's list catches up. */
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set())
  const events = useEventsSnapshot()
  const lastIndex = useRef(0)
  const notices = useNotices()
  /** A send was published or discarded here: the next selection continues the order instead of starting over. */
  const advance = useRef(false)
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
    return [...inputs.map((input): TrayItem => ({ kind: 'input', input })), ...sending]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputs, uploads])
  const ids = useMemo(() => items.map((i) => (i.kind === 'upload' ? i.upload.key : i.input.id)), [items])

  // The drawer opens on the send the person just made; otherwise on the one that needs the person and is the most recent (ready or failed), never on an old one (J2-B-10);
  // when the one in view goes out it continues with the next ready one, in order of arrival.
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
    const at = ids.indexOf(selectedId ?? '')
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

  const finished = () => {
    advance.current = true
    if (selectedId) setGone((set) => new Set(set).add(selectedId))
    setSelectedId(undefined)
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

  const working = items.length > 0
  useEffect(() => {
    if (!working) setDrawerOpen(false)
  }, [working])

  // With the drawer open and a window too low for it and the two lists (UD-017), the lists yield: they fold into one strip that says where they are. Measured, not guessed:
  // the page folds them only when it does overflow with them drawn, and tries again whenever the window changes size.
  const [listsFolded, setListsFolded] = useState(false)
  const shown = working && drawerOpen && desktop
  // A list that is still measuring draws sixty rows for a moment: the page is only read once none is (`data-fit-measuring`), and again whenever one finishes.
  useEffect(() => {
    const main = document.querySelector('main')
    if (!shown) {
      setListsFolded(false)
      return
    }
    if (!main || listsFolded) return
    const check = () => {
      if (!main.querySelector('[data-fit-measuring]') && main.scrollHeight > main.clientHeight + 1) setListsFolded(true)
    }
    const observer = new MutationObserver(check)
    observer.observe(main, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-fit-measuring', 'style'] })
    check()
    return () => observer.disconnect()
  }, [shown, listsFolded])
  useEffect(() => {
    const main = document.querySelector('main')
    if (!main || typeof ResizeObserver === 'undefined') return
    let width = main.clientWidth
    let height = main.clientHeight
    const observer = new ResizeObserver(() => {
      // A different window is a different question: draw the lists again and measure again.
      if (Math.abs(main.clientWidth - width) > 1 || Math.abs(main.clientHeight - height) > 1) {
        width = main.clientWidth
        height = main.clientHeight
        setListsFolded(false)
      }
    })
    observer.observe(main)
    return () => observer.disconnect()
  }, [])

  return (
    <Page cols={12} dense>
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

      <section aria-label={t('home.new')} className="flex flex-col gap-1.5">
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
              className="btn btn-glass relative h-7 min-w-0 gap-x-2.5 overflow-hidden !border-accent !bg-accent-soft/70 px-3 pb-1.5 text-left"
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
          fillRest={listsFolded}
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
      {desktop && listsFolded ? (
        <FoldedLists onShow={() => setDrawerOpen(false)} />
      ) : desktop ? (
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

/** The two lists, folded into one strip while the drawer has the room (low windows): each name leads to its list in Mensajes, and the button gives the room back. */
function FoldedLists({ onShow }: { onShow: () => void }) {
  const t = useT()
  return (
    <section aria-label={t('home.latestMessages')} data-testid="lists-folded" className="glass leaf flex shrink-0 flex-wrap items-center gap-x-6 gap-y-1 px-4 py-1.5">
      <h2>
        <Link to="/messages" className="hover:underline">
          {t('home.latestMessages')}
        </Link>
      </h2>
      <h2>
        <Link to="/messages?f=replies:eq:con" className="hover:underline">
          {t('home.latestReplies')}
        </Link>
      </h2>
      <Button size="sm" variant="ghost" className="ml-auto" onClick={onShow}>
        {t('tray.fold')}
      </Button>
    </section>
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
          <Badge tone="answered">{t('tray.running', { n: running })}</Badge>
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
 * what is pending in it. Both rows use the same chip, quiet (UD-036), and the same kind of label; each chip leads to
 * Mensajes already filtered (UD-028). The areas take one row: those that do not fit fold behind «+N» (J3-A-06, J3-A-10).
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
    <section aria-label={t('home.mine')} data-testid="attention" data-tone-top={tone ?? 'none'} className="glass leaf flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-1">
      <h2>{t('home.mine')}</h2>
      <div className="flex min-h-6 items-center">
        {!tone ? (
          <span className="text-sm text-muted">{t('home.mineNone')}</span>
        ) : (
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
      </div>
      {/* The row is always there, with the height of one chip: an area that gets something pending does not push the lists down (J3-B-15). */}
      {areas.length === 0 ? (
        <div aria-hidden className="min-h-6" />
      ) : (
        <>
          <h2 className="md:border-l md:border-line md:pl-4">{t('home.byArea')}</h2>
          <AreaChips
            className="min-w-0 flex-1 basis-60"
            chips={areas.map((a) => (
              <Link
                key={a.area_id}
                to={areaMessagesPath(a.area_id)}
                aria-label={t('home.areaOpen', { title: areaTitle(a.area_id), n: a.open })}
                data-testid="area-pending"
                className="inline-flex min-h-6 max-w-[16rem] items-center gap-1.5 rounded-2xl border border-line-strong px-2 py-px text-xs font-semibold leading-tight hover:bg-glass-edge"
              >
                <span className="min-w-0 break-words">{areaTitle(a.area_id)}</span>
                <NotifyBadge counts={areaPendingCounts(summary, a.area_id)} size="plain" />
              </Link>
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
