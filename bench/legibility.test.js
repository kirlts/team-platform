// Legibility of frame text: the scoring with a fake model, the frames at three widths with the real ffmpeg, and the dry run of the script.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { buildFrames, LINES, measure, normalize, recall, tokensOf } from './legibility.js';

const fontFile = execFileSync('fc-match', ['-f', '%{file}', 'sans'], { encoding: 'utf8' }).trim();
const tmp = () => mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'legibility-test-'));

describe('scoring', () => {
  it('compares without accents, case or the thousands separator, and counts whole words', () => {
    assert.equal(normalize('Total: 19.990 Pesos, Ñandú'), 'total: 19990 pesos nandu');
    assert.deepEqual(tokensOf('Pedido 48213 de pago el 14/03'), ['pedido', '48213', 'pago', '14/03']);
    assert.equal(recall('Pedido 48213 pendiente', 'PEDIDO 48213 pendiente'), 1);
    assert.equal(recall('Pedido 48213 pendiente', 'pedido 48218'), 1 / 3);
    assert.equal(recall('Error 504', 'error 5045'), 0.5, 'a number that only starts like the right one is not read');
  });
});

describe('frames', () => {
  it('are built at each width with the scale filter of the video extractor, and a width over the still is not enlarged', async () => {
    const frames = await buildFrames({ dir: tmp(), widths: [540, 720, 1080, 2000], quality: 4, fontFile });
    const sizes = frames.map((f) => execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width', '-of', 'csv=p=0', f.path], { encoding: 'utf8' }).trim());
    assert.deepEqual(sizes, ['540', '720', '1080', '1080']);
  });
});

describe('measure', () => {
  it('scores each line of each width from what the model answered and carries the usage', async () => {
    // A model that reads a line only if the frame is wide enough for its size.
    const vision = {
      describe: async ({ images }) => {
        const width = Number(/\[(\d+) px\]/.exec(images[0].label)[1]);
        const read = LINES.filter((l) => l.size * (width / 1080) >= 20).map((l) => l.text).join('. ');
        return { json: { frames: [{ index: 1, description: read }] }, usage: { input_tokens: 1500, output_tokens: 80 } };
      },
    };
    const frames = (await buildFrames({ dir: tmp(), widths: [540, 1080], quality: 4, fontFile })).map((f) => ({ ...f, data: readFileSync(f.path) }));
    const rows = await measure({ frames, vision, prompt: 'p', schema: {} });
    assert.deepEqual(rows.map((r) => r.width), [540, 1080]);
    assert.deepEqual(rows[0].lines.map((l) => l.recall), [0, 0, 0, 1]);
    assert.deepEqual(rows[1].lines.map((l) => l.recall), [1, 1, 1, 1]);
    assert.equal(rows[1].mean, 1);
    assert.deepEqual(rows[0].usage, { input_tokens: 1500, output_tokens: 80 });
  });
});

describe('script', () => {
  it('--plan builds the frames, calls no provider and needs no key', () => {
    const run = spawnSync('node', ['bench/legibility.mjs', '--plan'], { encoding: 'utf8', env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR ?? tmpdir() } });
    assert.equal(run.status, 0, run.stderr + run.stdout);
    assert.match(run.stdout, /540 px, \d+ bytes; 720 px, \d+ bytes; 1080 px, \d+ bytes/);
    assert.match(run.stdout, /Plan: ejecutable/);
  });
});
