import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { connectEvents, EventsStore, REOPEN_DELAYS_MS } from './events-store'
import { EventsProvider, useJobProgress } from './events'

// Reemplaza el contexto por una tienda propia para no abrir un EventSource real.
function wrapperWith(store: EventsStore, client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <EventsProvider store={store} connect={false}>
          {children}
        </EventsProvider>
      </QueryClientProvider>
    )
  }
}

class FakeEventSource {
  static instances: FakeEventSource[] = []
  readyState = 1
  onopen: ((e: Event) => void) | null = null
  onerror: ((e: Event) => void) | null = null
  onmessage: ((e: MessageEvent) => void) | null = null
  listeners = new Map<string, ((e: MessageEvent) => void)[]>()
  closed = false
  constructor(public url: string) {
    FakeEventSource.instances.push(this)
  }
  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn])
  }
  close() {
    this.closed = true
    this.readyState = 2
  }
  emit(type: string, data: unknown) {
    const e = { data: JSON.stringify(data) } as MessageEvent
    for (const fn of this.listeners.get(type) ?? []) fn(e)
  }
}

describe('EventsStore', () => {
  it('guarda el progreso por job_id y no retrocede con un evento repetido', () => {
    const store = new EventsStore()
    store.dispatch('progress', JSON.stringify({ job_id: 'j1', percent: 40, phrase: 'leyendo el documento' }))
    store.dispatch('progress', JSON.stringify({ job_id: 'j1', percent: 20, phrase: 'repetido' }))
    store.dispatch('progress', JSON.stringify({ job_id: 'j2', percent: 10, phrase: 'otro' }))
    const snap = store.getSnapshot()
    expect(snap.progress.j1.percent).toBe(40)
    expect(snap.progress.j2.percent).toBe(10)
  })

  it('infiere el tipo de evento por su forma cuando llega sin nombre', () => {
    const store = new EventsStore()
    store.dispatch(undefined, JSON.stringify({ job_id: 'j1', percent: 55, phrase: 'x' }))
    store.dispatch(undefined, JSON.stringify({ job_id: 'j1', done: true }))
    store.dispatch(undefined, JSON.stringify({ message_id: 'm1', title: 'Hola', author_id: 'u1' }))
    const snap = store.getSnapshot()
    expect(snap.progress.j1.done).toBe(true)
    expect(snap.progress.j1.percent).toBe(100)
    expect(snap.notices).toHaveLength(1)
    expect(snap.unread).toBe(1)
  })

  it('ignora JSON inválido y avisos repetidos', () => {
    const store = new EventsStore()
    store.dispatch('progress', 'no es json')
    store.dispatch('message', JSON.stringify({ message_id: 'm1', title: 'a', author_id: 'u' }))
    store.dispatch('message', JSON.stringify({ message_id: 'm1', title: 'a', author_id: 'u' }))
    expect(store.getSnapshot().notices).toHaveLength(1)
    store.markRead()
    expect(store.getSnapshot().unread).toBe(0)
  })
})

describe('connectEvents', () => {
  it('reparte los eventos nombrados y cierra al salir', () => {
    FakeEventSource.instances = []
    const store = new EventsStore()
    const close = connectEvents(store, '/api/events', (u) => new FakeEventSource(u) as never)
    const es = FakeEventSource.instances[0]
    expect(es.url).toBe('/api/events')
    es.emit('progress', { job_id: 'j1', percent: 30, phrase: 'leyendo' })
    expect(store.getSnapshot().progress.j1.percent).toBe(30)
    close()
    expect(es.closed).toBe(true)
  })

  it('reabre el flujo que el servidor cerró, con espera creciente', () => {
    vi.useFakeTimers()
    FakeEventSource.instances = []
    const store = new EventsStore()
    connectEvents(store, '/api/events', (u) => new FakeEventSource(u) as never)
    const first = FakeEventSource.instances[0]
    first.readyState = 2
    first.onerror?.(new Event('error'))
    expect(FakeEventSource.instances).toHaveLength(1)
    vi.advanceTimersByTime(REOPEN_DELAYS_MS[0])
    expect(FakeEventSource.instances).toHaveLength(2)
    vi.useRealTimers()
  })

  it('avisa la reconexión sólo después de una caída', () => {
    FakeEventSource.instances = []
    const onReconnect = vi.fn()
    connectEvents(new EventsStore(), '/api/events', (u) => new FakeEventSource(u) as never, onReconnect)
    const es = FakeEventSource.instances[0]
    es.onopen?.(new Event('open'))
    expect(onReconnect).not.toHaveBeenCalled()
    es.onerror?.(new Event('error'))
    es.onopen?.(new Event('open'))
    expect(onReconnect).toHaveBeenCalledTimes(1)
  })
})

describe('useJobProgress', () => {
  it('entrega el progreso del trabajo y al done invalida la consulta del input', () => {
    const store = new EventsStore()
    const client = new QueryClient()
    const spy = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useJobProgress('j1', 'i1'), { wrapper: wrapperWith(store, client) })
    expect(result.current).toBeUndefined()
    act(() => store.dispatch('progress', JSON.stringify({ job_id: 'j1', percent: 60, phrase: '3 de 5 adjuntos' })))
    expect(result.current?.percent).toBe(60)
    expect(result.current?.phrase).toBe('3 de 5 adjuntos')
    expect(spy).not.toHaveBeenCalled()
    act(() => store.dispatch('done', JSON.stringify({ job_id: 'j1', done: true })))
    expect(result.current?.done).toBe(true)
    expect(spy).toHaveBeenCalledWith({ queryKey: ['inputs', 'i1'] })
  })

  it('ignora el progreso de otros trabajos', () => {
    const store = new EventsStore()
    const { result } = renderHook(() => useJobProgress('j1', 'i1'), {
      wrapper: wrapperWith(store, new QueryClient()),
    })
    act(() => store.dispatch('progress', JSON.stringify({ job_id: 'otro', percent: 90, phrase: 'x' })))
    expect(result.current).toBeUndefined()
  })
})
