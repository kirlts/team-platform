// Runs inside the machine, started by run.mjs through exec. Waits until the session has new output or has ended and prints it:
//
//   node poll.mjs <stdout offset> <stderr offset> <wait seconds> <max bytes>
//
// The Machines API cannot stream an exec answer: it returns when the command ends. So every call is a long poll whose end is an event of the machine (the
// session wrote to /tp/out or /tp/err, or /tp/exit appeared), found with fs.watch, never a timer; the only timer is the bound of the call (<wait seconds>),
// which the driver sets under the cut of the API.
//
// stdout of this command is the new part of the session's stdout, stderr of this command the new part of its stderr; only whole lines are printed (a cut inside
// a character would corrupt the JSON the API carries), except at the end of the session, when the rest goes too.
// Exit code: 0 there may be more (output was printed, or the wait ran out); 100 the session ended and everything was printed.
import { closeSync, existsSync, fstatSync, openSync, readSync, statSync, watch, writeSync } from 'node:fs'

const DIR = '/tp'
const [outOffset, errOffset, waitSeconds, maxBytes] = process.argv.slice(2).map(Number)
const SOURCES = [{ file: `${DIR}/out`, fd: 1, offset: outOffset }, { file: `${DIR}/err`, fd: 2, offset: errOffset }]

/** The next part of a file: whole lines up to maxBytes (a line longer than that is read whole), or all the rest when the session ended. */
function next (source, ended) {
  if (!existsSync(source.file)) return null
  const fd = openSync(source.file, 'r')
  try {
    const size = fstatSync(fd).size
    const available = size - source.offset
    if (available <= 0) return null
    let want = Math.min(available, maxBytes)
    for (;;) {
      const buffer = Buffer.alloc(want)
      readSync(fd, buffer, 0, want, source.offset)
      const cut = buffer.lastIndexOf(10) + 1
      if (cut > 0) return buffer.subarray(0, cut)
      if (want === available) return ended ? buffer : null
      want = Math.min(available, want * 2)
    }
  } finally { closeSync(fd) }
}

function finish (code) {
  clearTimeout(timer)
  watcher.close()
  process.exit(code)
}

function check (timedOut = false) {
  const ended = existsSync(`${DIR}/exit`)
  let printed = false
  let drained = true
  for (const source of SOURCES) {
    const chunk = next(source, ended)
    if (chunk) {
      for (let at = 0; at < chunk.length;) at += writeSync(source.fd, chunk, at)
      source.offset += chunk.length
      printed = true
    }
    // «Everything printed» only when the file holds nothing after the offset (for the session that ended).
    if (existsSync(source.file) && statSync(source.file).size > source.offset) drained = false
  }
  if (ended && drained) finish(100)
  if (printed || timedOut) finish(0)
}

const watcher = watch(DIR, () => check())
const timer = setTimeout(() => check(true), waitSeconds * 1000)
check()
