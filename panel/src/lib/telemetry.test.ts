import { afterEach, describe, expect, it } from 'vitest'
import { EventBudget, LayoutShift, UiTelemetry, endpointOf, interactionToNextPaint, screenOf, viewportClass } from './telemetry'

describe('screens and routes', () => {
  it('maps every path of the panel to a screen of the closed list', () => {
    expect(screenOf('/')).toBe('home')
    expect(screenOf('/messages')).toBe('messages')
    expect(screenOf('/messages/7f3a')).toBe('message-detail')
    expect(screenOf('/areas/idea')).toBe('areas')
    expect(screenOf('/connections/telegram')).toBe('connections')
    expect(screenOf('/team')).toBe('team')
    expect(screenOf('/settings')).toBe('settings')
    expect(screenOf('/algo/que/no/existe')).toBe('not-found')
  })

  it('turns an API address into a route template with no identifier and no query', () => {
    expect(endpointOf('/inputs')).toBe('/inputs')
    expect(endpointOf('/inputs/8c1f2a9b/publish')).toBe('/inputs/:id/publish')
    expect(endpointOf('/api/messages/42/replies?kind=answer&q=hola%20Ana')).toBe('/messages/:id/replies')
    expect(endpointOf('/areas/3/templates/9')).toBe('/areas/:id/templates/:id')
    // Whatever a path holds that is not lowercase letters and hyphens never survives, text included.
    expect(endpointOf('/members/Ana%20Perez')).toBe('/members/:id')
    expect(endpointOf('/messages/a@b.cl/close')).toBe('/messages/:id/close')
    expect(endpointOf('/settings/connections/mi-gateway/key')).toBe('/settings/connections/:id/key')
  })
})

describe('web vitals', () => {
  it('CLS is the largest session window and ignores shifts that follow an input', () => {
    const cls = new LayoutShift()
    cls.add(100, 0.05, false)
    cls.add(600, 0.04, false) // same window: gap under 1 s
    cls.add(2000, 0.02, false) // a new window: gap of 1.4 s
    cls.add(2100, 0.5, true) // after a person's input: not counted
    expect(cls.value).toBeCloseTo(0.09, 5)
    const long = new LayoutShift()
    for (let t = 0; t <= 6000; t += 500) long.add(t, 0.01, false) // a window closes after 5 s even without a gap
    expect(long.value).toBeLessThan(0.13)
    expect(long.value).toBeGreaterThan(0.1)
  })

  it('INP is the longest interaction, ignoring one more for every fifty', () => {
    expect(interactionToNextPaint([])).toBeUndefined()
    expect(interactionToNextPaint([40, 300, 120])).toBe(300)
    const many = Array.from({ length: 100 }, (_, i) => i + 1)
    expect(interactionToNextPaint(many)).toBe(98) // 100 interactions: the two highest are ignored
  })
})

describe('what leaves the browser is coarse', () => {
  it('the window is a class, never its exact size', () => {
    expect(viewportClass(1440, 937)).toEqual({ w: 1280, h: 900 })
    expect(viewportClass(390, 844)).toEqual({ w: 0, h: 800 })
    expect(viewportClass(1536, 1000)).toEqual({ w: 1536, h: 1000 })
  })

  it('the event budget lets a burst of 100 through, then 10 a second', () => {
    const budget = new EventBudget()
    let taken = 0
    for (let i = 0; i < 150; i++) if (budget.take(1)) taken++
    expect(taken).toBe(100)
    expect(budget.take(1001)).toBe(true) // one second later, ten more tokens
    let more = 0
    for (let i = 0; i < 20; i++) if (budget.take(1001)) more++
    expect(more).toBe(9)
  })
})

/** A telemetry instance with a clock the test moves and a network that records what it was given. */
function rig() {
  let t = 1000
  const sent: Array<{ session: string; events: Array<Record<string, unknown>> }> = []
  const telemetry = new UiTelemetry({
    now: () => t,
    send: (body) => sent.push(JSON.parse(body)),
    afterPaint: (fn) => fn(),
    viewport: () => ({ w: 1280, h: 800 }),
  })
  const events = () => sent.flatMap((b) => b.events)
  return { telemetry, sent, events, advance: (ms: number) => (t += ms) }
}

