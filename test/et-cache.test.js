import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseEtJourneys } from '../server/et-parse.js';

const FIXTURE = readFileSync(new URL('./fixtures/et-sample.xml', import.meta.url), 'utf8');

test('getEtJourneys parser én gang per ny XML og deler resultatet', async () => {
  let calls = 0;
  let body = FIXTURE;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls++;
    assert.equal(opts.headers['ET-Client-Name'], 'ruterlive-web');
    return new Response(body, { status: 200 });
  };
  mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  try {
    const { getEtJourneys, ensureEtCache } = await import('../server/et-cache.js');
    const a = await getEtJourneys();
    const b = await getEtJourneys();
    assert.equal(calls, 1);
    assert.equal(a, b, 'samme array – ikke parset på nytt');
    assert.deepEqual(a, parseEtJourneys(FIXTURE));
    assert.equal(await ensureEtCache(), FIXTURE, 'XML-strengen er fortsatt tilgjengelig for /api/et-cached');
    assert.throws(() => { a[0].mode = 'rail'; }, TypeError, 'delte turer kan ikke muteres');

    // Ny XML etter utløpt cache → nytt parseresultat
    body = FIXTURE.replace(/<EstimatedVehicleJourney>[\s\S]*?<\/EstimatedVehicleJourney>/, '');
    mock.timers.tick(91_000);
    await ensureEtCache(); // starter revalidering i bakgrunnen
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    const c = await getEtJourneys();
    assert.equal(calls, 2);
    assert.notEqual(c, a);
    assert.deepEqual(c, parseEtJourneys(body));
    assert.equal(await getEtJourneys(), c);
  } finally {
    mock.timers.reset();
    globalThis.fetch = realFetch;
  }
});
