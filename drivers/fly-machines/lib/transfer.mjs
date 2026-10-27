// Moving files between the worker and a machine through exec, the only channel the Machines API offers (limits measured 2026-10-27, see lib/fly.mjs):
// a request carries at most about 16 KiB and its `stdin` is not delivered, so data goes up as base64 arguments in chunks; an answer carries at most 10 MiB, so data
// comes down in slices of base64 text. Both directions are checked with the size and the sha256 of the base64 text.
import { spawn } from 'node:child_process'
import { DOWNLOAD_SLICE_BYTES, DriverError, UPLOAD_CHUNK_CHARS, execOk, sha256 } from './fly.mjs'

/** tar of a directory as a Buffer (`tar czf - -C dir .`). */
export function tarDirectory (dir) {
  return new Promise((resolve, reject) => {
    const child = spawn('tar', ['czf', '-', '-C', dir, '.'], { stdio: ['ignore', 'pipe', 'inherit'] })
    const parts = []
    child.stdout.on('data', (c) => parts.push(c))
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve(Buffer.concat(parts)) : reject(new DriverError(`tar of ${dir} ended with ${code}`))))
  })
}

/** Unpacks a tar.gz Buffer into a directory. */
export function untar (buffer, dir) {
  return new Promise((resolve, reject) => {
    const child = spawn('tar', ['xzf', '-', '-C', dir], { stdio: ['pipe', 'inherit', 'inherit'] })
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve() : reject(new DriverError(`tar extraction into ${dir} ended with ${code}`))))
    child.stdin.on('error', () => {})
    child.stdin.end(buffer)
  })
}

async function inParallel (items, limit, fn) {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) { const i = next++; if (i >= items.length) return; await fn(items[i], i) }
  })
  await Promise.all(workers)
}

/** Writes `buffer` to `remote` in the machine. The directory of `remote` must be creatable by root. */
export async function upload (s, machineId, buffer, remote) {
  const text = buffer.toString('base64')
  const chunks = []
  for (let at = 0; at < text.length; at += UPLOAD_CHUNK_CHARS) chunks.push(text.slice(at, at + UPLOAD_CHUNK_CHARS))
  if (chunks.length === 0) chunks.push('')
  const parts = `${remote}.parts`
  await execOk(s, machineId, ['bash', '-c', 'set -e; rm -rf "$1"; mkdir -p "$1"', '_', parts])
  await inParallel(chunks, s.uploadParallel, (chunk, i) => execOk(s, machineId, ['bash', '-c', 'printf %s "$3" > "$1/$2"', '_', parts, String(i).padStart(8, '0'), chunk]))
  await execOk(s, machineId, ['bash', '-c', 'set -e; cat "$1"/* | base64 -d > "$2"; rm -rf "$1"', '_', parts, remote])
  const check = await execOk(s, machineId, ['bash', '-c', 'base64 -w0 "$1" | sha256sum | cut -d" " -f1', '_', remote])
  if (check.stdout.trim() !== sha256(text)) throw new DriverError(`${remote} did not arrive intact (the sha256 differs)`)
}

/** Brings out what `pack.sh <kind> ...` prepared. Resolves the decoded Buffer, or null when the machine had nothing. */
export async function download (s, machineId, packArgs) {
  const packed = await execOk(s, machineId, ['bash', '/tp/agent/pack.sh', ...packArgs], { timeoutS: 120 })
  const line = packed.stdout.trim().split('\n').at(-1)
  if (line === '-') return null
  const [bytesText, sum] = line.split(' ')
  const bytes = Number(bytesText)
  if (!Number.isInteger(bytes) || !/^[0-9a-f]{64}$/.test(sum ?? '')) throw new DriverError(`pack.sh ${packArgs[0]} printed «${line}»`)
  let text = ''
  for (let at = 0; at < bytes; at += DOWNLOAD_SLICE_BYTES) {
    const slice = await execOk(s, machineId, ['bash', '-c', 'tail -c +"$(($1 + 1))" "/tp/dl/$2.b64" | head -c "$3"', '_', String(at), packArgs[0], String(Math.min(DOWNLOAD_SLICE_BYTES, bytes - at))], { timeoutS: 120 })
    text += slice.stdout
  }
  if (text.length !== bytes || sha256(text) !== sum) throw new DriverError(`${packArgs[0]} did not arrive intact (${text.length} of ${bytes} bytes)`)
  return Buffer.from(text, 'base64')
}

