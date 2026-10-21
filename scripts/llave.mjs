#!/usr/bin/env node
// Pide una llave de proveedor sin mostrarla, la prueba contra el proveedor y la guarda
// fuera del repositorio, en ~/.config/team-platform/env (modo 600).
//
//   node scripts/llave.mjs                 → ANTHROPIC_API_KEY
//   node scripts/llave.mjs GROQ_API_KEY
//
// Ninguna llave pasa por un argumento ni por un archivo del repositorio (MASTER-SPEC §4.6).

import { createInterface } from 'node:readline';
import { mkdirSync, readFileSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const PROBES = {
  // Una lectura barata que exige la llave y no gasta tokens.
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

const name = process.argv[2] ?? 'ANTHROPIC_API_KEY';
if (!PROBES[name]) {
  console.error(`No sé probar ${name}. Conozco: ${Object.keys(PROBES).join(', ')}`);
  process.exit(2);
}

const key = await askHidden(`${name}: `);
if (!key) {
  console.error('Vacía. Nada guardado.');
  process.exit(2);
}

const response = await PROBES[name](key);
if (!response.ok) {
  console.error(`El proveedor contestó ${response.status}. Nada guardado.`);
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
console.log(`${name} probada (${response.status}) y guardada en ${file}`);
console.log(`Para usarla: set -a; . ${file}; set +a`);

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
    // Entrada cerrada sin respuesta (sin terminal): se trata como vacía.
    rl.on('close', () => { if (!answered) resolve(''); });
  });
}
