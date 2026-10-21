// Local speech-to-text provider for the benchmark (shape of MASTER-SPEC §7.6, providers.speech).
// Only used when there is no GROQ_API_KEY: it spawns bench/local-whisper.py with the Python set in
// LOCAL_WHISPER_PYTHON (an environment with faster-whisper installed). It is not a production
// provider; its timings do not represent Groq and the benchmark states it in the result.
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
