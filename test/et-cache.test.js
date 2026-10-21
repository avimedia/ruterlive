import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseEtJourneys } from '../server/et-parse.js';

const FIXTURE = readFileSync(new URL('./fixtures/et-sample.xml', import.meta.url), 'utf8');

const tick = async () => {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
};

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
    const etCache = await import('../server/et-cache.js');
    const { getEtJourneys, getEtVersion } = etCache;
    const a = await getEtJourneys();
    const b = await getEtJourneys();
    assert.equal(calls, 1);
    assert.equal(a, b, 'samme array – ikke parset på nytt');
    assert.deepEqual(a, parseEtJourneys(FIXTURE));
    assert.equal(getEtVersion(), 1);
    assert.equal('ensureEtCache' in etCache || 'getCachedEt' in etCache, false, 'XML-en eksponeres ikke');
    assert.throws(() => { a[0].mode = 'rail'; }, TypeError, 'delte turer kan ikke muteres');

    // Ny XML etter utløpt cache → forrige turer straks, nytt parseresultat etter revalidering
    body = FIXTURE.replace(/<EstimatedVehicleJourney>[\s\S]*?<\/EstimatedVehicleJourney>/, '');
    mock.timers.tick(91_000);
    assert.equal(await getEtJourneys(), a);
    await tick();
    const c = await getEtJourneys();
    assert.equal(calls, 2);
    assert.notEqual(c, a);
    assert.deepEqual(c, parseEtJourneys(body));
    assert.equal(await getEtJourneys(), c);
    assert.equal(getEtVersion(), 2);
  } finally {
    mock.timers.reset();
    globalThis.fetch = realFetch;
  }
});

test('getEtJourneys: feil uten data avviser; 429 med data gir forrige turer og pause', async () => {
  let calls = 0;
  let status = 500;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    calls++;
    return new Response(status === 200 ? FIXTURE : 'feil', { status });
  };
  mock.timers.enable({ apis: ['Date'], now: 5_000_000 });
  try {
    const { getEtJourneys, getEtVersion } = await import('../server/et-cache.js?feil');
    await assert.rejects(getEtJourneys());
    status = 200;
    const a = await getEtJourneys();
    assert.ok(a.length > 0);
    status = 429;
    mock.timers.tick(91_000);
    assert.equal(await getEtJourneys(), a);
    await tick();
    assert.equal(await getEtJourneys(), a, '429 beholder forrige turer');
    const n = calls;
    mock.timers.tick(91_000);
    await getEtJourneys();
    await tick();
    assert.equal(calls, n, 'ingen nye kall i pausen etter 429');
    assert.equal(getEtVersion(), 1);
  } finally {
    mock.timers.reset();
    globalThis.fetch = realFetch;
  }
});
