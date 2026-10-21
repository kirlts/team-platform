#!/usr/bin/env node
// Refreshes the machine-derivable block of TRABAJO-EN-CURSO.md (between the "vivo" markers):
// main head, branches ahead of main with their commit counts and last activity, worktrees,
// and the last commits. The narrative of the handoff is edited by hand at each state change.
// Commits and pushes only when the derived content changed (the timestamp does not count).
//   node scripts/traspaso-vivo.mjs            # refresh, commit and push if changed
//   node scripts/traspaso-vivo.mjs --dry      # print the block, write nothing
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const DOC = 'TRABAJO-EN-CURSO.md';
const START = '<!-- vivo:inicio -->';
const END = '<!-- vivo:fin -->';
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();

// Never commit while a merge or another staged change is in progress: the commit would take it along.
const gitDir = git('rev-parse', '--git-dir');
const busy = existsSync(`${gitDir}/MERGE_HEAD`) || git('diff', '--cached', '--name-only') !== '' || git('branch', '--show-current') !== 'main';
if (busy && !process.argv.includes('--dry')) { console.log('omitido: hay una fusión o cambios en preparación, o no está en main'); process.exit(0); }

const own = ['--invert-grep', '--grep=^Traspaso: estado vivo$'];
const head = git('log', '-1', '--format=%h %s', ...own, 'main');
const pushed = git('log', '-1', '--format=%h', ...own, 'origin/main');
const branches = git('branch', '--list', 'wt-*', '--format=%(refname:short)').split('\n').filter(Boolean)
  .map((b) => ({ b, ahead: Number(git('rev-list', '--count', `main..${b}`)), last: git('log', '-1', '--format=%cr', b) }))
  .filter((x) => x.ahead > 0)
  .sort((a, b) => b.ahead - a.ahead);
const worktrees = git('worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice(9).split('/').pop());
const recent = git('log', '-8', '--format=- `%h` %s (%cr)', ...own, 'main');

const block = [
  START,
  '### Estado vivo (generado con `node scripts/traspaso-vivo.mjs`)',
  '',
  `- \`main\`: ${head}. Empujado a origin: \`${pushed}\`.`,
  branches.length
    ? `- Ramas con commits sin fusionar: ${branches.map((x) => `\`${x.b}\` ${x.ahead} (${x.last})`).join(', ')}.`
    : '- Ramas con commits sin fusionar: ninguna.',
  `- Worktrees abiertos: ${worktrees.map((w) => `\`${w}\``).join(', ')}.`,
  '- Últimos commits en `main`:',
  recent,
  END,
].join('\n');

const stamp = () => `Actualizado ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC.`;
const doc = readFileSync(DOC, 'utf8');
const hasBlock = doc.includes(START);
const current = hasBlock ? doc.slice(doc.indexOf(START), doc.indexOf(END) + END.length) : '';
const strip = (t) => t.replace(/^Actualizado .*$/m, '').replace(/\s+/g, ' ').replace(/\((?:hace|en) [^)]*\)/g, '');
if (process.argv.includes('--dry')) { console.log(block); process.exit(0); }
if (hasBlock && strip(current).trim() === strip(block).trim()) { console.log('sin cambios'); process.exit(0); }
const withStamp = block.replace('### Estado vivo', `### Estado vivo`).replace(END, `${stamp()}\n${END}`);
const next = hasBlock
  ? doc.slice(0, doc.indexOf(START)) + withStamp + doc.slice(doc.indexOf(END) + END.length)
  : doc.replace(/(\n## Trabajo en vuelo)/, `\n${withStamp}\n$1`);
writeFileSync(DOC, next);
git('add', DOC);
git('commit', '-m', 'Traspaso: estado vivo', '-m', 'Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>');
try { git('push', '-q', 'origin', 'main'); console.log('actualizado y empujado'); } catch (e) { console.log('actualizado; el empuje falló: ' + String(e.message).split('\n')[0]); }
