#!/usr/bin/env node
// Writes `jobs.jsonl` for `scripts/light-limits.mjs` from the database of an installation: one line per attempt of the light model that was judged and whose message has estimates,
// `{ job, closed, understand_vs_create, irreversibility, certainty }`. `closed` is the stored fact `execute_judgments.closed` (handler.js; a delivery whose checks stayed red sets it to 0);
// attempts judged before it existed (NULL) are left out, because nothing says how they ended.
//
//   node scripts/light-jobs.mjs --db /data/team.db --light claude-haiku-5-5 > jobs.jsonl
import { all, openDatabase } from '../src/db/index.js'
import { pathToFileURL } from 'node:url'

/** The lines of the file, from an open database. `light` is the id of the light model (`EXECUTE_LIGHT_MODEL`). */
export function lightJobs (db, light) {
  return all(db, `SELECT j.job_id, j.closed, m.estimates_json FROM execute_judgments j JOIN messages m ON m.id = j.message_id
                  WHERE j.worked_with = ? AND j.closed IS NOT NULL AND m.estimates_json IS NOT NULL ORDER BY j.id`, light).flatMap((row) => {
    let e = null
    try { e = JSON.parse(row.estimates_json) } catch { /* a damaged cell has no estimates */ }
    if (![e?.understand_vs_create, e?.irreversibility, e?.certainty].every((n) => typeof n === 'number')) return []
    return [{ job: String(row.job_id), closed: row.closed === 1, understand_vs_create: e.understand_vs_create, irreversibility: e.irreversibility, certainty: e.certainty }]
  })
}

function main (argv) {
  const flag = (name) => { const i = argv.indexOf(name); return i === -1 ? undefined : argv[i + 1] }
  const db = openDatabase(flag('--db') ?? process.env.DB_PATH ?? '/data/team.db')
  const light = flag('--light') ?? process.env.EXECUTE_LIGHT_MODEL ?? 'claude-haiku-5-5'
  for (const line of lightJobs(db, light)) process.stdout.write(`${JSON.stringify(line)}\n`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2))
