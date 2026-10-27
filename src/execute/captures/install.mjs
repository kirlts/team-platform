#!/usr/bin/env node
// Puts the capture tool where a session finds it: `<bin>/captures/` (the sources of this folder, with no tests or fixtures) and `<bin>/look`, a shim that
// runs `captures/look.mjs`. The worker does it for every `execute` job (`bin/` of the job directory, next to `team`). A host command that runs outside a
// job (the one that takes the «after» of a delivery) does it with the same code:
//
//   node <app>/src/execute/captures/install.mjs <bin-dir>
import { cp, mkdir, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const FOLDER = fileURLToPath(new URL('./', import.meta.url))
// nice: a work machine may be shared by several sessions; a capture should not slow the others.
export const LOOK_SHIM = '#!/bin/sh\nif command -v nice >/dev/null 2>&1; then exec nice -n 10 node "$(dirname "$0")/captures/look.mjs" "$@"; fi\nexec node "$(dirname "$0")/captures/look.mjs" "$@"\n'

/** Copies the tool into `<bin>/captures` and writes `<bin>/look`. Only the sources go, never the tests next to them or their fixtures (`testing/`). */
export async function installLook (bin) {
  await mkdir(bin, { recursive: true })
  await cp(FOLDER, join(bin, 'captures'), { recursive: true, filter: (source) => !/\.test\.m?js$|^testing(\/|$)/.test(relative(FOLDER, source)) })
  await writeFile(join(bin, 'look'), LOOK_SHIM, { mode: 0o755 })
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const bin = process.argv[2]
  if (!bin) { console.error('usage: node install.mjs <bin-dir>'); process.exit(2) }
  await installLook(bin)
}
