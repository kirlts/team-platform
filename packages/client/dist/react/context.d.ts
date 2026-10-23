import { type ReactNode } from 'react';
import type { TeamClient } from '../client.js';
import { type TeamQueries } from '../queries.js';
/** Gives the client to every hook under it. It goes inside the `QueryClientProvider`, or beside it. */
export declare function TeamClientProvider({ client, children }: {
    client: TeamClient;
    children?: ReactNode;
}): import("react").FunctionComponentElement<import("react").ProviderProps<TeamClient | null>>;
/** The client of the nearest `TeamClientProvider`, or null. */
export declare function useOptionalTeamClient(): TeamClient | null;
/** The client of the nearest `TeamClientProvider`; throws outside one. */
export declare function useTeamClient(): TeamClient;
/** The reads (`{ queryKey, queryFn }`) of the client in the context; for `queryClient.fetchQuery` and `prefetchQuery`. */
export declare function useTeamQueries(): TeamQueries;
