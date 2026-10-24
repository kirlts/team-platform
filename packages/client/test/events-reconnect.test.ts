import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TeamClient } from '../src/client.js'
import { connectEvents, EventsStore } from '../src/events.js'
import { watchEvents } from '../src/watch.js'

// The stream coming back after a drop and what the panel asks for again (the 7 lists of Inicio on every reconnection, measured
// 2026-10-24). A complete replay asks for nothing; an incomplete one asks only for what a mounted screen shows.

class FakeEventSource {
  static last: FakeEventSource
  readyState = 1
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  listeners = new Map<string, Array<(e: { data: string }) => void>>()
  constructor() {
    FakeEventSource.last = this
  }
  addEventListener(type: string, fn: (e: { data: string }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn])
  }
  close() {
    this.readyState = 2
  }
  emit(type: string, data: unknown) {
    for (const fn of this.listeners.get(type) ?? []) fn({ data: JSON.stringify(data) })
  }
  /** What the browser does on a network drop: error, then open again with Last-Event-ID. */
  drop() {
    this.onerror?.()
    this.onopen?.()
  }
}

const reads = { inputs: 0, messages: 0, messagesOtherArea: 0, areas: 0 }

function setup() {
  Object.assign(reads, { inputs: 0, messages: 0, messagesOtherArea: 0, areas: 0 })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  const observe = (queryKey: unknown[], counter: keyof typeof reads) => {
    const observer = new QueryObserver(queryClient, { queryKey, queryFn: async () => ({ n: ++reads[counter] }) })
    return observer.subscribe(() => {})
  }
  // Mounted: the lists of the screen on view. `messagesOtherArea` was read before and its screen is no longer mounted.
  const off = [observe(['inputs', 'list'], 'inputs'), observe(['messages', 'area-1'], 'messages'), observe(['areas'], 'areas')]
  const gone = observe(['messages', 'area-2'], 'messagesOtherArea')
  const client = { events: { connect: (store: EventsStore, o: { onReconnect?: () => void }) => connectEvents(store, '/api/events', () => new FakeEventSource() as never, o.onReconnect) } } as unknown as TeamClient
  const stop = watchEvents({ client, store: new EventsStore(), queryClient })
  return { queryClient, stop, gone, off }
}

const settle = () => new Promise((r) => setTimeout(r, 20))
afterEach(() => vi.restoreAllMocks())

describe('the stream coming back after a drop', () => {
  it('with a complete replay it asks for no list', async () => {
    const { stop, gone } = setup()
    await settle()
    gone() // its screen is unmounted
    const before = { ...reads }
    const es = FakeEventSource.last
    es.onopen?.()
    es.emit('replay', { complete: true, from: 0 })
    es.drop()
    es.emit('replay', { complete: true, from: 40 })
    es.emit('progress', { job_id: 'j1', percent: 50, phrase: 'leyendo' })
    await settle()
    expect(reads).toEqual(before)
    stop()
  })

  it('with an incomplete replay it reads again only what a mounted screen shows', async () => {
    const { stop, gone, queryClient } = setup()
    await settle()
    gone()
    const before = { ...reads }
    const es = FakeEventSource.last
    es.onopen?.()
    es.emit('replay', { complete: false, from: null })
    es.drop()
    es.emit('replay', { complete: false, from: 40 })
    await settle()
    expect(reads.inputs - before.inputs).toBe(1)
    expect(reads.messages - before.messages).toBe(1)
    expect(reads.areas).toBe(before.areas) // not part of what a drop makes stale
    expect(reads.messagesOtherArea).toBe(before.messagesOtherArea) // unmounted: marked stale, read when it is mounted again
    expect(queryClient.getQueryState(['messages', 'area-2'])?.isInvalidated).toBe(true)
    stop()
  })
})
