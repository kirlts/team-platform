#!/usr/bin/env node
// Refuses a commit that still carries git conflict markers (<<<<<<<, =======, >>>>>>>).
// Reason: on 2026-10-21 a merge conflict in docs/MASTER-SPEC.md was committed and pushed
// with its markers inside (commit 74513ce) because the merge chain did not stop on the conflict.
// Usage: node scripts/check-conflict-markers.mjs --staged   (from .githooks/pre-commit)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const staged = process.argv.includes('--staged');
const files = execFileSync('git', ['-c', 'core.quotepath=false', ...(staged ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR'] : ['ls-files'])], { encoding: 'utf8' })
  .split('\n').filter(Boolean)
  .filter((f) => !f.endsWith('.png') && !f.endsWith('.jpg') && !f.endsWith('.lock'));

const marker = /^(<{7}|={7}|>{7})( |$)/m;
const offenders = [];
for (const file of files) {
  let text;
  try { text = staged ? execFileSync('git', ['show', `:${file}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }) : readFileSync(file, 'utf8'); } catch { continue; }
  if (marker.test(text)) offenders.push(file);
}
if (offenders.length) {
  console.error(`Conflict markers found in: ${offenders.join(', ')}`);
  process.exit(1);
}
