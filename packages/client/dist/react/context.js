import { createContext, createElement, useContext, useMemo } from 'react';
import { createQueries } from '../queries.js';
const TeamClientContext = createContext(null);
/** Gives the client to every hook under it. It goes inside the `QueryClientProvider`, or beside it. */
export function TeamClientProvider({ client, children }) {
    return createElement(TeamClientContext.Provider, { value: client }, children);
}
/** The client of the nearest `TeamClientProvider`, or null. */
export function useOptionalTeamClient() {
    return useContext(TeamClientContext);
}
/** The client of the nearest `TeamClientProvider`; throws outside one. */
export function useTeamClient() {
    const client = useContext(TeamClientContext);
    if (!client)
        throw new Error('useTeamClient needs a TeamClientProvider above it');
    return client;
}
/** The reads (`{ queryKey, queryFn }`) of the client in the context; for `queryClient.fetchQuery` and `prefetchQuery`. */
export function useTeamQueries() {
    const client = useTeamClient();
    return useMemo(() => createQueries(client), [client]);
}
