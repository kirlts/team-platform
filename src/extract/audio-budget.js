// Hourly audio budget (MASTER-SPEC §7.4, report 06 §3.2): Groq allows 7,200 s of
// audio per hour and the team shares that figure. The queue calls `check` before claiming a
// job that transcribes, and calls `record` when it claims it.

import { DEFAULTS } from './config.js';

/**
 * @param {{secondsPerHour?:number, windowMs?:number}} [options]
 * @returns {{check(seconds:number, at?:number):{allowed:boolean, waitMs:number, reason?:string}, record(seconds:number, at?:number):void, used(at?:number):number}}
 */
export function createAudioBudget({
  secondsPerHour = DEFAULTS.audio.budgetSecondsPerHour,
  windowMs = DEFAULTS.audio.budgetWindowMs,
} = {}) {
  /** @type {{at:number, seconds:number}[]} */
  let events = [];

  const prune = (at) => {
    events = events.filter((e) => e.at > at - windowMs);
  };

  return {
    used(at = Date.now()) {
      prune(at);
      return events.reduce((s, e) => s + e.seconds, 0);
    },

    /** Does `seconds` fit now? If not, how many milliseconds to wait for the window to free up room. */
    check(seconds, at = Date.now()) {
      if (seconds > secondsPerHour) {
        return { allowed: false, waitMs: Number.POSITIVE_INFINITY, reason: 'exceeds_budget' };
      }
      prune(at);
      let used = events.reduce((s, e) => s + e.seconds, 0);
      if (used + seconds <= secondsPerHour) return { allowed: true, waitMs: 0 };
      for (const e of events) {
        used -= e.seconds;
        if (used + seconds <= secondsPerHour) {
          return { allowed: false, waitMs: e.at + windowMs - at, reason: 'window_full' };
        }
      }
      return { allowed: false, waitMs: windowMs, reason: 'window_full' };
    },

    record(seconds, at = Date.now()) {
      events.push({ at, seconds });
    },
  };
}
