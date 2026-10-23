import { type ReactNode } from 'react';
import { EventsStore, type JobProgress } from '../events.js';
/** Opens the session's single SSE stream and dispatches its events. It goes inside the signed-in session. */
export declare function EventsProvider({ children, store: given, connect, }: {
    children?: ReactNode;
    /** Own store (tests). By default one is created. */
    store?: EventsStore;
    /** False in tests: it does not open the real stream. */
    connect?: boolean;
}): import("react").FunctionComponentElement<import("react").ProviderProps<EventsStore | null>>;
export declare function useEventsStore(): EventsStore;
export declare function useEventsSnapshot(): import("../events.js").EventsSnapshot;
/**
 * Ephemeral progress of a job, read from the single stream. When `done` arrives it invalidates the
 * input's query to bring the proposal.
 */
export declare function useJobProgress(jobId: string | undefined, inputId: string | undefined): JobProgress | undefined;