describe('tasks inferred from the traffic', () => {
  const instances: UiTelemetry[] = []
  afterEach(() => instances.splice(0).forEach((x) => x.configure(false, 1)))

  it('a send that is published is one task with its clicks and its stages', async () => {
    const { telemetry, events, advance } = rig()
    instances.push(telemetry)
    telemetry.configure(true, 50)
    telemetry.routeRenderStarted()
    telemetry.enterScreen('home')
    document.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    advance(50)
    const created = telemetry.request('POST', '/inputs')
    advance(30)
    created({ status: 202 })
    document.body.append(document.createElement('div')) // the first change the person sees after sending
    await Promise.resolve()
    advance(4000)
    telemetry.analysisVisible()
    document.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    advance(2000)
    const publish = telemetry.request('POST', '/inputs/8c1f/publish')
    publish({ status: 200, body: { message_ids: ['1'] } })
    const task = events().find((e) => e.type === 'task')
    expect(task).toMatchObject({ task: 'send_publish', outcome: 'completed', clicks: 2, screens: 1 })
    expect(task?.duration_ms).toBe(6080) // from the click that asked for the send, 50 ms before the request
    expect(task?.stage_feedback_ms).toBe(80)
    expect(task?.stage_analysis_ms).toBe(4000)
    expect(task?.stage_publish_ms).toBe(2000)
  })

  it('the stages are the first paint of the marked progress and analysis, not the arrival of the data (H-1705)', async () => {
    const { telemetry, events, advance } = rig()
    instances.push(telemetry)
    telemetry.configure(true, 50)
    telemetry.routeRenderStarted()
    telemetry.enterScreen('home')
    // An analysis of an earlier send is open: it is not this send's.
    const earlier = document.createElement('section')
    earlier.setAttribute('data-ui-stage', 'analysis')
    document.body.append(earlier)
    await Promise.resolve()
    document.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    telemetry.request('POST', '/inputs')({ status: 202 })
    advance(200)
    const progress = document.createElement('div')
    progress.setAttribute('data-ui-stage', 'progress')
    document.body.append(progress)
    await Promise.resolve()
    advance(2300)
    telemetry.analysisVisible() // the data arrived
    advance(400)
    const analysis = document.createElement('section')
    analysis.setAttribute('data-ui-stage', 'analysis')
    document.body.append(analysis) // and was painted 400 ms later
    await Promise.resolve()
    advance(1000)
    telemetry.request('POST', '/inputs/8c1f/publish')({ status: 200, body: {} })
    const task = events().find((e) => e.type === 'task')
    expect(task).toMatchObject({ task: 'send_publish', outcome: 'completed', stage_feedback_ms: 200, stage_analysis_ms: 2700, stage_publish_ms: 1000 })
    earlier.remove()
    progress.remove()
    analysis.remove()
  })

  it('a send whose marked elements never paint keeps the first change and the arrival of the analysis as its stages (H-1705)', async () => {
    const { telemetry, events, advance } = rig()
    instances.push(telemetry)
    telemetry.configure(true, 50)
    telemetry.enterScreen('home')
    document.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    telemetry.request('POST', '/inputs')({ status: 202 })
    advance(100)
    const change = document.createElement('div')
    document.body.append(change)
    await Promise.resolve()
    advance(900)
    telemetry.analysisVisible()
    telemetry.request('POST', '/inputs/8c1f/publish')({ status: 200, body: {} })
    expect(events().find((e) => e.type === 'task')).toMatchObject({ stage_feedback_ms: 100, stage_analysis_ms: 900 })
    change.remove()
  })

  it('a send left unpublished when the page goes away is an abandonment', () => {
    const { telemetry, events, advance } = rig()
    instances.push(telemetry)
    telemetry.configure(true, 50)
    telemetry.enterScreen('home')
    telemetry.request('POST', '/inputs')({ status: 202 })
    advance(900)
    window.dispatchEvent(new Event('pagehide'))
    expect(events().find((e) => e.type === 'task')).toMatchObject({ task: 'send_publish', outcome: 'abandoned', duration_ms: 900 })
  })

  it('a reply and a close are tasks of the message screen', () => {
    const { telemetry, events, advance } = rig()
    instances.push(telemetry)
    telemetry.configure(true, 50)
    telemetry.enterScreen('message-detail')
    document.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    advance(1500)
    telemetry.request('POST', '/messages/12/replies')({ status: 201 })
    advance(500)
    telemetry.request('POST', '/messages/12/close')({ status: 200 })
    const tasks = events().filter((e) => e.type === 'task')
    expect(tasks.map((x) => x.task)).toEqual(['reply', 'close'])
    expect(tasks[0]).toMatchObject({ clicks: 1, outcome: 'completed' })
    expect(tasks[1]).toMatchObject({ clicks: 0, outcome: 'completed' })
  })

  it('a failed request is an error with its status and template, and nothing of the body', () => {
    const { telemetry, events } = rig()
    instances.push(telemetry)
    telemetry.configure(true, 50)
    telemetry.enterScreen('messages')
    telemetry.request('GET', '/messages/5512?q=texto%20privado')({ status: 500, body: { message: 'texto privado' } })
    telemetry.request('GET', '/areas')({ status: 0 })
    telemetry.flush()
    expect(events().filter((e) => e.type === 'error')).toEqual([
      { type: 'error', kind: 'http', screen: 'messages', status: 500, endpoint: '/messages/:id', age_ms: 0 },
      { type: 'error', kind: 'network', screen: 'messages', status: 0, endpoint: '/areas', age_ms: 0 },
    ])
  })
})

