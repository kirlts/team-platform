// Ephemeral state of the SSE stream (GET /events): progress per job_id and notices of new messages.
// One stream per member (MASTER-SPEC §7.10). None of this is kept in the query cache.
import type { EventSourceLike } from './http.js'
import type { ChangedEvent, DoneEvent, NewMessageEvent, ProgressEvent } from './types.js'

export type { EventSourceLike }

export interface JobProgress {
  percent: number
  phrase: string
  /** Stable code of the step (H-3722); null from a server older than the codes. */
  code?: string | null
  vars?: Record<string, number>
  done: boolean
  inputId?: string
}

export interface Notice {
  key: string
  message_id: string
  title: string
  author_id: string
  at: string
  /** `mention`: the notice is a mention in a reply (UD-278). */
  reason?: string
}

export interface EventsSnapshot {
  progress: Readonly<Record<string, JobProgress>>
  notices: readonly Notice[]
  unread: number
  connected: boolean
}

/** Maximum number of notices the bell keeps. It is a screen matter, not an operation matter. */
const MAX_NOTICES = 20

export class EventsStore {
  private snap: EventsSnapshot = { progress: {}, notices: [], unread: 0, connected: false }
  private listeners = new Set<() => void>()
  private doneListeners = new Set<(e: DoneEvent) => void>()
  private messageListeners = new Set<(e: NewMessageEvent) => void>()
  private changedListeners = new Set<(e: ChangedEvent) => void>()

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  getSnapshot = () => this.snap

  onDone(fn: (e: DoneEvent) => void) {
    this.doneListeners.add(fn)
    return () => {
      this.doneListeners.delete(fn)
    }
  }

  onNewMessage(fn: (e: NewMessageEvent) => void) {
    this.messageListeners.add(fn)
    return () => {
      this.messageListeners.delete(fn)
    }
  }

  /** A write by somebody else left these cache roots stale (`message` event with `reason: 'changed'`). It is no notice. */
  onChanged(fn: (e: ChangedEvent) => void) {
    this.changedListeners.add(fn)
    return () => {
      this.changedListeners.delete(fn)
    }
  }

  changed(e: ChangedEvent) {
    // A deleted message is no news any more: the bell drops its notices (opening one led to «El mensaje no existe»).
    if (e.gone?.length) {
      const gone = new Set(e.gone)
      const notices = this.snap.notices.filter((n) => !gone.has(n.message_id))
      if (notices.length !== this.snap.notices.length) this.set({ notices, unread: Math.min(this.snap.unread, notices.length) })
    }
    for (const fn of this.changedListeners) fn(e)
  }

  private set(next: Partial<EventsSnapshot>) {
    this.snap = { ...this.snap, ...next }
    for (const fn of this.listeners) fn()
  }

  setConnected(connected: boolean) {
    if (this.snap.connected !== connected) this.set({ connected })
  }

  progress(e: ProgressEvent) {
    const prev = this.snap.progress[e.job_id]
    // An event repeated by the replay does not move the bar backwards.
    const percent = prev && !prev.done ? Math.max(prev.percent, e.percent) : e.percent
    this.set({
      progress: {
        ...this.snap.progress,
        [e.job_id]: { percent, phrase: e.phrase, code: e.code ?? null, vars: e.vars ?? {}, done: false, inputId: e.input_id ?? prev?.inputId },
      },
    })
  }

  done(e: DoneEvent) {
    const prev = this.snap.progress[e.job_id]
    this.set({
      progress: {
        ...this.snap.progress,
        [e.job_id]: { percent: 100, phrase: prev?.phrase ?? '', code: prev?.code ?? null, vars: prev?.vars ?? {}, done: true, inputId: e.input_id ?? prev?.inputId },
      },
    })
    for (const fn of this.doneListeners) fn(e)
  }

  newMessage(e: NewMessageEvent) {
    const mention = e.reason === 'mention'
    const key = mention ? `${e.message_id}#${e.reply_id ?? ''}` : e.message_id // a mention is a notice of its own even when the message already gave one
    if (this.snap.notices.some((n) => n.key === key)) return
    const notice: Notice = {
      key,
      ...(mention ? { reason: 'mention' } : {}),
      message_id: e.message_id,
      title: e.title,
      author_id: e.author_id,
      at: e.at ?? new Date().toISOString(),
    }
    this.set({ notices: [notice, ...this.snap.notices].slice(0, MAX_NOTICES), unread: this.snap.unread + 1 })
    for (const fn of this.messageListeners) fn(e)
  }

  markRead() {
    if (this.snap.unread !== 0) this.set({ unread: 0 })
  }

  forget(jobId: string) {
    if (!(jobId in this.snap.progress)) return
    const { [jobId]: _gone, ...rest } = this.snap.progress
    this.set({ progress: rest })
  }

