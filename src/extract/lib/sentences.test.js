import { test } from 'node:test';
import assert from 'node:assert/strict';
import { endsSentence, joinSegments } from './sentences.js';

const seg = (start, end, text, chunk = 0) => ({ start, end, text, chunk });
const PAUSE = 0.5;

test('short fragments without final punctuation join into one line that keeps the first start', () => {
  const out = joinSegments([seg(0, 1.5, 'pues'), seg(1.5, 3, 'cachai que'), seg(3, 5, 'dos cositas,')], PAUSE);
  assert.deepEqual(out, [{ start: 0, end: 5, text: 'pues cachai que dos cositas,', chunk: 0 }]);
});

test('a segment that ends in sentence punctuation closes the unit', () => {
  const out = joinSegments(
    [seg(0, 2, 'el menú no abre'), seg(2, 4, 'en Safari.'), seg(4, 5, 'Eso.'), seg(5, 7, 'y la otra'), seg(7, 9, 'sí funciona')],
    PAUSE,
  );
  assert.deepEqual(out.map((s) => [s.start, s.text]), [[0, 'el menú no abre en Safari.'], [4, 'Eso.'], [5, 'y la otra sí funciona']]);
});

test('question marks, exclamation marks, ellipsis and closing quotes or brackets also close a sentence', () => {
  for (const text of ['sí?', 'listo!', 'bueno…', 'dijo "ya."', 'ver (lo de ayer.)', '¿lo viste?  ']) assert.equal(endsSentence(text), true, text);
  for (const text of ['pues', 'dos cositas,', 'no sé;', 'a las 10:30', 'versión 2.0 y', '']) assert.equal(endsSentence(text), false, text);
});

test('a pause at or above the threshold keeps the segments apart even without punctuation', () => {
  const out = joinSegments([seg(0, 2, 'primero esto'), seg(2.3, 4, 'sigue acá'), seg(4.5, 6, 'y luego otra cosa')], PAUSE);
  // The 0.3 s gap joins; the 0.5 s gap (equal to the threshold) does not.
  assert.deepEqual(out.map((s) => [s.start, s.end, s.text]), [[0, 4, 'primero esto sigue acá'], [4.5, 6, 'y luego otra cosa']]);
  assert.equal(joinSegments([seg(0, 2, 'a'), seg(5, 6, 'b')], PAUSE).length, 2, 'a long pause');
});

test('segments from different audio chunks are never joined', () => {
  const out = joinSegments([seg(10, 12, 'cierre del trozo', 0), seg(12, 14, 'inicio del siguiente', 1)], PAUSE);
  assert.deepEqual(out.map((s) => s.chunk), [0, 1]);
  assert.deepEqual(out.map((s) => s.text), ['cierre del trozo', 'inicio del siguiente']);
});

test('a threshold of zero joins nothing', () => {
  const input = [seg(0, 1, 'a'), seg(1, 2, 'b')];
  assert.equal(joinSegments(input, 0).length, 2);
});

test('run-on speech stops growing at the word cap, and a longer single segment stays whole', () => {
  const words = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
  const input = [seg(0, 2, words(15)), seg(2, 4, words(15)), seg(4, 6, words(15)), seg(6, 8, words(60))];
  const out = joinSegments(input, PAUSE, 40);
  assert.deepEqual(out.map((s) => [s.start, s.text.split(' ').length]), [[0, 30], [4, 15], [6, 60]]);
  assert.equal(joinSegments(input, PAUSE).length, 1, 'no cap by default');
});

test('the input segments are not modified', () => {
  const input = [seg(0, 1, 'a'), seg(1, 2, 'b')];
  joinSegments(input, PAUSE);
  assert.deepEqual(input, [seg(0, 1, 'a'), seg(1, 2, 'b')]);
});
