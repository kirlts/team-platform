// Optimistic concurrency (UD-071, UD-253): an edit carries the `version` that was read; if another edit got in first the server
// answers 409 `edit_conflict`, the thing is read again and the same change goes once more, so the person never sees a conflict
// for a change in a different field.
import { isEditConflict } from './errors.js';
/**
 * Sends an edit with the version in the cache (or, without one, the current one) and, on `edit_conflict`, reads again,
 * remembers what it read and sends once more with that version. Any other error, and a second conflict, go up.
 */
export async function sendVersioned(o) {
    try {
        return await o.send(o.versionOf(o.cached?.()) ?? o.versionOf(await o.fetchCurrent()));
    }
    catch (err) {
        if (!isEditConflict(err))
            throw err;
        const fresh = await o.fetchCurrent();
        o.remember?.(fresh);
        return o.send(o.versionOf(fresh));
    }
}
