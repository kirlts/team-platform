// Interface telemetry of the panel (UD-091, MASTER-SPEC §7.10 ter). It measures how the panel is used, with counts and
// durations, and sends it to POST /api/telemetry/ui. Three rules hold everywhere in this file:
//
//  1. Nothing a person wrote leaves the browser. Events carry numbers, screen names from a closed list, task names, and
//     route templates with their ids replaced. There is no place in an event where text fits (src/telemetry/ui-spec.js).
//  2. The panel works the same without it. Every entry point catches its own errors and says nothing; a failed send is
//     dropped, never retried, and nothing here awaits anything the rest of the panel needs.
//  3. Nothing runs on a clock. The queue is sent when it is full, when a task ends and when the page is hidden.

/** Screens of the panel. Equal to `SCREENS` in src/telemetry/ui-spec.js: a server test compares the two lists. */
export const SCREENS = ['home', 'messages', 'message-detail', 'areas', 'connections', 'team', 'settings', 'login', 'not-found'] as const
export type Screen = (typeof SCREENS)[number]
export type TaskName = 'send_publish' | 'reply' | 'close'
export type TaskOutcome = 'completed' | 'abandoned' | 'failed'
type ErrorKind = 'js' | 'promise' | 'network' | 'http' | 'render'

/** The path of the panel (without query) to its screen. */
export function screenOf(pathname: string): Screen {
  const parts = pathname.split('/').filter(Boolean)
  switch (parts[0]) {
    case undefined:
      return 'home'
    case 'messages':
      return parts.length > 1 ? 'message-detail' : 'messages'
    case 'areas':
    case 'connections':
    case 'team':
    case 'settings':
      return parts[0]
    default:
      return 'not-found'
  }
}

/**
 * An API path as a route template: the `/api` prefix and the query go, and every segment that is not lowercase letters
 * and hyphens (an id) becomes `:id`. The server accepts only that shape (ENDPOINT_PATTERN), so even a path with an
 * address in it could not travel.
 */
export function endpointOf(path: string): string {
  const bare = path.split('?')[0].replace(/^\/api(?=\/|$)/, '')
  const segments = bare.split('/').filter(Boolean).slice(0, 6) // ENDPOINT_PATTERN: at most six segments
  return `/${segments.map((s) => (/^[a-z][a-z-]{0,31}$/.test(s) ? s : ':id')).join('/')}`
}

// Core Web Vitals definition of a layout-shift session window: a window closes after a gap of 1 s without shifts or
// when it lasts 5 s (web.dev/articles/cls, consulted 2026-10-21, informe 09). Unit conversion of the spec's numbers.
const CLS_GAP_MS = 1000
const CLS_WINDOW_MS = 5000

/** Cumulative Layout Shift of one screen: the largest session window of shifts that did not follow a person's input. */
export class LayoutShift {
  private windowStart = 0
  private windowLast = 0
  private windowValue = 0
  value = 0

  add(startTime: number, shift: number, hadRecentInput: boolean) {
    if (hadRecentInput) return
    if (this.windowValue > 0 && (startTime - this.windowLast > CLS_GAP_MS || startTime - this.windowStart > CLS_WINDOW_MS)) {
      this.windowValue = 0
    }
    if (this.windowValue === 0) this.windowStart = startTime
    this.windowLast = startTime
    this.windowValue += shift
    this.value = Math.max(this.value, this.windowValue)
  }
}

/**
 * Interaction to Next Paint of one screen: the longest interaction, ignoring one more of the longest for every 50
 * interactions (web.dev/articles/inp, consulted 2026-10-21, informe 09). With fewer than 50 it is the longest.
 */
export function interactionToNextPaint(durations: number[]): number | undefined {
  if (durations.length === 0) return undefined
  const sorted = [...durations].sort((a, b) => b - a)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length / 50))]
}

type Listen = (target: EventTarget, type: string, fn: (e: never) => void, capture?: boolean) => void

// Width classes: the lower edge of the Tailwind breakpoint the window is in (tailwindcss.com/docs/responsive-design,
// consulted 2026-10-21; the panel has no custom ones). An exact window size is a fingerprint and the summary only needs
// the class (informe 09 §8.11, Matomo's exempt mode drops the screen resolution).
const WIDTH_EDGES = [0, 640, 768, 1024, 1280, 1536]
// Height classes: steps of 100 px, a declared courtesy (the fit tests of the panel use 844 and 900 px windows).
const HEIGHT_STEP = 100

