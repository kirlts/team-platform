import { useQueryClient } from '@tanstack/react-query'
import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { API_BASE } from './api'
import { connectEvents, EventsStore, type JobProgress } from './events-store'

const EventsContext = createContext<EventsStore | null>(null)

/** Opens the session's single SSE stream and dispatches its events. It goes inside the signed-in session. */
export function EventsProvider({
  children,
  store: given,
  connect = true,
}: {
  children: ReactNode
  /** Own store (tests). By default one is created. */
  store?: EventsStore
  /** False in tests: does not open the real stream. */
  connect?: boolean
}) {
  const queryClient = useQueryClient()
  const store = useMemo(() => given ?? new EventsStore(), [given])

  useEffect(() => {
    if (!connect) return
    const offMessage = store.onNewMessage(() => {
      void queryClient.invalidateQueries({ queryKey: ['messages'] })
      void queryClient.invalidateQueries({ queryKey: ['areas'] })
    })
    const close = connectEvents(store, `${API_BASE}/events`, undefined, () => {
      void queryClient.invalidateQueries({ queryKey: ['inputs'] })
      void queryClient.invalidateQueries({ queryKey: ['messages'] })
    })
    return () => {
      offMessage()
      close()
    }
  }, [store, queryClient, connect])

  return <EventsContext.Provider value={store}>{children}</EventsContext.Provider>
}

export function useEventsStore(): EventsStore {
  const store = useContext(EventsContext)
  if (!store) throw new Error('useEventsStore outside EventsProvider')
  return store
}

export function useEventsSnapshot() {
  const store = useEventsStore()
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}

/**
 * Ephemeral progress of a job, read from the single stream. When `done` arrives it invalidates the
 * input query to fetch the proposal.
 */
export function useJobProgress(jobId: string | undefined, inputId: string | undefined): JobProgress | undefined {
  const store = useEventsStore()
  const queryClient = useQueryClient()
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const progress = jobId ? snap.progress[jobId] : undefined
  const done = progress?.done ?? false

  useEffect(() => {
    if (done && inputId) void queryClient.invalidateQueries({ queryKey: ['inputs', inputId] })
  }, [done, inputId, queryClient])

  return progress
}
