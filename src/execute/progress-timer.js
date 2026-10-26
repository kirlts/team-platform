// The clock of the progress notices (UD-293). One per `execute` session, started when the session starts and stopped when it ends; it belongs to the job,
// never to a cron: a worker that restarts and attaches to the session (9c7aeb3) runs the handler again and the handler starts its own, which keeps counting
// from the start the earlier attempt recorded. The facts come from what the stream of the session already reported (src/execute/stream.js).

import { get } from '../db/index.js'
import { addProgressNote, sessionStartOf } from '../domain/progress-notes.js'

/**
 * Starts the clock. `intervalMin` 0 starts nothing. `unitMs` is how long a minute is (the handler passes 60 000; a test passes a few milliseconds).
 * `reader` is the stream reader of the session: its `state()` has the turns, the tools, the last step and the commits. Returns `{ stop }`.
 */
export function startProgressNotices ({ db, events, now: handlerNow = Date.now, clock = null, logger = null, jobId, messageId, authorId, language, intervalMin, unitMs, reader }) {
  if (!(intervalMin > 0)) return { stop () {} }
  // `clock` ({ now, setTimeout, clearTimeout }) is the injected time of a test: it moves only when the test moves it, so the interval is exact under any load.
  const now = clock?.now ?? handlerNow
  const setTimer = clock?.setTimeout ?? setTimeout
  const clearTimer = clock?.clearTimeout ?? clearTimeout
  const startedAt = sessionStartOf(db, jobId) ?? now()
  let stopped = false
  let timer = null

  const tick = () => {
    if (stopped) return
    try {
      // A message that was closed or deleted while Claude works has nobody waiting for a notice.
      const message = get(db, 'SELECT status FROM messages WHERE id = ? AND deleted_at IS NULL', messageId)
      if (message && message.status !== 'closed') {
        const st = reader.state()
        const data = {
          minutes: Math.max(1, Math.round((now() - startedAt) / unitMs)),
          turns: st.turns,
          tools: st.tools,
          phrase: st.phrase ?? null,
          pushed: st.pushed ?? null,
          last_commit: st.lastCommit ?? null
        }
        addProgressNote({ db, events, now }, { messageId, jobId, authorId, data, language, sessionStartedAt: startedAt })
      }
    } catch (error) {
      // A notice is a courtesy: a busy database or a purged message never fails the session.
      logger?.warn({ err: error }, 'could not post a progress notice')
    }
    schedule()
  }
  const schedule = () => {
    if (stopped) return
    timer = setTimer(tick, intervalMin * unitMs)
    timer.unref?.()
  }
  schedule()
  return { stop () { stopped = true; clearTimer(timer) } }
}
