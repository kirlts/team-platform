// The time a run is given. Every wait of the tool has an end (exit code 4 names the phase that ran out), and the end is not chosen: it comes from a
// measurement, with the margin that a loaded shared machine needs.
//
// Measured by the first host on 2026-10-23, against its own production: a whole run with one screen took 7.6 s, of which 2.9 s was signing in and
// starting the browser and 4.2 s the screen. The margin is five times what was measured, the air a loaded shared machine needs. The first host's screens
// are heavy; a host whose screens are slower raises the total with LOOK_TIMEOUT_S, and the message of the timeout says in which phase it ran out.
export const MEASURED_START_MS = 2900
export const MEASURED_SCREEN_MS = 4200
export const MARGIN = 5

/** Milliseconds for a run of `screens` places. `LOOK_TIMEOUT_S` (seconds, greater than zero) replaces the computation. Returns null when the variable is not a valid number. */
export function runTimeoutMs (screens, env = process.env) {
  if (env.LOOK_TIMEOUT_S !== undefined && env.LOOK_TIMEOUT_S !== '') {
    const ms = Number(env.LOOK_TIMEOUT_S) * 1000
    return ms > 0 ? ms : null
  }
  return MARGIN * (MEASURED_START_MS + MEASURED_SCREEN_MS * screens)
}

/** The estimate a person can use to weigh the cost of what the tool printed: 4 characters per token for text, and width × height / 750 for an image (the formula of Anthropic's vision documentation). */
export const textTokens = (characters) => Math.round(characters / 4)
export const imageTokens = (width, height) => Math.round((width * height) / 750)
