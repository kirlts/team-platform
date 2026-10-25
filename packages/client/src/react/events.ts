import { useQueryClient } from '@tanstack/react-query'
import { createContext, createElement, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { EventsStore, type JobProgress } from '../events.js'
import { queryKeys } from '../keys.js'
import { watchEvents } from '../watch.js'
import { useOptionalTeamClient } from './context.js'

const EventsContext = createContext<EventsStore | null>(null)

/** Opens the session's single SSE stream and dispatches its events. It goes inside the signed-in session. */
export function EventsProvider({
  children,
  store: given,
  connect = true,
}: {
  children?: ReactNode
  /** Own store (tests). By default one is created. */
  store?: EventsStore
  /** False in tests: it does not open the real stream. */
  connect?: boolean
}) {
  const client = useOptionalTeamClient()
  const queryClient = useQueryClient()
  const store = useMemo(() => given ?? new EventsStore(), [given])

  useEffect(() => {
    if (!connect) return
    if (!client) throw new Error('EventsProvider with connect needs a TeamClientProvider above it')
    return watchEvents({ client, store, queryClient })
  }, [client, store, queryClient, connect])

  return createElement(EventsContext.Provider, { value: store }, children)
}

export function useEventsStore(): EventsStore {
  const store = useContext(EventsContext)
  if (!store) throw new Error('useEventsStore outside EventsProvider')
  return store
}

/** The store when there is a session stream above, `null` in a piece drawn on its own (a test): for what listens to the events but can live without them. */
export function useOptionalEventsStore(): EventsStore | null {
  return useContext(EventsContext)
}

export function useEventsSnapshot() {
  const store = useEventsStore()
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}

/**
 * Ephemeral progress of a job, read from the single stream. When `done` arrives it invalidates the
 * input's query to bring the proposal.
 */
export function useJobProgress(jobId: string | undefined, inputId: string | undefined): JobProgress | undefined {
  const store = useEventsStore()
  const queryClient = useQueryClient()
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const progress = jobId ? snap.progress[jobId] : undefined
  const done = progress?.done ?? false

  useEffect(() => {
    if (done && inputId) void queryClient.invalidateQueries({ queryKey: queryKeys.input(inputId) })
  }, [done, inputId, queryClient])

  return progress
}
