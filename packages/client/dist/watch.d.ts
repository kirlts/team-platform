import type { TeamClient } from './client.js';
import type { EventsStore } from './events.js';
import { type QueryClientLike } from './invalidations.js';
/**
 * Opens the session's single event stream and ties it to the cache: a message of somebody else makes the lists stale, and so
 * does the stream coming back after a drop. Returns the function that stops both. The progress of jobs is not in the cache:
 * it lives in `store`.
 */
export declare function watchEvents(o: {
    client: TeamClient;
    store: EventsStore;
    queryClient: QueryClientLike;
}): () => void;
