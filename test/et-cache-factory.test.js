import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEtCache } from '../server/et-cache.js';

const FIXTURE = readFileSync(new URL('./fixtures/et-sample.xml', import.meta.url), 'utf8');
const pass = (fn) => fn();
const tickIO = () => new Promise((r) => setImmediate(r));

function makeFetch(body = FIXTURE) {
  const f = async (url) => { f.calls++; f.urls.push(url); return new Response(f.body ?? body, { status: 200 }); };
  f.calls = 0; f.urls = [];
  return f;
}
function make(opts = {}) {
  const fetchFn = opts.fetchFn || makeFetch();
  let t = 1_000_000;
  const clock = { advance: (ms) => { t += ms; } };
  const cache = createEtCache({
    datasetId: 'SKY', isActive: () => true, runExclusive: pass, fetchFn,
    now: () => t, refreshMs: 90_000, waitForFirst: true, ...opts,
  });
  return { cache, fetchFn, clock };
}

test('getJourneys gir turene og bruker datasetId i URL-en', async () => {
  const { cache, fetchFn } = make();
  const j = await cache.getJourneys();
  assert.ok(j.length >= 2);
  assert.ok(fetchFn.urls[0].includes('datasetId=SKY'));
  assert.equal(cache.getVersion(), 1);
  assert.equal(cache.getAge(), 0);
});

test('start() henter én gang uansett aktiv, intervallet henter bare når aktiv', async () => {
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    let active = false;
    const { cache, fetchFn } = make({ isActive: () => active });
    cache.start();
    await tickIO();
    assert.equal(fetchFn.calls, 1);
    mock.timers.tick(90_000);
    await tickIO();
    assert.equal(fetchFn.calls, 1, 'ikke aktiv: ingen ny henting');
    active = true;
    mock.timers.tick(90_000);
    await tickIO();
    assert.equal(fetchFn.calls, 2);
    cache.stop?.();
  } finally { mock.timers.reset(); }
});

test('hvilende region: siste kopi returneres og én henting startes', async () => {
  const { cache, fetchFn, clock } = make({ isActive: () => false });
  const a = await cache.getJourneys();
  clock.advance(200_000);
  const b = await cache.getJourneys();
  const c = await cache.getJourneys();
  assert.equal(a, b);
  assert.equal(b, c);
  await tickIO(); await tickIO();
  assert.equal(fetchFn.calls, 2, 'bare én ekstra henting');
});

test('drop() uten venting: [] med en gang, deretter turer', async () => {
  const { cache, fetchFn } = make({ waitForFirst: false });
  assert.deepEqual(await cache.getJourneys(), [], 'ingen data: [] straks');
  await tickIO(); await tickIO();
  assert.equal(fetchFn.calls, 1);
  assert.ok((await cache.getJourneys()).length >= 2);
  cache.drop();
  assert.deepEqual(await cache.getJourneys(), []);
  await tickIO(); await tickIO();
  assert.equal(fetchFn.calls, 2);
  assert.ok((await cache.getJourneys()).length >= 2);
});

test('waitForFirst: true venter på første henting også etter drop()', async () => {
  const { cache } = make();
  await cache.getJourneys();
  cache.drop();
  assert.ok((await cache.getJourneys()).length >= 2);
});

test('429 gir backoff på 5 min i bakgrunnen', async () => {
  const warn = mock.method(console, 'warn', () => {});
  try {
    let n = 0;
    const fetchFn = async () => { n++; return new Response('', { status: n === 1 ? 200 : 429 }); };
    fetchFn.body = null;
    const first = makeFetch();
    let mode = 'ok';
    const ff = async (...a) => (mode === 'ok' ? first(...a) : (n++, new Response('', { status: 429 })));
    const { cache, clock } = make({ fetchFn: ff });
    await cache.getJourneys();
    mode = 'bad';
    clock.advance(100_000);
    await cache.getJourneys(); await tickIO(); await tickIO();
    assert.equal(n, 1);
    clock.advance(100_000);
    await cache.getJourneys(); await tickIO(); await tickIO();
    assert.equal(n, 1, 'backoff: ingen ny henting');
    clock.advance(300_000);
    await cache.getJourneys(); await tickIO(); await tickIO();
    assert.equal(n, 2);
  } finally { warn.mock.restore(); }
});

test('MoreData=true gir advarsel med datasetId', async () => {
  const warn = mock.method(console, 'warn', () => {});
  try {
    const body = FIXTURE.replace('</ServiceDelivery>', '<MoreData>true</MoreData></ServiceDelivery>');
    assert.notEqual(body, FIXTURE);
    const fetchFn = makeFetch(body);
    const { cache } = make({ fetchFn });
    await cache.getJourneys();
    assert.ok(warn.mock.calls.some((c) => /MoreData/.test(c.arguments.join(' ')) && /SKY/.test(c.arguments.join(' '))));
  } finally { warn.mock.restore(); }
});

test('én henting om gangen', async () => {
  const { cache, fetchFn } = make();
  await Promise.all([cache.refreshNow(), cache.refreshNow(), cache.getJourneys()]);
  assert.equal(fetchFn.calls, 1);
});
