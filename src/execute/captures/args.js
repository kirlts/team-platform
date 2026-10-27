// The arguments of `look`. Generic flags in English; the flags that belong to the host (`--clinic`, `--role`…) are the ones its adapter lists in `flags`.

export const USAGE = `look [place…] [--text] [--shot [path]] [--clip x,y,w,h] [--full] [--alt "phrase"] [--mask | --no-mask]
     [--phone | --desktop | --width N --height N] [--last-only] [--json] [host flags]

place    a route (/orders, ?tab=models) or a menu by its name (Orders, Settings > Team). Several places are looked at in one run.
         Without a place: /
--text   the text a person reads, instead of the tree of the page
--shot   screenshot to a path (inside $TEAM_CAPTURES_DIR when relative); without a path, in the output folder. Prints a line LOOK_CAPTURE {json}
--clip   screenshot of a rectangle; --full, of the whole page
--alt    the phrase that says what the image shows (default: title and first heading)
--mask   hides the data of people before the capture and declares masked; --no-mask shows the page as it is. Default: LOOK_MASK, else masked
         unless TEAM_CAPTURES_UNMASKED allows people on a capture
--phone  390x844; --desktop 1440x900; default 1280x720
--last-only  looks at every place but prints and captures only the last one
--json   prints the declarations of all captures as a JSON list at the end

Exit code: 0 looked at what was asked · 1 something else failed (the message says what) · 2 arguments · 3 the session ended and could not be redone
· 4 the time ran out (LOOK_TIMEOUT_S) · 5 could not sign in · 6 the browser does not start.`

export class UsageError extends Error {}

const MIN_SIDE = 200 // declared courtesy: a viewport smaller than this is a typing mistake, not a device

/** Whether the environment lets captures show people (the platform's own variable). */
export const unmaskedAllowed = (env) => ['allowed', '1'].includes(env.TEAM_CAPTURES_UNMASKED ?? '')

/** The default of masking: LOOK_MASK, else masked unless the platform lets captures show people. */
export function maskDefault (env) {
  if (env.LOOK_MASK === 'on' || env.LOOK_MASK === '1') return true
  if (env.LOOK_MASK === 'off' || env.LOOK_MASK === '0') return false
  return !unmaskedAllowed(env)
}

/** @returns {{ help: true } | { op: object }} Throws UsageError. */
export function parseArgs (argv, { hostFlags = [], env = process.env } = {}) {
  const op = { places: [], text: false, shot: null, clip: null, full: false, alt: null, mask: maskDefault(env), width: 1280, height: 720, lastOnly: false, json: false, host: {} }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => { if (i + 1 >= argv.length) throw new UsageError(`${a} needs a value`); return argv[++i] }
    if (a === '-h' || a === '--help') return { help: true }
    else if (a === '--text') op.text = true
    else if (a === '--shot') op.shot = (argv[i + 1] && !argv[i + 1].startsWith('-') && /\.(png|jpe?g)$/i.test(argv[i + 1])) ? argv[++i] : true
    else if (a === '--clip') {
      const parts = next().split(',').map(Number)
      if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) throw new UsageError('--clip asks for x,y,width,height')
      op.clip = parts
    } else if (a === '--full') op.full = true
    else if (a === '--alt') op.alt = next()
    else if (a === '--mask') op.mask = true
    else if (a === '--no-mask') op.mask = false
    else if (a === '--width') op.width = Number(next())
    else if (a === '--height') op.height = Number(next())
    else if (a === '--phone') { op.width = 390; op.height = 844 } // the size of a phone screen, the same the walkthrough records
    else if (a === '--desktop') { op.width = 1440; op.height = 900 }
    else if (a === '--last-only') op.lastOnly = true
    else if (a === '--json') op.json = true
    else if (a.startsWith('--') && hostFlags.includes(a.slice(2))) op.host[a.slice(2)] = next()
    else if (a.startsWith('--')) throw new UsageError(`unknown option: ${a}`)
    else op.places.push(a)
  }
  if (!(op.width >= MIN_SIDE && op.height >= MIN_SIDE)) throw new UsageError(`--width and --height ask for numbers of ${MIN_SIDE} or more`)
  if (op.clip && !op.shot) op.shot = true
  if (op.places.length === 0) op.places.push('/')
  return { op }
}
