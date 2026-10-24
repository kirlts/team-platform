// Process-wide wake-up of the queues and the defaults a job inserted outside a queue needs. Code that inserts a job row
// inside a domain transaction without a queue at hand (the `execute` job enqueued when a message is assigned to an agent,
// src/execute/enqueue.js) emits 'enqueued' here and every queue of the process passes it on to its worker. A worker in
// another process learns of the row by `PRAGMA data_version`.

import { EventEmitter } from 'node:events'

export const queueWake = new EventEmitter()
queueWake.setMaxListeners(0) // one listener per queue of the process; the tests build many

/** Set by `createQueue` from the configuration: attempts of an `execute` job (EXECUTE_MAX_ATTEMPTS) and of a `deliver` job (EXECUTE_DELIVER_MAX_ATTEMPTS), and of an `extract` job enqueued by a reply (the worker's QUEUE_MAX_ATTEMPTS). */
export const jobDefaults = { executeMaxAttempts: 1, deliverMaxAttempts: 2, extractMaxAttempts: 3 } // UD-255: one attempt, a retry would spend the budget again; UD-263: two for `deliver`, which is idempotent
