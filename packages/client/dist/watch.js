import { invalidate } from './invalidations.js';
/**
 * Opens the session's single event stream and ties it to the cache: a message of somebody else makes the lists stale, and so
 * does the stream coming back after a drop. Returns the function that stops both. The progress of jobs is not in the cache:
 * it lives in `store`.
 */
export function watchEvents(o) {
    const offMessage = o.store.onNewMessage(() => {
        void invalidate(o.queryClient, 'newMessage');
    });
    const close = o.client.events.connect(o.store, {
        onReconnect: () => {
            void invalidate(o.queryClient, 'reconnect');
        },
    });
    return () => {
        offMessage();
        close();
    };
}
