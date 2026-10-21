// Ephemeral state of the SSE stream (GET /events): progress per job_id and notices of new messages.
// A single stream per member (MASTER-SPEC §7.10). None of this is stored in the query cache.
import type { DoneEvent, NewMessageEvent, ProgressEvent } from './types'

export interface JobProgress {
  percent: number
  phrase: string
  done: boolean
  inputId?: string
}

export interface Notice {
  key: string
  message_id: string
  title: string
  author_id: string
  at: string
}

export interface EventsSnapshot {
  progress: Readonly<Record<string, JobProgress>>
  notices: readonly Notice[]
  unread: number
  connected: boolean
}

/** Maximum number of notices the bell keeps. It is a screen setting, not an operation setting. */
const MAX_NOTICES = 20

export class EventsStore {
  private snap: EventsSnapshot = { progress: {}, notices: [], unread: 0, connected: false }
  private listeners = new Set<() => void>()
  private doneListeners = new Set<(e: DoneEvent) => void>()
  private messageListeners = new Set<(e: NewMessageEvent) => void>()

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
        [e.job_id]: { percent, phrase: e.phrase, done: false, inputId: e.input_id ?? prev?.inputId },
      },
    })
  }

  done(e: DoneEvent) {
    const prev = this.snap.progress[e.job_id]
    this.set({
      progress: {
        ...this.snap.progress,
        [e.job_id]: { percent: 100, phrase: prev?.phrase ?? '', done: true, inputId: e.input_id ?? prev?.inputId },
      },
    })
    for (const fn of this.doneListeners) fn(e)
  }

  newMessage(e: NewMessageEvent) {
    if (this.snap.notices.some((n) => n.key === e.message_id)) return
    const notice: Notice = {
      key: e.message_id,
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
    if (kind === 'done' || d.done === true) {
      if (typeof d.job_id === 'string') this.done({ job_id: d.job_id, input_id: str(d.input_id), done: true })
    } else if (kind === 'progress' || typeof d.percent === 'number') {
      if (typeof d.job_id === 'string' && typeof d.percent === 'number') {
        this.progress({
          job_id: d.job_id,
          input_id: str(d.input_id),
          percent: d.percent,
          phrase: typeof d.phrase === 'string' ? d.phrase : '',
          at: str(d.at),
        })
      }
    } else if (typeof d.message_id === 'string') {
      this.newMessage({
        message_id: d.message_id,
        title: typeof d.title === 'string' ? d.title : '',
        author_id: typeof d.author_id === 'string' ? d.author_id : '',
        at: str(d.at),
      })
    }
  }
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

type EventSourceLike = {
  readyState: number
  close(): void
  addEventListener(type: string, listener: (e: MessageEvent) => void): void
  onopen: ((e: Event) => void) | null
  onerror: ((e: Event) => void) | null
  onmessage: ((e: MessageEvent) => void) | null
}
export type EventSourceFactory = (url: string) => EventSourceLike

const CLOSED = 2
/**
 * Wait before reopening a stream the server closed with a status other than 200 (the
 * browser does not retry that one). It is a courtesy to the server, not an operation deadline:
 * network drops are reconnected by the browser itself with Last-Event-ID.
 */
export const REOPEN_DELAYS_MS = [1_000, 2_000, 5_000, 15_000, 30_000]

export const EVENT_NAMES = ['progress', 'done', 'message'] as const

/** Opens the stream and keeps it. Returns the function that closes it. */
export function connectEvents(
  store: EventsStore,
  url: string,
  factory: EventSourceFactory = (u) => new EventSource(u, { withCredentials: true }) as unknown as EventSourceLike,
  onReconnect?: () => void,
): () => void {
  let source: EventSourceLike | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let attempt = 0
  let hadError = false
  let stopped = false

  const open = () => {
    if (stopped) return
    const es = factory(url)
    source = es
    es.onopen = () => {
      attempt = 0
      store.setConnected(true)
      // After a drop, what happened in the meantime arrives by replay; the queries are refreshed just in case.
      if (hadError) onReconnect?.()
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
    es.onmessage = (e) => store.dispatch(undefined, e.data)
    for (const name of EVENT_NAMES) es.addEventListener(name, (e) => store.dispatch(name, e.data))
  }

  open()
  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
    source?.close()
    store.setConnected(false)
  }
}
