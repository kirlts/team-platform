// Hunt for the failures of the analysis (2026-10-24): each case below is a way a send spent provider money twice or ended with a reason the
// author could not read, reproduced with the fake provider before it was fixed. The rule they share: a failure that will not improve stops the
// calls at once, a transient one waits as long as the provider asked and no longer than the job lasts, and a cancelled job makes no more calls.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createFakeProviders, ProviderHttpError } from '../providers/index.js';
import { analyze as analyzeAll } from './index.js';
import { bugMessage, firstReadingOnly, makeBundle, MULTI_TEXT, unitIdsIn } from './testing/fixtures.js';

const analyze = firstReadingOnly(analyzeAll);
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// Three groups of the same area and template, so one answer shape is valid for every decomposition.
const THREE_BUGS = {
  groups: [2, 3, 4].map((id) => ({ unit_ids: [id], area_id: 2, template_id: 2 })),
  discarded: [{ unit_ids: [1], reason: 'saludo' }, { unit_ids: [5], reason: 'despedida' }],
};

describe('analysis: calls after a failure', () => {
  it('a failure that will not improve stops the calls that had not started: the groups waiting do not go out while the job fails', async () => {
    const bundle = await makeBundle({ text: MULTI_TEXT });
    let started = 0;
    const fake = createFakeProviders({
      text: (req, n) => {
        if (n === 0) return THREE_BUGS;
        started += 1;
        if (started === 1) throw new ProviderHttpError('anthropic: invalid x-api-key', { status: 401, retryable: false });
        return sleep(60).then(() => ({ messages: [bugMessage(unitIdsIn(req), 'Corregir el botón Enviar')] }));
      },
    });
    await assert.rejects(analyze(bundle, { providers: fake, config: { partitionConcurrency: 2, httpRetries: 0 } }), { status: 401 });
    await sleep(200); // what a worker that is still running would start now
    assert.equal(fake.calls.text.length, 3, 'classification, the call that failed and the one already in flight: the third group never goes out');
  });
});

describe('analysis: the wait between retries', () => {
  const overloaded = (retryAfterMs) => new ProviderHttpError('anthropic: Overloaded', { status: 529, retryable: true, retryAfterMs });
  const oneBug = (req) => ({ messages: [bugMessage(unitIdsIn(req), 'Corregir el botón Enviar')] });
  // The first call is refused with a Retry-After of an hour; then the classification and the decomposition answer.
  const answers = (req, n) => {
    if (n === 0) throw overloaded(3_600_000);
    return n === 1 ? { groups: [{ unit_ids: [2], area_id: 2, template_id: 2 }], discarded: [{ unit_ids: [1], reason: 'saludo' }] } : oneBug(req);
  };

  it('a Retry-After of an hour is not slept through: the wait is cut to httpRetryMaxWaitMs and the call goes again', { timeout: 5000 }, async () => {
    const bundle = await makeBundle({ text: 'Hola.\n\nEl botón Enviar no hace nada.' });
    const fake = createFakeProviders({ text: answers });
    const result = await analyze(bundle, { providers: fake, config: { httpRetryMaxWaitMs: 40 } });
    assert.equal(result.status, 'ok');
    assert.equal(result.stats.http_retries, 1);
  });

  it('a job that ends while its call waits to retry makes no further call and stops waiting at once', { timeout: 5000 }, async () => {
    const bundle = await makeBundle({ text: 'Hola.\n\nEl botón Enviar no hace nada.' });
    const fake = createFakeProviders({ text: answers });
    const controller = new AbortController();
    setTimeout(() => controller.abort('lost'), 40);
    const started = Date.now();
    const error = await analyze(bundle, { providers: fake, signal: controller.signal, config: { httpRetryMaxWaitMs: 30_000 } }).catch((e) => e);
    assert.equal(error.code, 'aborted');
    assert.ok(Date.now() - started < 1000, `${Date.now() - started} ms`);
    await sleep(100);
    assert.equal(fake.calls.text.length, 1, 'the call that was waiting to go again never left');
  });

  it('a job that was already cancelled when the analysis starts sends nothing', async () => {
    const bundle = await makeBundle({ text: 'Hola.\n\nEl botón Enviar no hace nada.' });
    const fake = createFakeProviders({ text: answers });
    const error = await analyze(bundle, { providers: fake, signal: AbortSignal.abort('lost') }).catch((e) => e);
    assert.equal(error.code, 'aborted');
    assert.equal(fake.calls.text.length, 0);
  });
});

describe('analysis: an account with nothing left', () => {
  const spent = () => new ProviderHttpError('deepseek: You exceeded your current quota', { status: 429, retryable: false, quota: true });
  const bundle = () => makeBundle({ text: 'Hola.\n\nEl botón Enviar no hace nada.' });

  it('is not retried on the same provider: one call, not five, and the failure says what it is', async () => {
    const fake = createFakeProviders({ text: () => { throw spent(); } });
    const error = await analyze(await bundle(), { providers: fake }).catch((e) => e);
    assert.equal(error.quota, true);
    assert.equal(fake.calls.text.length, 1);
  });

  it('goes to the fallback provider, whose account may still have some', async () => {
    const answers = (req, n) => (n === 0
      ? { groups: [{ unit_ids: [2], area_id: 2, template_id: 2 }], discarded: [{ unit_ids: [1], reason: 'saludo' }] }
      : { messages: [bugMessage(unitIdsIn(req), 'Corregir el botón Enviar')] });
    const fake = createFakeProviders({ text: () => { throw spent(); }, textFallback: answers });
    const result = await analyze(await bundle(), { providers: fake });
    assert.equal(result.status, 'ok');
    assert.equal(fake.calls.text.length, fake.calls.textFallback.length, 'each call asked the main provider once, then the fallback');
  });
});
