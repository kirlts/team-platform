#!/usr/bin/env node
// Asks for a provider key without echoing it, tests it against the provider and stores it
// outside the repository, in ~/.config/team-platform/env (mode 600).
//
//   node scripts/llave.mjs                 → ANTHROPIC_API_KEY
//   node scripts/llave.mjs GROQ_API_KEY
//
// No key goes through an argument or through a file in the repository (MASTER-SPEC §4.6).

import { createInterface } from 'node:readline';
import { mkdirSync, readFileSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const PROBES = {
  // A cheap read that requires the key and spends no tokens.
  ANTHROPIC_API_KEY: (key) => fetch('https://api.anthropic.com/v1/models?limit=1', {
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
  }),
  GROQ_API_KEY: (key) => fetch('https://api.groq.com/openai/v1/models', {
    headers: { authorization: `Bearer ${key}` },
  }),
  DEEPSEEK_API_KEY: (key) => fetch('https://api.deepseek.com/models', {
    headers: { authorization: `Bearer ${key}` },
  }),
  OPENROUTER_API_KEY: (key) => fetch('https://openrouter.ai/api/v1/models', {
    headers: { authorization: `Bearer ${key}` },
  }),
};

// Where each key is created, for whoever installs for the first time.
const GUIDES = {
  ANTHROPIC_API_KEY: 'https://platform.claude.com → API keys → Create key. Billed by usage; the account needs credit loaded.',
  GROQ_API_KEY: 'https://console.groq.com/keys → Create API Key. The free plan is enough to transcribe (whisper-large-v3-turbo); the hourly audio cap is in docs/MASTER-SPEC.md §7.4.',
  DEEPSEEK_API_KEY: 'https://platform.deepseek.com/api_keys → Create new API key. Billed by usage.',
  OPENROUTER_API_KEY: 'https://openrouter.ai/keys → Create key. A single key for several providers, with a fee.',
};

const name = process.argv[2] ?? 'ANTHROPIC_API_KEY';
if (!PROBES[name]) {
  console.error(`Cannot test ${name}. Known keys: ${Object.keys(PROBES).join(', ')}`);
  process.exit(2);
}
console.log(`${name}: ${GUIDES[name]}`);
console.log('Paste the key and press Enter (it is not echoed while you type).');

const key = await askHidden(`${name}: `);
if (!key) {
  console.error('Empty. Nothing saved.');
  process.exit(2);
}

const response = await PROBES[name](key);
if (!response.ok) {
  console.error(`The provider answered ${response.status}. Nothing saved.`);
  process.exit(1);
}

const dir = join(homedir(), '.config', 'team-platform');
const file = join(dir, 'env');
mkdirSync(dir, { recursive: true, mode: 0o700 });
const lines = existsSync(file)
  ? readFileSync(file, 'utf8').split('\n').filter((l) => l && !l.startsWith(`${name}=`))
  : [];
lines.push(`${name}=${key}`);
writeFileSync(file, lines.join('\n') + '\n', { mode: 0o600 });
chmodSync(file, 0o600);
console.log(`${name} tested (${response.status}) and saved in ${file}`);
console.log(`To use it: set -a; . ${file}; set +a`);

function askHidden(prompt) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const write = rl._writeToOutput;
    process.stdout.write(prompt);
    rl._writeToOutput = () => {};
    let answered = false;
    rl.question('', (answer) => {
      answered = true;
      rl._writeToOutput = write;
      process.stdout.write('\n');
      rl.close();
      resolve(answer.trim());
    });
    // Input closed without an answer (no terminal): treated as empty.
    rl.on('close', () => { if (!answered) resolve(''); });
  });
}
