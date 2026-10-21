// Proveedor de transcripción local para el banco (forma de MASTER-SPEC §7.6, providers.speech).
// Sólo se usa cuando no hay GROQ_API_KEY: lanza bench/local-whisper.py con el Python indicado en
// LOCAL_WHISPER_PYTHON (un entorno con faster-whisper instalado). No es un proveedor de producción;
// sus tiempos no representan a Groq y el banco lo declara en el resultado.
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), 'local-whisper.py');

export function createLocalSpeech({ python = process.env.LOCAL_WHISPER_PYTHON ?? 'python3', model = process.env.LOCAL_WHISPER_MODEL ?? 'medium' } = {}) {
  return {
    name: 'local-faster-whisper',
    model,
    transcribe({ audioPath }) {
      return new Promise((resolve, reject) => {
        const child = spawn(python, [script, audioPath, model], { stdio: ['ignore', 'pipe', 'pipe'] });
        const out = [];
        const err = [];
        child.stdout.on('data', (d) => out.push(d));
        child.stderr.on('data', (d) => err.push(d));
        child.on('error', reject);
        child.on('close', (code) => {
          if (code !== 0) return reject(new Error(`local-whisper salió con ${code}: ${Buffer.concat(err).toString().slice(-500)}`));
          try {
            resolve(JSON.parse(Buffer.concat(out).toString()));
          } catch (e) {
            reject(e);
          }
        });
      });
    },
  };
}
