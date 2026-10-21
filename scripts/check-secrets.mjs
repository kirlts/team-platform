#!/usr/bin/env node
// Looks for credentials in the files of the repository (MASTER-SPEC section 4.6). With --staged it reads the staged
// version of the files of the commit being made (what .githooks/pre-commit runs); without it, every tracked file.
// Exit 1 and the findings on stderr when something looks like a credential.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { findSecrets } from '../src/testing/secrets.js'

const staged = process.argv.includes('--staged')
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
const files = (staged ? git('diff', '--cached', '--name-only', '--diff-filter=ACMR') : git('ls-files')).split('\n').filter(Boolean)
const BINARY = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|pdf|docx|mp3|mp4|m4a|wasm)$/i

const findings = []
for (const file of files) {
  if (BINARY.test(file) || file === 'package-lock.json') continue
  let text
  try { text = staged ? git('show', `:${file}`) : readFileSync(file, 'utf8') } catch { continue }
  if (text.includes('\0')) continue
  for (const hit of findSecrets(text, { isTest: /\.test\.m?js$/.test(file) })) findings.push(`${file}:${hit.line}: ${hit.name}`)
}
if (findings.length > 0) {
  console.error(`Possible credentials (MASTER-SPEC section 4.6):\n${findings.map((f) => `  ${f}`).join('\n')}`)
  process.exit(1)
}
