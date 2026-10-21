// Size of the span of a vision call with 48 video frames (HALLAZGOS H-40). It is the measurement behind the default of
// TELEMETRY_QUEUE_MAX_BYTES (src/telemetry/config.js). Run on demand: `node src/telemetry/span-size.bench.mjs`
// (not a test; `npm test` does not take it).
//
// Frames: 720 px wide JPEG with `-q:v 4`, as src/extract/video.js asks ffmpeg for them (report 06 section 8: 60 KB each).
// The frames of this run come from ffmpeg `testsrc2` with temporal noise, which lands at 57.5 KB.
//
// Result (2026-10-20, Node 24.20): 48 frames of 57.5 KB = 2,734,898 B of JPEG; the span of the call weighs 3,653,672 B
// (3.48 MiB: 3,653,392 in `events_json`, base64 inflates by 4/3, plus 280 of attributes); the same call with
// TELEMETRY_INLINE_BLOBS=0 weighs 7,080 B. The estimator of the byte budget (budget.js `spanBytes`) agrees with the
// stored row within 1 % (budget.test.js). TELEMETRY_QUEUE_MAX_BYTES defaults to 4 MiB: one such span fits, two do not.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeProviders } from '../providers/fake.js';
import { initTelemetry } from './index.js';
import { makeDb } from './test/helpers.js';

const FRAMES = 48; // report 06 section 8, `maxFrames`
const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'span-size-'));
const frames = [];
for (let i = 0; i < FRAMES; i++) {
  const file = join(dir, `f${i}.jpg`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=1280x720:rate=1,noise=alls=20:allf=t:all_seed=${i + 1}`, '-frames:v', '1', '-vf', 'scale=720:-2', '-q:v', '4', file]);
  frames.push({ data: readFileSync(file), mime: 'image/jpeg', label: `Frame ${i + 1}` });
}
const jpegBytes = frames.reduce((sum, f) => sum + f.data.length, 0);

async function measure(env) {
  const store = makeDb();
  const telemetry = initTelemetry({ db: store.db, env });
  const providers = createFakeProviders({ vision: [{ json: { frames: [] }, usage: { input_tokens: 70_000, output_tokens: 100, cached_tokens: 0 } }] });
  await providers.vision.describe({ images: frames, prompt: 'describe' });
  await telemetry.flush();
  const row = store.db.prepare("SELECT length(attributes_json) AS attributes, length(events_json) AS events FROM spans WHERE name LIKE 'chat %'").get();
  await telemetry.shutdown();
  store.cleanup();
  return row;
}

const withBlobs = await measure({});
const withoutBlobs = await measure({ TELEMETRY_INLINE_BLOBS: '0' });
console.log(JSON.stringify({ frames: FRAMES, jpegBytes, withBlobs, withoutBlobs, spanBytes: withBlobs.attributes + withBlobs.events }, null, 2));
rmSync(dir, { recursive: true, force: true });
