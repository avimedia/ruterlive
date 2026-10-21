import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLineModeCache, fillLineModes, mapJpTransportMode } from '../server/line-modes.js';

test('mapJpTransportMode', () => {
  assert.equal(mapJpTransportMode('metro'), 'metro');
  assert.equal(mapJpTransportMode('ferry'), 'water');
  assert.equal(mapJpTransportMode('coach'), null);
  assert.equal(mapJpTransportMode(null), null);
});

test('fillLineModes: henter alle ukjente i bolker, og bare én gang', async () => {
  const cache = createLineModeCache({ now: () => 0 });
  const calls = [];
  const query = async (refs) => {
    calls.push(refs.length);
    return Object.fromEntries(refs.map((r) => [r, 'bus']));
  };
  const refs = Array.from({ length: 120 }, (_, i) => `RUT:Line:${i}`);
  assert.equal(await fillLineModes(refs, cache, query, 50), 120);
  assert.deepEqual(calls, [50, 50, 20]);
  assert.equal(cache.get('RUT:Line:7'), 'bus');
  assert.equal(await fillLineModes(refs, cache, query, 50), 0);
  assert.equal(calls.length, 3);
});

test('fillLineModes: feil caches negativt i 10 min, deretter nytt forsøk', async () => {
  let t = 0;
  const cache = createLineModeCache({ now: () => t, negativeTtlMs: 600000, ttlMs: 86400000 });
  let n = 0;
  const failing = async () => {
    n++;
    throw new Error('429');
  };
  await fillLineModes(['A', 'B'], cache, failing);
  assert.equal(n, 1);
  assert.equal(cache.get('A'), undefined);
  t = 599999;
  await fillLineModes(['A', 'B'], cache, failing);
  assert.equal(n, 1);
  t = 600000;
  await fillLineModes(['A', 'B'], cache, async (refs) => ({ A: 'tram', B: null }));
  assert.equal(cache.get('A'), 'tram');
  assert.equal(cache.get('B'), undefined); // linje uten modus: negativ igjen
});

test('createLineModeCache: positiv modus utløper etter TTL', () => {
  let t = 0;
  const cache = createLineModeCache({ now: () => t, ttlMs: 1000 });
  cache.set('A', 'metro');
  assert.deepEqual(cache.missing(['A', 'A', 'B']), ['B']);
  t = 1000;
  assert.equal(cache.get('A'), undefined);
  assert.deepEqual(cache.missing(['A']), ['A']);
});
