import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { ComposeBar, type SendDraft } from '@/components/ComposeBar'
import { FitList } from '@/components/FitList'
import { MessageCard } from '@/components/MessageCard'
import { Page } from '@/components/Page'
import { ReviewPane } from '@/components/ReviewPane'
import { Segmented } from '@/components/Segmented'
import { Tray, type PendingUpload, type TrayItem } from '@/components/Tray'
import { useErrorText, useFormat, useT } from '@/i18n'
import { ME, type MessageQuery } from '@/lib/filters'
import { useEventsSnapshot } from '@/lib/events'
import { useMe, useMessages, useTray } from '@/lib/queries'
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
  return !!el && (el.isContentEditable || !!el.closest('input, textarea, select, button, a, [role="dialog"], [role="menu"], [role="menuitemradio"]'))
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
  const originalOpen = !!selected && (originalChoice[selected.id] ?? selected.status !== 'proposed')
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

      {working ? (
        <>
          <div className="glass leaf grid min-h-0 flex-1 gap-x-6 gap-y-4 p-4 md:grid-cols-[minmax(0,3fr)_minmax(0,9fr)] md:grid-rows-[minmax(0,1fr)]">
            <Tray items={items} selectedId={selectedId} hideTextId={originalOpen ? selectedId : undefined} onSelect={setSelectedId} />
            <div className="flex min-h-0 min-w-0 flex-col border-line md:border-l md:pl-6">
              <ReviewPane inputId={selectedId} originalOpen={originalOpen} onToggleOriginal={() => selected && setOriginalChoice((c) => ({ ...c, [selected.id]: !originalOpen }))} onClose={finished} registerPublish={registerPublish} />
            </div>
          </div>
          <FeedLinks meId={me?.id ?? ''} />
        </>
      ) : (
        <div className="grid min-h-0 flex-1 gap-x-10 gap-y-4 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] md:grid-rows-[minmax(0,1fr)]">
          <Feed kind="messages" meId={me?.id ?? ''} />
          <Feed kind="replies" meId={me?.id ?? ''} />
        </div>
      )}
    </Page>
  )
}

/** With sends in the tray, the two lists fold into one line with their count; each one leads to Mensajes. */
function FeedLinks({ meId }: { meId: string }) {
  const t = useT()
  const mine: MessageQuery = { filters: [{ prop: 'for', op: 'eq', value: ME }], q: '' }
  const messages = useMessages({ query: mine, meId, enabled: !!meId })
  const replies = useMessages({ query: mine, meId, repliesFeed: true, enabled: !!meId })
  const params = (extra: string[]) => new URLSearchParams([['f', `for:eq:${ME}`], ...extra.map((f) => ['f', f] as [string, string])]).toString()
  return (
    <nav aria-label={t('home.folded')} className="flex flex-wrap items-center gap-x-6 gap-y-1 text-[13px]">
      <Link to={`/messages?${params([])}`} className="text-accent hover:underline">
        {t('home.latestMessages')} <span className="tabular-nums text-muted">{messages.data?.length ?? 0}</span>
      </Link>
      <Link to={`/messages?${params(['replies:eq:con'])}`} className="text-accent hover:underline">
        {t('home.latestReplies')} <span className="tabular-nums text-muted">{replies.data?.length ?? 0}</span>
      </Link>
    </nav>
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
    <section aria-label={messagesFeed ? t('home.latestMessages') : t('home.latestReplies')} className="flex min-h-0 min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2>
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
        rows={rows}
        rowKey={(m) => m.id}
        renderRow={(m) => <MessageCard message={m} variant={messagesFeed ? 'message' : 'reply'} />}
        empty={<p className="px-3 py-6 text-center text-sm text-muted">{feed.isPending ? t('common.loading') : messagesFeed ? t('home.noMessages') : t('home.noReplies')}</p>}
      />
    </section>
  )
}
