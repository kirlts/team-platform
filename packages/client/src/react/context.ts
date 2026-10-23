import { createContext, createElement, useContext, useMemo, type ReactNode } from 'react'
import type { TeamClient } from '../client.js'
import { createQueries, type TeamQueries } from '../queries.js'

const TeamClientContext = createContext<TeamClient | null>(null)

/** Gives the client to every hook under it. It goes inside the `QueryClientProvider`, or beside it. */
export function TeamClientProvider({ client, children }: { client: TeamClient; children?: ReactNode }) {
  return createElement(TeamClientContext.Provider, { value: client }, children)
}

/** The client of the nearest `TeamClientProvider`, or null. */
export function useOptionalTeamClient(): TeamClient | null {
  return useContext(TeamClientContext)
}

/** The client of the nearest `TeamClientProvider`; throws outside one. */
export function useTeamClient(): TeamClient {
  const client = useContext(TeamClientContext)
  if (!client) throw new Error('useTeamClient needs a TeamClientProvider above it')
  return client
}

/** The reads (`{ queryKey, queryFn }`) of the client in the context; for `queryClient.fetchQuery` and `prefetchQuery`. */
export function useTeamQueries(): TeamQueries {
  const client = useTeamClient()
  return useMemo(() => createQueries(client), [client])
}
