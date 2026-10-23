import { useQueryClient } from '@tanstack/react-query';
import { createContext, createElement, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import { EventsStore } from '../events.js';
import { queryKeys } from '../keys.js';
import { watchEvents } from '../watch.js';
import { useOptionalTeamClient } from './context.js';
const EventsContext = createContext(null);
/** Opens the session's single SSE stream and dispatches its events. It goes inside the signed-in session. */
export function EventsProvider({ children, store: given, connect = true, }) {
    const client = useOptionalTeamClient();
    const queryClient = useQueryClient();
    const store = useMemo(() => given ?? new EventsStore(), [given]);
    useEffect(() => {
        if (!connect)
            return;
        if (!client)
            throw new Error('EventsProvider with connect needs a TeamClientProvider above it');
        return watchEvents({ client, store, queryClient });
    }, [client, store, queryClient, connect]);
    return createElement(EventsContext.Provider, { value: store }, children);
}
export function useEventsStore() {
    const store = useContext(EventsContext);
    if (!store)
        throw new Error('useEventsStore outside EventsProvider');
    return store;
}
export function useEventsSnapshot() {
    const store = useEventsStore();
    return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
/**
 * Ephemeral progress of a job, read from the single stream. When `done` arrives it invalidates the
 * input's query to bring the proposal.
 */
export function useJobProgress(jobId, inputId) {
    const store = useEventsStore();
    const queryClient = useQueryClient();
    const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);
    const progress = jobId ? snap.progress[jobId] : undefined;
    const done = progress?.done ?? false;
    useEffect(() => {
        if (done && inputId)
            void queryClient.invalidateQueries({ queryKey: queryKeys.input(inputId) });
    }, [done, inputId, queryClient]);
    return progress;
}
