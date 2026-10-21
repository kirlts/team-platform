import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { AnalysisPanel } from '@/components/AnalysisPanel'
import { ComposeBar } from '@/components/ComposeBar'
import { FitList } from '@/components/FitList'
import { InputPreview } from '@/components/InputPreview'
import { MessageCard } from '@/components/MessageCard'
import { Page } from '@/components/Page'
import { PageHeader } from '@/components/PageHeader'
import { Segmented } from '@/components/Segmented'
import { useFormat, useT } from '@/i18n'
import { ApiError } from '@/lib/api'
import { ME, type MessageQuery } from '@/lib/filters'
import { useInput, useMe, useMessages, useProject } from '@/lib/queries'
import { UndoProvider, useUndoStack } from '@/lib/undo'

const ACTIVE_KEY = 'team-active-input'

function readActive(): string | undefined {
  try {
    return localStorage.getItem(ACTIVE_KEY) ?? undefined
  } catch {
    return undefined
  }
}

function writeActive(id: string | undefined) {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id)
    else localStorage.removeItem(ACTIVE_KEY)
  } catch {
    // Without storage, the proposal does not survive a reload of the tab.
  }
}

export function Home() {
  const t = useT()
  const format = useFormat()
  const me = useMe().data
  const project = useProject().data
  const [now, setNow] = useState(() => new Date())
  const [activeId, setActiveId] = useState<string | undefined>(readActive)
  const input = useInput(activeId)
  const undo = useUndoStack()

  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 15_000)
    return () => clearInterval(tick)
  }, [])

  const close = () => {
    writeActive(undefined)
    setActiveId(undefined)
  }

  // An input that no longer exists, was published or was canceled frees the analysis zone.
  useEffect(() => {
    const err = input.error
    if (err instanceof ApiError && err.status === 404) close()
    const status = input.data?.status
    if (status === 'published' || status === 'cancelled') close()
  }, [input.error, input.data?.status])

  const working = !!input.data

  return (
    <UndoProvider stack={undo}>
      <Page cols={12}>
        <PageHeader
          title={project?.name ?? me?.project_name ?? ''}
          aside={
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
              <time dateTime={now.toISOString()}>
                {format.longDate(now)} <span className="text-accent-deep">{format.clock(now)}</span>
              </time>
            </p>
          }
        />

        <section aria-label={t('home.new')} className="flex flex-col gap-2">
          <h2>{t('home.new')}</h2>
          <ComposeBar
            disabled={!!activeId && input.data?.status !== 'failed'}
            onCreated={(created) => {
              writeActive(created.input_id)
              setActiveId(created.input_id)
            }}
          />
        </section>

        {working ? (
          <>
            <div className="glass leaf grid min-h-0 flex-1 md:grid-rows-[minmax(0,1fr)] gap-x-10 gap-y-4 p-4 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
              <InputPreview input={input.data!} />
              <AnalysisPanel input={input.data!} onClose={close} />
            </div>
            <FeedLinks meId={me?.id ?? ''} />
          </>
        ) : (
          <div className="grid min-h-0 flex-1 md:grid-rows-[minmax(0,1fr)] gap-x-10 gap-y-4 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <Feed kind="messages" meId={me?.id ?? ''} />
            <Feed kind="replies" meId={me?.id ?? ''} />
          </div>
        )}
      </Page>
    </UndoProvider>
  )
}

/** With a proposal open, the two lists fold into one line with their count; each one leads to Mensajes. */
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