export function viewportClass(width: number, height: number): { w: number; h: number } {
  const w = [...WIDTH_EDGES].reverse().find((edge) => width >= edge) ?? 0
  return { w, h: Math.floor(Math.max(0, height) / HEIGHT_STEP) * HEIGHT_STEP }
}

/**
 * Token bucket of the events the panel records: the rate and the burst of PostHog's client, 10 events a second with a
 * burst of 100 (informe 09 §9, posthog.com/docs, consulted 2026-10-21). A runaway loop of errors is the case it is for.
 */
export class EventBudget {
  private tokens = 100
  private last = 0
  take(now: number): boolean {
    this.tokens = Math.min(100, this.tokens + ((now - this.last) / 1000) * 10)
    this.last = now
    if (this.tokens < 1) return false
    this.tokens -= 1
    return true
  }
}

interface Counters {
  clicks: number
  scrollEvents: number
  scrollPx: number
  keys: number
  pointers: number
  screens: number
}
const zero = (): Counters => ({ clicks: 0, scrollEvents: 0, scrollPx: 0, keys: 0, pointers: 0, screens: 0 })

type Fields = Record<string, string | number | null>
interface Queued {
  at: number
  fields: Fields
}

interface Deps {
  now: () => number
  /** Hands a body to the network. It must never throw nor be awaited by the caller. */
  send: (body: string) => void
  /** Runs a function after the next paint (two frames). */
  afterPaint: (fn: () => void) => void
  viewport: () => { w: number; h: number }
}

/** Tasks the panel recognizes from the API traffic. The route is the signal; nothing of the request body is read. */
interface OpenTask {
  task: TaskName
  startedAt: number
  from: Counters
  feedbackAt?: number
  analysisAt?: number
}

export class UiTelemetry {
  private enabled = false
  private maxEvents = 1
  private queue: Queued[] = []
  private session = ''
  private counters = zero()
  private screen: Screen | null = null
  private screenEnteredAt = 0
  private screenFrom: Counters = zero()
  private shift = new LayoutShift()
  private interactions = new Map<number, number>()
  private longTasks = 0
  private longTaskMs = 0
  private lcp: number | undefined
  private armed: Partial<Record<TaskName, Counters>> = {}
  private open: OpenTask | null = null
  private firstScreen = true
  private firstScreenName: Screen | null = null
  private interactiveMs: number | undefined
  private renderStartedAt = 0
  private budget = new EventBudget()
  private leaving = false
  private interactionAt: number | undefined
  private changeAt: number | undefined
  private changePending = false
  private teardown: Array<() => void> = []

  constructor(private deps: Deps) {}

  // ---- Switch

  /** Called with what GET /me says. Turning it off removes every listener and forgets the queue. */
  configure(enabled: boolean, maxEvents: number) {
    try {
      this.maxEvents = Math.max(1, maxEvents)
      if (enabled === this.enabled) return
      this.enabled = enabled
      if (enabled) this.install()
      else this.uninstall()
    } catch {
      // Telemetry never breaks the panel.
    }
  }

  get active() {
    return this.enabled
  }

  private install() {
    if (typeof window === 'undefined') return
    this.session = randomSession()
    const on: Listen = (target, type, fn, capture = false) => {
      target.addEventListener(type, fn as EventListener, { capture, passive: true })
      this.teardown.push(() => target.removeEventListener(type, fn as EventListener, { capture }))
    }
    on(document, 'click', ((e: MouseEvent) => {
      this.interacted()
      if (e.detail > 0) this.counters.clicks++ // a click from the keyboard has detail 0: it counts as a key press
    }) as never, true)
    on(document, 'pointerdown', (() => this.counters.pointers++) as never, true)
    on(document, 'keydown', ((e: KeyboardEvent) => {
      this.interacted()
      if (!e.repeat) this.counters.keys++ // the key itself is never read
    }) as never, true)
    this.watchChanges()
    this.watchScroll(on)
    on(window, 'error', (() => this.error('js')) as never)
    on(window, 'unhandledrejection', (() => this.error('promise')) as never)
    on(document, 'visibilitychange', (() => {
      if (document.visibilityState === 'hidden') this.leaveScreen(true)
    }) as never)
    // The page is going away for good (not entering the back-forward cache): a send that started and did not end is abandoned.
    on(window, 'pagehide', ((e: PageTransitionEvent) => {
      if (e.persisted) return
      this.leaving = true // requests still in flight are cancelled by the browser: that is not a network error
      this.abandon()
      this.leaveScreen(true)
    }) as never)
    this.observePerformance()
  }

  private uninstall() {
    for (const off of this.teardown.splice(0)) off()
    this.queue = []
    this.open = null
    this.armed = {}
    this.screen = null
    this.firstScreen = true
    this.leaving = false
  }

