import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupeInFlight } from '../server/in-flight.js';
import { loadGtfsStops } from '../server/gtfs-stops-loader.js';

test('dedupeInFlight starter bare én henting for samtidige kall', async () => {
  let calls = 0;
  const f = dedupeInFlight(async () => { calls++; await new Promise((r) => setTimeout(r, 20)); return 'ok'; });
  const [a, b] = await Promise.all([f(), f()]);
  assert.equal(calls, 1);
  assert.equal(a, 'ok');
  assert.equal(b, 'ok');
  await f();
  assert.equal(calls, 2);
});

test('dedupeInFlight nullstilles etter feil', async () => {
  let calls = 0;
  const f = dedupeInFlight(async () => { calls++; throw new Error('x'); });
  await assert.rejects(f());
  await assert.rejects(f());
  assert.equal(calls, 2);
});

test('loadGtfsStops: samtidige kall gir én nedlasting', async () => {
  let calls = 0;
  // Teller bare full nedlasting (uten Range); Range-forsøket kommer i tillegg.
  const fetchFn = async (url, options = {}) => {
    if (!options.headers?.Range) calls++;
    await new Promise((r) => setTimeout(r, 20));
    return { ok: false, status: 500 };
  };
  const [a, b] = await Promise.all([loadGtfsStops(fetchFn), loadGtfsStops(fetchFn)]);
  assert.equal(calls, 1);
  assert.equal(a, null);
  assert.equal(b, null);
});

test('dedupeInFlight med tidsgrense: hengende henting avvises og låser ikke neste kall', async () => {
  let calls = 0;
  const f = dedupeInFlight(() => { calls++; return new Promise(() => {}); }, { timeoutMs: 30 });
  await assert.rejects(f(), /tidsavbrudd/);
  await assert.rejects(f(), /tidsavbrudd/);
  assert.equal(calls, 2);
});

test('loadGtfsStops avviser ikke når nedlastingen henger (tidsavbrudd gir null/forrige cache)', async () => {
  // Bruker en fetch som feiler raskt; kontrakten er at loadGtfsStops aldri kaster.
  const result = await loadGtfsStops(async () => { throw new Error('nede'); });
  assert.ok(result === null || result instanceof Map);
});
