// Scorer of the heterogeneous sample: synthetic truth, no real data.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildTruth, scoreMessages, titleOverlap, totalOf } from './muestra.js';

// Requests 1 to 3 have their own units; request 4 shares its only unit (u9) with request 3; u10 is context.
const truth = buildTruth({ pedidos: [{ n: 1, unit_ids: [1, 2] }, { n: 2, unit_ids: [3] }, { n: 3, unit_ids: [4, 5, 9] }, { n: 4, unit_ids: [9] }, { n: 5, unit_ids: [6, 7, 8] }] });

describe('truth of a sample element', () => {
  it('the core of a request is the units no other request lists; a request with no core joins the one it shares units with', () => {
    assert.deepEqual([...truth.pedidos[2].core], [4, 5]);
    assert.equal(truth.pedidos[3].joins, 3);
    assert.equal(truth.pedidos[0].joins, null);
    assert.deepEqual([...truth.pedidoUnits].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe('score of a set of messages', () => {
  it('one message per request gets its own message; a context message is surplus', () => {
    const s = scoreMessages([{ unit_ids: [1, 2] }, { unit_ids: [3] }, { unit_ids: [4, 5, 9] }, { unit_ids: [6, 7, 8] }, { unit_ids: [10] }], truth);
    assert.equal(s.requests, 4);
    assert.equal(s.joined, 1);
    assert.equal(s.solo, 4);
    assert.equal(s.surplus, 1);
    assert.deepEqual(s.surplus_messages, [4]);
    assert.equal(s.mixed_messages, 0);
  });

  it('requests that share a message are mixed, or buried when they weigh less than half of the heaviest', () => {
    const s = scoreMessages([{ unit_ids: [1, 2, 3, 6, 7, 8] }, { unit_ids: [4, 5, 9] }], truth);
    // request 5 weighs 3 units, request 1 two, request 2 one: request 2 is below half of 3
    assert.deepEqual(s.rows.map((r) => [r.n, r.status]), [[1, 'mixed'], [2, 'buried'], [3, 'solo'], [5, 'mixed']]);
    assert.equal(s.mixed_messages, 1);
  });

  it('units in no message are lost; a request spread over two messages is split and keeps its main message', () => {
    const lost = scoreMessages([{ unit_ids: [1, 2] }, { unit_ids: [4, 5, 9] }, { unit_ids: [6, 7, 8] }], truth);
    assert.equal(lost.lost, 1);
    const split = scoreMessages([{ unit_ids: [1, 2] }, { unit_ids: [3] }, { unit_ids: [4] }, { unit_ids: [5, 9] }, { unit_ids: [6, 7, 8] }], truth);
    assert.equal(split.split, 1);
    assert.equal(split.rows.find((r) => r.n === 3).status, 'solo');
  });

  it('two messages with the same title are twins', () => {
    const s = scoreMessages([{ unit_ids: [1, 2], title: 'Agregar un botón para borrar los filtros' }, { unit_ids: [3], title: 'Agregar un botón para borrar todos los filtros' }], truth);
    assert.equal(s.twins, 1);
    assert.equal(titleOverlap('a b', 'c d'), 0);
  });

  it('totals add the counts of several elements', () => {
    const a = scoreMessages([{ unit_ids: [1, 2] }], truth);
    assert.equal(totalOf([a, a]).messages, 2);
  });
});