describe('requests cancelled by the page going away', () => {
  it('are not network errors', () => {
    const { telemetry, events } = rig()
    telemetry.configure(true, 50)
    telemetry.enterScreen('home')
    const pending = telemetry.request('GET', '/messages')
    window.dispatchEvent(new Event('pagehide'))
    pending({ status: 0 }) // the browser cancels it while unloading
    telemetry.flush()
    expect(events().filter((e) => e.type === 'error')).toEqual([])
    telemetry.configure(false, 50)
  })
})

describe('the panel does not depend on it', () => {
  it('off, it records and sends nothing; on, a failing network never throws', () => {
    const off = rig()
    off.telemetry.enterScreen('home')
    off.telemetry.request('POST', '/inputs')({ status: 202 })
    off.telemetry.flush()
    expect(off.sent).toEqual([])

    const broken = new UiTelemetry({
      now: () => 0,
      send: () => {
        throw new Error('network down')
      },
      afterPaint: (fn) => fn(),
      viewport: () => {
        throw new Error('no window')
      },
    })
    broken.configure(true, 1)
    expect(() => {
      broken.enterScreen('home')
      broken.error('js')
      broken.request('GET', '/me')({ status: 200 })
      broken.flush()
    }).not.toThrow()
    broken.configure(false, 1)
  })

  it('switching it off removes the listeners and forgets the queue', () => {
    const { telemetry, sent } = rig()
    telemetry.configure(true, 50)
    telemetry.enterScreen('home')
    telemetry.configure(false, 50)
    document.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    window.dispatchEvent(new Event('pagehide'))
    telemetry.flush()
    expect(sent).toEqual([])
  })

  it('every event carries only numbers and the closed vocabulary', () => {
    const { telemetry, events, advance } = rig()
    telemetry.configure(true, 50)
    telemetry.enterScreen('home')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'contraseña-secreta' }))
    advance(100)
    telemetry.enterScreen('messages')
    telemetry.flush()
    for (const ev of events()) {
      for (const [key, value] of Object.entries(ev)) {
        if (typeof value === 'string') expect(value).toMatch(/^[a-z_-]+$/) // type, screen, kind, task, outcome: never a sentence
        else expect(typeof value, key).toBe('number')
      }
    }
    expect(JSON.stringify(events())).not.toContain('secreta')
    expect(events().find((e) => e.type === 'screen_usage')).toMatchObject({ key_presses: 2 })
    telemetry.configure(false, 50)
  })
})
