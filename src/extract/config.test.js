import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, resolveConfig } from './config.js';

test('los valores por omisión son los del informe 06 y del informe 05', () => {
  assert.equal(DEFAULTS.audio.chunkSeconds, 600);
  assert.equal(DEFAULTS.audio.overlapSeconds, 5);
  assert.equal(DEFAULTS.audio.budgetSecondsPerHour, 7200);
  assert.equal(DEFAULTS.video.maxFrames, 48);
  assert.equal(DEFAULTS.video.frameHashDistance, 6);
  assert.equal(DEFAULTS.video.frameWidth, 720);
  assert.equal(DEFAULTS.video.maxSeconds, 1200);
  assert.equal(DEFAULTS.video.maxBytes, 2 * 1024 ** 3);
  assert.equal(DEFAULTS.document.scannedPageMaxChars, 30);
  assert.equal(DEFAULTS.document.maxBytes, 24 * 1024 * 1024);
  assert.equal(DEFAULTS.text.maxChars, 270_000);
  assert.equal(DEFAULTS.link.maxBytes, 5 * 1024 * 1024);
  assert.equal(DEFAULTS.link.maxRedirects, 5);
  assert.deepEqual(DEFAULTS.link.allowedPrivateHosts, []);
});

test('una perilla dada pisa sólo ese valor de su sección', () => {
  const cfg = resolveConfig({ audio: { chunkSeconds: 20 } });
  assert.equal(cfg.audio.chunkSeconds, 20);
  assert.equal(cfg.audio.overlapSeconds, 5);
  assert.equal(cfg.video.maxFrames, 48);
});

test('una sección desconocida se rechaza', () => {
  assert.throws(() => resolveConfig({ audio2: {} }), /perilla desconocida/);
});

test('los valores por omisión no se pueden modificar', () => {
  assert.throws(() => { 'use strict'; DEFAULTS.audio.chunkSeconds = 1; });
});