  /** The person did something: the clock of «how long until the page showed anything» starts here. */
  private interacted() {
    this.interactionAt = this.deps.now()
    this.changeAt = undefined
  }

  /**
   * The first change to the page after an interaction, once it is painted, is the first feedback the person sees. One
   * observer for the whole page records it; it reads no content, only that something changed.
   */
  private watchChanges() {
    if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return
    const observer = new MutationObserver(() => {
      if (this.changePending) return
      this.changePending = true
      this.deps.afterPaint(() => {
        this.changePending = false
        const t = this.deps.now()
        if (this.interactionAt !== undefined && this.changeAt === undefined) this.changeAt = t
        if (this.open && this.open.feedbackAt === undefined && t >= this.open.startedAt) this.open.feedbackAt = t
      })
    })
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true })
    this.teardown.push(() => observer.disconnect())
  }

  /** A scroll gesture is a run of scroll events ending in a frame with none: no timer, the frame cadence decides. */
  private watchScroll(on: Listen) {
    const last = new WeakMap<object, number>()
    let scrolled = false
    let waiting = false
    const frame = () => {
      if (scrolled) {
        scrolled = false
        this.deps.afterPaint(frame)
      } else {
        waiting = false
        this.counters.scrollEvents++
      }
    }
    on(document, 'scroll', ((e: Event) => {
      const target = e.target as Element | Document
      const top = target instanceof Document ? target.documentElement.scrollTop : target.scrollTop
      this.counters.scrollPx += Math.abs(top - (last.get(target) ?? top))
      last.set(target, top)
      scrolled = true
      if (!waiting) {
        waiting = true
        this.deps.afterPaint(frame)
      }
    }) as never, true)
  }

  private observePerformance() {
    if (typeof PerformanceObserver === 'undefined') return
    const supported = PerformanceObserver.supportedEntryTypes ?? []
    const watch = (type: string, onEntry: (entry: PerformanceEntry & Record<string, number | boolean>) => void, options: PerformanceObserverInit = {}) => {
      if (!supported.includes(type)) return
      try {
        const observer = new PerformanceObserver((list) => {
          try {
            for (const entry of list.getEntries()) onEntry(entry as never)
          } catch {
            // A malformed entry is skipped.
          }
        })
        observer.observe({ type, buffered: true, ...options })
        this.teardown.push(() => observer.disconnect())
      } catch {
        // The browser refused this entry type: that metric is simply not reported.
      }
    }
    watch('layout-shift', (e) => this.shift.add(e.startTime, e.value as number, Boolean(e.hadRecentInput)))
    watch('longtask', (e) => {
      this.longTasks++
      this.longTaskMs += Math.round(e.duration)
    })
    watch('event', (e) => {
      const id = e.interactionId as number
      if (id > 0) this.interactions.set(id, Math.max(this.interactions.get(id) ?? 0, e.duration))
    }, { durationThreshold: 16 } as PerformanceObserverInit) // 16 ms is the smallest the Event Timing API allows to report (w3c.github.io/event-timing)
    watch('largest-contentful-paint', (e) => {
      this.lcp = e.startTime
    })
  }

  // ---- Screens

  /** Called while the new screen renders (before the commit): marks when the change began. */
  routeRenderStarted() {
    this.renderStartedAt = this.deps.now()
  }

  /** The route changed. Closes the previous screen's usage and vitals, and opens the next. */
  enterScreen(screen: Screen) {
    try {
      if (!this.enabled || screen === this.screen) return
      const from = this.screen
      this.leaveScreen(false)
      this.screen = screen
      this.screenEnteredAt = this.renderStartedAt || this.deps.now()
      this.counters.screens++
      const first = this.firstScreen
      this.firstScreen = false
      if (first) this.firstScreenName = screen
      // Entering a screen is where the tasks that live in it begin to be counted.
      if (screen === 'home') this.armed.send_publish = { ...this.counters }
      if (screen === 'message-detail') {
        this.armed.reply = { ...this.counters }
        this.armed.close = { ...this.counters }
      }
      const started = this.screenEnteredAt
      this.deps.afterPaint(() => {
        try {
          const painted = this.deps.now()
          this.push({ type: 'navigation', screen, from, render_ms: Math.max(0, Math.round(painted - started)) })
          // Time to interactive of the page load: from the start of the document to the first paint of the first screen.
          if (first) this.interactiveMs = Math.round(painted)
        } catch {
          // Silent.
        }
      })
    } catch {
      // Silent.
    }
  }

  /**
   * Writes the usage and the vitals of the current screen since the last time they were written, and starts over. It is
   * called when the person changes screen, when the page is hidden and when it goes away; in the last two the screen
   * stays open, so a visit can arrive in more than one piece.
   */
  private leaveScreen(send: boolean) {
    if (!this.screen) return
    const screen = this.screen
    const now = this.deps.now()
    const c = this.counters
    const f = this.screenFrom
    const { w, h } = this.deps.viewport()
    this.push({
      type: 'screen_usage', screen, dwell_ms: Math.max(0, Math.round(now - this.screenEnteredAt)),
      clicks: c.clicks - f.clicks, scroll_events: c.scrollEvents - f.scrollEvents, scroll_px: Math.round(c.scrollPx - f.scrollPx),
      key_presses: c.keys - f.keys, pointer_presses: c.pointers - f.pointers, viewport_w: w, viewport_h: h
    })
    const vitals: Fields = { type: 'vitals', screen, cls: Number(this.shift.value.toFixed(4)), long_tasks: this.longTasks, long_task_ms: this.longTaskMs }
    const inp = interactionToNextPaint([...this.interactions.values()])
    if (inp !== undefined) vitals.inp_ms = Math.round(inp)
    // The page-load metrics belong to the screen the document first rendered.
    if (screen === this.firstScreenName) {
      if (this.lcp !== undefined) vitals.lcp_ms = Math.round(this.lcp)
      if (this.interactiveMs !== undefined) vitals.interactive_ms = this.interactiveMs
    }
    this.push(vitals)
    this.screenEnteredAt = now
    this.screenFrom = { ...c }
    this.interactions.clear()
    this.longTasks = 0
    this.longTaskMs = 0
    this.shift = new LayoutShift()
    if (send) this.flush()
  }

  // ---- Errors

  /** An error without its message: the kind, the screen and, for the network, the status and the route template. */
  error(kind: ErrorKind, extra: { status?: number; endpoint?: string } = {}) {
    try {
      if (!this.enabled) return
      const fields: Fields = { type: 'error', kind, screen: this.screen ?? 'home' }
      if (extra.status !== undefined) fields.status = extra.status
      if (extra.endpoint) fields.endpoint = extra.endpoint
      this.push(fields)
    } catch {
      // Silent.
    }
  }

  // ---- Tasks, inferred from the API traffic

  /**
   * An API request is about to leave. Returns the function to call with the outcome. `body` is the parsed answer only
   * when it is an object; of it, only its `status` word is read.
   */
  request(method: string, path: string): (result: { status: number; body?: unknown }) => void {
    try {
      if (!this.enabled) return noop
      const route = endpointOf(path)
      const verb = method.toUpperCase()
      const t0 = this.deps.now()
      if (verb === 'POST' && route === '/inputs') this.beginSend(t0)
      return (result) => {
        try {
          this.settle(verb, route, result, t0)
        } catch {
          // Silent.
        }
      }
    } catch {
      return noop
    }
  }

  private settle(verb: string, route: string, result: { status: number; body?: unknown }, t0: number) {
    const ok = result.status >= 200 && result.status < 300
    if (!ok && !(result.status === 401 && route === '/me') && !(result.status === 0 && this.leaving)) {
      if (route !== '/telemetry/ui') this.error(result.status === 0 ? 'network' : 'http', { status: result.status, endpoint: route })
    }
    if (verb === 'POST' && route === '/inputs' && !ok && this.open?.task === 'send_publish') {
      this.endTask('failed')
      return
    }
    if (verb === 'GET' && route === '/inputs/:id' && ok && this.open?.task === 'send_publish') {
      const status = (result.body as { status?: unknown } | undefined)?.status
      if (status === 'proposed') this.analysisVisible()
      if (status === 'failed') this.endTask('failed')
    }
    if (!ok) return
    if (verb === 'POST' && route === '/inputs/:id/publish' && this.open?.task === 'send_publish') this.endTask('completed') // at once: a frame later the page may already be gone
    if (verb === 'POST' && route === '/messages/:id/replies') this.completeSimple('reply', t0)
    if (verb === 'POST' && route === '/messages/:id/close') this.completeSimple('close', t0)
  }

  private beginSend(requested: number) {
    if (this.open) this.abandon() // a second send while one is open: the first never got published
    // The send began with the interaction that asked for it, a moment before the request left.
    const startedAt = this.interactionAt !== undefined && this.interactionAt <= requested ? this.interactionAt : requested
    const seen = this.changeAt !== undefined && this.changeAt >= startedAt ? this.changeAt : undefined
    this.open = { task: 'send_publish', startedAt, from: this.armed.send_publish ?? { ...this.counters }, feedbackAt: seen }
  }

  /** The analysis of the open send is on screen (the job's `done` arrived or the input came back as proposed). */
  analysisVisible() {
    try {
      const task = this.open
      if (!this.enabled || !task || task.task !== 'send_publish' || task.analysisAt !== undefined) return
      this.deps.afterPaint(() => {
        if (this.open === task && task.analysisAt === undefined) task.analysisAt = this.deps.now()
      })
    } catch {
      // Silent.
    }
  }

  private completeSimple(task: TaskName, t0: number) {
    const from = this.armed[task]
    if (!from) return
    this.emitTask(task, 'completed', t0, from, {})
  }

  private endTask(outcome: TaskOutcome) {
    const open = this.open
    if (!open) return
    this.open = null
    const end = this.deps.now()
    const stages: Fields = {}
    // Each stage is the time between two moments that were seen; one that was not seen leaves its stage out.
    if (open.feedbackAt !== undefined) stages.stage_feedback_ms = Math.max(0, Math.round(open.feedbackAt - open.startedAt))
    if (open.analysisAt !== undefined) stages.stage_analysis_ms = Math.max(0, Math.round(open.analysisAt - (open.feedbackAt ?? open.startedAt)))
    if (outcome === 'completed' && open.analysisAt !== undefined) stages.stage_publish_ms = Math.max(0, Math.round(end - open.analysisAt))
    this.emitTask(open.task, outcome, open.startedAt, open.from, stages, end)
  }

  /** Called when the page is going away: a send that started and did not end is abandoned. */
  abandon() {
    try {
      if (this.open) this.endTask('abandoned')
    } catch {
      // Silent.
    }
  }

  private emitTask(task: TaskName, outcome: TaskOutcome, startedAt: number, from: Counters, stages: Fields, end = this.deps.now()) {
    const c = this.counters
    this.push({
      type: 'task', task, outcome, duration_ms: Math.max(0, Math.round(end - startedAt)),
      clicks: c.clicks - from.clicks, scroll_events: c.scrollEvents - from.scrollEvents, scroll_px: Math.round(c.scrollPx - from.scrollPx),
      key_presses: c.keys - from.keys, screens: Math.max(1, c.screens - from.screens + 1), ...stages
    })
    // Whatever the person does next is a new journey: every task of the screen counts again from here.
    for (const name of Object.keys(this.armed) as TaskName[]) this.armed[name] = { ...c }
    this.flush()
  }

  // ---- Queue and sending

  private push(fields: Fields) {
    if (!this.enabled || !this.budget.take(this.deps.now())) return
    this.queue.push({ at: this.deps.now(), fields })
    if (this.queue.length >= this.maxEvents) this.flush()
  }

  /** Sends what is queued. A failed send is dropped: telemetry never retries and never waits. */
  flush() {
    try {
      if (!this.enabled || this.queue.length === 0) return
      const now = this.deps.now()
      const batch = this.queue.splice(0, this.maxEvents)
      const events = batch.map((q) => {
        const out: Record<string, string | number | null> = { ...q.fields, age_ms: Math.max(0, Math.round(now - q.at)) }
        for (const key of Object.keys(out)) if (out[key] === null || out[key] === undefined) delete out[key]
        return out
      })
      this.deps.send(JSON.stringify({ session: this.session, events }))
      if (this.queue.length > 0) this.flush()
    } catch {
      // Silent.
    }
  }
}

const noop = () => {}

function randomSession(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ---- The panel's instance

/**
 * `fetch` with `keepalive`, not `navigator.sendBeacon`: a beacon cannot carry the `X-Team-Request` header that the
 * server demands of every request with a session (src/identity/csrf.js), and a request with `keepalive` does survive the
 * page closing, which is what the beacon is for (fetch.spec.whatwg.org, informe 09 §4).
 */
function sendWithFetch(body: string) {
  try {
    void fetch('/api/telemetry/ui', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Team-Request': 'panel' },
      credentials: 'include',
      keepalive: true,
      body,
    }).catch(() => {})
  } catch {
    // Silent.
  }
}

const afterPaint = (fn: () => void) => {
  try {
    requestAnimationFrame(() => requestAnimationFrame(fn)) // the second frame is after the first paint of the change
  } catch {
    fn()
  }
}

export const telemetry = new UiTelemetry({
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  send: sendWithFetch,
  afterPaint,
  viewport: () => viewportClass(window.innerWidth, window.innerHeight),
})
