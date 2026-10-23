import type { EventSourceLike } from './http.js';
import type { DoneEvent, NewMessageEvent, ProgressEvent } from './types.js';
export type { EventSourceLike };
export interface JobProgress {
    percent: number;
    phrase: string;
    /** Stable code of the step (H-3722); null from a server older than the codes. */
    code?: string | null;
    vars?: Record<string, number>;
    done: boolean;
    inputId?: string;
}
export interface Notice {
    key: string;
    message_id: string;
    title: string;
    author_id: string;
    at: string;
}
export interface EventsSnapshot {
    progress: Readonly<Record<string, JobProgress>>;
    notices: readonly Notice[];
    unread: number;
    connected: boolean;
}
export declare class EventsStore {
    private snap;
    private listeners;
    private doneListeners;
    private messageListeners;
    subscribe: (fn: () => void) => () => void;
    getSnapshot: () => EventsSnapshot;
    onDone(fn: (e: DoneEvent) => void): () => void;
    onNewMessage(fn: (e: NewMessageEvent) => void): () => void;
    private set;
    setConnected(connected: boolean): void;
    progress(e: ProgressEvent): void;
    done(e: DoneEvent): void;
    newMessage(e: NewMessageEvent): void;
    markRead(): void;
    forget(jobId: string): void;
    /** Dispatches a server event. Accepts the names `progress`, `done` and `message`, or infers from the shape. */
    dispatch(kind: string | undefined, raw: string): void;
}
export type EventSourceFactory = (url: string) => EventSourceLike;
/**
 * Wait before reopening a stream the server closed with a status other than 200 (the
 * browser does not retry that one). It is a courtesy to the server, not an operation deadline:
 * network drops are reconnected by the browser itself with Last-Event-ID.
 */
export declare const REOPEN_DELAYS_MS: number[];
export declare const EVENT_NAMES: readonly ["progress", "done", "message"];
/** Opens the stream and keeps it. Returns the function that closes it. */
export declare function connectEvents(store: EventsStore, url: string, factory?: EventSourceFactory, onReconnect?: () => void): () => void;
