import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import type { TeamClient } from '../src/client.js'
import { connectEvents, EventsStore } from '../src/events.js'
import { watchEvents } from '../src/watch.js'

// The steps of a session reach the screen as a `message` event with `reason: 'changed'` and the root `session`: they make only their own list stale.

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
}

describe('the steps of a session', () => {
  it('a change on the root «session» reads again the list of that message and nothing else', async () => {
    const reads = { session: 0, otherSession: 0, message: 0, messages: 0 }
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
    const watch = (queryKey: unknown[], counter: keyof typeof reads) => new QueryObserver(queryClient, { queryKey, queryFn: async () => ({ n: ++reads[counter] }) }).subscribe(() => {})
    const off = [watch(['session', '7'], 'session'), watch(['message', '7'], 'message'), watch(['messages', 'list'], 'messages')]
    const gone = watch(['session', '8'], 'otherSession')
    const client = { events: { connect: (store: EventsStore, o: { onReconnect?: () => void }) => connectEvents(store, '/api/events', () => new FakeEventSource() as never, o.onReconnect) } } as unknown as TeamClient
    const stop = watchEvents({ client, store: new EventsStore(), queryClient })
    await new Promise((r) => setTimeout(r, 20))
    gone()
    const before = { ...reads }
    FakeEventSource.last.onopen?.()
    FakeEventSource.last.emit('replay', { complete: true, from: 0 })
    FakeEventSource.last.emit('message', { reason: 'changed', roots: ['session'], message_id: '7' })
    await new Promise((r) => setTimeout(r, 20))
    expect(reads.session - before.session).toBe(1)
    expect(reads.message).toBe(before.message)
    expect(reads.messages).toBe(before.messages)
    expect(reads.otherSession).toBe(before.otherSession) // not mounted: stale, read when it is
    for (const o of off) o()
    stop()
  })
})
