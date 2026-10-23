// Optimistic concurrency (UD-071, UD-253): an edit carries the `version` that was read; if another edit got in first the server
// answers 409 `edit_conflict`, the thing is read again and the same change goes once more, so the person never sees a conflict
// for a change in a different field.
import { isEditConflict } from './errors.js'

/**
 * Where an interface keeps what it read, so the next edit uses the version the previous one left. Both are optional: without
 * them every edit reads the current version first (one more request, same result).
 */
export interface Versioning<D> {
  /** What the cache holds now for this thing, if anything. */
  cached?: () => D | undefined
  /** Called with the fresh copy read after a conflict, to put it in the cache. */
  remember?: (fresh: D) => void
}

export interface VersionedSend<D, R> extends Versioning<D> {
  fetchCurrent: () => Promise<D>
  /** The version inside a copy of the thing: a message's own, or the one of a reply in its thread. */
  versionOf: (detail: D | undefined) => number | undefined
  send: (version: number | undefined) => Promise<R>
}

/**
 * Sends an edit with the version in the cache (or, without one, the current one) and, on `edit_conflict`, reads again,
 * remembers what it read and sends once more with that version. Any other error, and a second conflict, go up.
 */
export async function sendVersioned<D, R>(o: VersionedSend<D, R>): Promise<R> {
  try {
    return await o.send(o.versionOf(o.cached?.()) ?? o.versionOf(await o.fetchCurrent()))
  } catch (err) {
    if (!isEditConflict(err)) throw err
    const fresh = await o.fetchCurrent()
    o.remember?.(fresh)
    return o.send(o.versionOf(fresh))
  }
}
