import type { TeamClient } from './client.js'
import type { EventsStore } from './events.js'
import { invalidate, invalidateRoots, type QueryClientLike } from './invalidations.js'
import type { QueryRoot } from './keys.js'

const KNOWN_ROOTS: ReadonlySet<string> = new Set<QueryRoot>(['me', 'members', 'areas', 'templates', 'messages', 'inputs', 'providers', 'connections', 'project', 'analysis-settings', 'publication', 'jobs'])

/**
 * Opens the session's single event stream and ties it to the cache: a message of somebody else makes the lists stale, and so
 * does the stream coming back after a drop when the server's replay did not cover what was missed (then only what is on
 * screen is read again). Returns the function that stops both. The progress of jobs is not in the cache: it lives in `store`.
 */
export function watchEvents(o: { client: TeamClient; store: EventsStore; queryClient: QueryClientLike }): () => void {
  const offMessage = o.store.onNewMessage(() => {
    void invalidate(o.queryClient, 'newMessage')
  })
  // A job of a message that ends (an agent's work, the reading of a reply's audio) leaves its thread stale (UD-279).
  const offDone = o.store.onDone((e) => {
    if (e.message_id) void invalidate(o.queryClient, 'reply')
  })
  // A write by somebody else (a reply, an edit, a state, a review, an assignee…): only what a mounted screen shows is read again.
  const offChanged = o.store.onChanged((e) => {
    const roots = e.roots.filter((r): r is QueryRoot => KNOWN_ROOTS.has(r))
    void invalidateRoots(o.queryClient, roots, { refetchType: 'active' })
    // The open message is read again by its id; a change without one (an area, a member, a bulk write) reads whichever is open.
    void o.queryClient.invalidateQueries({ queryKey: e.message_id ? ['message', e.message_id] : ['message'], refetchType: 'active' })
  })
  const close = o.client.events.connect(o.store, {
    onReconnect: () => {
      void invalidate(o.queryClient, 'reconnect', { refetchType: 'active' })
    },
  })
  return () => {
    offMessage()
    offDone()
    offChanged()
    close()
  }
}