  /** Dispatches a server event. Accepts the names `progress`, `done` and `message`, or infers from the shape. */
  dispatch(kind: string | undefined, raw: string) {
    let data: unknown
    try {
      data = JSON.parse(raw)
    } catch {
      return
    }
    if (!data || typeof data !== 'object') return
    const d = data as Record<string, unknown>
    if (d.reason === 'changed') {
      this.changed({ roots: Array.isArray(d.roots) ? d.roots.filter((r): r is string => typeof r === 'string') : [], message_id: str(d.message_id), ...(Array.isArray(d.gone) ? { gone: d.gone.map(String) } : {}) })
    } else if (kind === 'done' || d.done === true) {
      if (typeof d.job_id === 'string') this.done({ job_id: d.job_id, input_id: str(d.input_id), input_status: str(d.input_status), message_id: str(d.message_id), done: true })
    } else if (kind === 'progress' || typeof d.percent === 'number') {
      if (typeof d.job_id === 'string' && typeof d.percent === 'number') {
        this.progress({
          job_id: d.job_id,
          input_id: str(d.input_id),
          percent: d.percent,
          phrase: typeof d.phrase === 'string' ? d.phrase : '',
          code: typeof d.code === 'string' ? d.code : null,
          vars: numbers(d.vars),
          at: str(d.at),
        })
      }
    } else if (typeof d.message_id === 'string') {
      this.newMessage({
        message_id: d.message_id,
        title: typeof d.title === 'string' ? d.title : '',
        author_id: typeof d.author_id === 'string' ? d.author_id : '',
        at: str(d.at),
        reason: str(d.reason),
        reply_id: str(d.reply_id),
      })
    }
  }
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

export type EventSourceFactory = (url: string) => EventSourceLike

const CLOSED = 2
/**
 * Wait before reopening a stream the server closed with a status other than 200 (the
 * browser does not retry that one). It is a courtesy to the server, not an operation deadline:
 * network drops are reconnected by the browser itself with Last-Event-ID.
 */
export const REOPEN_DELAYS_MS = [1_000, 2_000, 5_000, 15_000, 30_000]

/** The browser's `EventSource`, with the session cookie. A runtime without one (Node, a test) passes its own factory. */
function defaultEventSource(url: string): EventSourceLike {
  if (typeof EventSource === 'undefined') throw new Error('No EventSource in this runtime: pass an `eventSource` factory to createTeamClient.')
  return new EventSource(url, { withCredentials: true }) as unknown as EventSourceLike
}

export const EVENT_NAMES = ['progress', 'done', 'message'] as const

/**
 * The `replay` event the server sends first on every connection: `complete` is true when the events that follow are all the
 * client missed. Anything that does not say so counts as incomplete.
 */
function replayIsComplete(raw: string): boolean {
  try {
    return (JSON.parse(raw) as { complete?: unknown } | null)?.complete === true
  } catch {
    return false
  }
}

/** Opens the stream and keeps it. Returns the function that closes it. */
export function connectEvents(
  store: EventsStore,
  url: string,
  factory: EventSourceFactory = defaultEventSource,
  onReconnect?: () => void,
): () => void {
  // `onReconnect` runs only when the server says the replay after a drop was not enough to catch up (no `Last-Event-ID`, or
  // events older than the retention): a complete replay already delivers what changed, through the same events.
  let source: EventSourceLike | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let attempt = 0
  let hadError = false
  /** The stream just came back after a drop and its `replay` event has not arrived yet. */
  let awaitingReplay = false
  let stopped = false

  /** The first event after a drop decides whether the lists are read again. A server without `replay` sends an event first: incomplete. */
  const settleReplay = (complete: boolean) => {
    if (!awaitingReplay) return
    awaitingReplay = false
    if (!complete) onReconnect?.()
  }

  const open = () => {
    if (stopped) return
    const es = factory(url)
    source = es
    es.onopen = () => {
      attempt = 0
      store.setConnected(true)
      awaitingReplay = hadError
      hadError = false
    }
    es.onerror = () => {
      hadError = true
      store.setConnected(false)
      if (es.readyState === CLOSED && !stopped) {
        const delay = REOPEN_DELAYS_MS[Math.min(attempt, REOPEN_DELAYS_MS.length - 1)]
        attempt += 1
        timer = setTimeout(open, delay)
      }
    }
    es.onmessage = (e) => {
      settleReplay(false)
      store.dispatch(undefined, e.data)
    }
    es.addEventListener('replay', (e) => settleReplay(replayIsComplete(e.data)))
    for (const name of EVENT_NAMES) {
      es.addEventListener(name, (e) => {
        settleReplay(false)
        store.dispatch(name, e.data)
      })
    }
  }

  open()
  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
    source?.close()
    store.setConnected(false)
  }
}

/** The numeric variables of a progress code; anything else is dropped. */
function numbers(v: unknown): Record<string, number> {
  if (!v || typeof v !== 'object') return {}
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, n]) => typeof n === 'number')) as Record<string, number>
}
