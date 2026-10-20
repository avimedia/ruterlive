import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getLineStops } from '../server/line-catalog.js';

const line = { slug: 'test-henger', authority: 'RUT', code: '1' };

// Fetch som aldri svarer og ignorerer AbortSignal – slik et hengende Entur-kall oppførte seg i prod.
const hangingFetch = () => new Promise(() => {});

function okFetch(_url, opts) {
  const query = JSON.parse(opts.body).query;
  const data = query.includes('lines(')
    ? { lines: [{ id: 'RUT:Line:1', publicCode: '1' }] }
    : { line: { name: 'A-B', journeyPatterns: [{ quays: [{ name: 'A' }, { name: 'M' }, { name: 'B' }], serviceJourneys: [{ id: 'x' }] }] } };
  return Promise.resolve({ ok: true, json: async () => ({ data }) });
}

test('hengende JP-kall gir null innen tidsgrensen og låser ikke linjen', async () => {
  const started = Date.now();
  assert.equal(await getLineStops(line, hangingFetch, 50), null);
  assert.ok(Date.now() - started < 1000);
});

test('etter et hengende kall kan en ny henting lykkes (ingen fastlåst in-flight)', async () => {
  const other = { ...line, slug: 'test-etter-heng' };
  assert.equal(await getLineStops(other, hangingFetch, 50), null);
  // Feil caches i 60 s per slug – bruk ny slug, men samme delte linje-ID-oppslag.
  const fresh = await getLineStops({ ...line, slug: 'test-frisk' }, okFetch, 50);
  assert.deepEqual(fresh.stops, ['A', 'M', 'B']);
});
