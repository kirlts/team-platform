import type { TeamClient } from './client.js'
import type { EventsStore } from './events.js'
import { invalidate, type QueryClientLike } from './invalidations.js'

/**
 * Opens the session's single event stream and ties it to the cache: a message of somebody else makes the lists stale, and so
 * does the stream coming back after a drop when the server's replay did not cover what was missed (then only what is on
 * screen is read again). Returns the function that stops both. The progress of jobs is not in the cache: it lives in `store`.
 */
export function watchEvents(o: { client: TeamClient; store: EventsStore; queryClient: QueryClientLike }): () => void {
  const offMessage = o.store.onNewMessage(() => {
    void invalidate(o.queryClient, 'newMessage')
  })
  const close = o.client.events.connect(o.store, {
    onReconnect: () => {
      void invalidate(o.queryClient, 'reconnect', { refetchType: 'active' })
    },
  })
  return () => {
    offMessage()
    close()
  }
}
