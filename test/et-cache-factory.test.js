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
    now: () => t, refreshMs: 90_000, waitForFirst: true,
    parserOpts: { relevantWithinMs: null }, // køtestene: alle turer i fiksturen, uavhengig av klokka
    ...opts,
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

test('hvilende region: siste kopi returneres uten ny henting (linjesider vekker ikke regionen)', async () => {
  let active = true;
  const { cache, fetchFn, clock } = make({ isActive: () => active });
  const a = await cache.getJourneys();
  active = false;
  clock.advance(200_000);
  const b = await cache.getJourneys();
  const c = await cache.getJourneys();
  assert.equal(a, b);
  assert.equal(b, c);
  await tickIO(); await tickIO();
  assert.equal(fetchFn.calls, 1, 'ingen ny henting mens regionen ikke er aktiv');
  active = true;
  await cache.getJourneys();
  await tickIO(); await tickIO();
  assert.equal(fetchFn.calls, 2, 'aktiv igjen: én henting i bakgrunnen');
});

test('avlastet region uten turer: [] og ingen henting før regionen er aktiv', async () => {
  let active = false;
  const { cache, fetchFn } = make({ isActive: () => active, waitForFirst: false });
  assert.deepEqual(await cache.getJourneys(), []);
  await tickIO(); await tickIO();
  assert.equal(fetchFn.calls, 0);
  active = true;
  assert.deepEqual(await cache.getJourneys(), []);
  await tickIO(); await tickIO();
  assert.equal(fetchFn.calls, 1);
});

test('onLoad kalles etter hver vellykkede henting, ikke etter forkastet', async () => {
  let loads = 0;
  const { cache } = make({ onLoad: () => { loads++; } });
  await cache.getJourneys();
  assert.equal(loads, 1);
  await cache.refreshNow();
  assert.equal(loads, 2);
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

test('drop() under pågående henting forkaster resultatet', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  let calls = 0;
  const fetchFn = async () => { calls++; if (calls === 1) await gate; return new Response(FIXTURE, { status: 200 }); };
  const { cache } = make({ fetchFn, waitForFirst: false });
  assert.deepEqual(await cache.getJourneys(), []);
  cache.drop();
  release();
  await tickIO(); await tickIO();
  assert.equal(cache.getVersion(), 0, 'forkastet henting øker ikke versjonen');
  assert.deepEqual(await cache.getJourneys(), []);
  await tickIO(); await tickIO();
  assert.equal(calls, 2, 'ny henting startet');
  assert.ok((await cache.getJourneys()).length >= 2);
});

test('feil uten data: 60 s backoff og dempet logging', async () => {
  const warn = mock.method(console, 'warn', () => {});
  try {
    let calls = 0;
    const fetchFn = async () => { calls++; return new Response('', { status: 500 }); };
    const { cache, clock } = make({ fetchFn, waitForFirst: false });
    for (let i = 0; i < 5; i++) { await cache.getJourneys(); await tickIO(); await tickIO(); }
    assert.equal(calls, 1);
    assert.equal(warn.mock.calls.length, 1);
    clock.advance(61_000);
    await cache.getJourneys(); await tickIO(); await tickIO();
    assert.equal(calls, 2);
  } finally { warn.mock.restore(); }
});

test('MoreData-tagg delt over to biter gir advarsel', async () => {
  const warn = mock.method(console, 'warn', () => {});
  try {
    const body = FIXTURE.replace('</ServiceDelivery>', '<MoreData>true</MoreData></ServiceDelivery>');
    const i = body.indexOf('<MoreData>') + 6;
    const enc = new TextEncoder();
    const fetchFn = async () => new Response(new ReadableStream({
      start(c) { c.enqueue(enc.encode(body.slice(0, i))); c.enqueue(enc.encode(body.slice(i))); c.close(); },
    }), { status: 200 });
    const { cache } = make({ fetchFn });
    await cache.getJourneys();
    assert.ok(warn.mock.calls.some((c) => /MoreData/.test(c.arguments.join(' '))));
  } finally { warn.mock.restore(); }
});

test('stoppet body: idle-timeout avbryter, frigjør køen for neste region', async () => {
  const { createRegionRuntime } = await import('../server/region-runtime.js');
  const runtime = createRegionRuntime({ regions: [] });
  let cancelled = false;
  const stalled = async () => new Response(new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode('<Siri>')); }, // ingen flere biter
    cancel() { cancelled = true; },
  }), { status: 200 });
  const a = createEtCache({ datasetId: 'RUT', runExclusive: runtime.runExclusive, fetchFn: stalled, bodyIdleMs: 50 });
  const b = createEtCache({
    datasetId: 'SKY', runExclusive: runtime.runExclusive, fetchFn: makeFetch(), bodyIdleMs: 50,
    parserOpts: { relevantWithinMs: null },
  });
  const t0 = Date.now();
  const ra = a.refreshNow();
  const rb = b.refreshNow();
  await assert.rejects(ra, /stoppet/);
  await rb;
  assert.ok(Date.now() - t0 < 2000, `${Date.now() - t0} ms`);
  assert.ok(cancelled, 'body avbrutt');
  assert.equal(b.getVersion(), 1);
  assert.ok((await b.getJourneys()).length >= 2);
});

const FIXTURE_NOW = Date.parse('2026-10-21T08:23:09+02:00'); // ResponseTimestamp i fiksturen

test('maxSize per region i URL-en, standard 3000', async () => {
  const a = makeFetch();
  const b = makeFetch();
  await createEtCache({ datasetId: 'SKY', fetchFn: a, maxSize: 10000, waitForFirst: true }).getJourneys();
  await createEtCache({ datasetId: 'RUT', fetchFn: b, maxSize: undefined, waitForFirst: true }).getJourneys();
  assert.ok(a.urls[0].includes('datasetId=SKY&maxSize=10000'), a.urls[0]);
  assert.ok(b.urls[0].includes('maxSize=3000'), b.urls[0]);
});

test('filteret gir samme kjøretøy som alle turer, ved flere klokkeslett (falsk klokke)', async () => {
  const { selectJourneysForVehicles } = await import('../shared/et-journeys.js');
  const ids = (js, at) => selectJourneysForVehicles(js, at).map((j) => `${j.vehicleId}|${j.datedVehicleJourneyRef}`).sort();
  for (const h of [-3, -1, 0, 1, 3]) {
    const at = FIXTURE_NOW + h * 3_600_000;
    const all = await createEtCache({ datasetId: 'RUT', fetchFn: makeFetch(), now: () => at, waitForFirst: true, parserOpts: { relevantWithinMs: null } }).getJourneys();
    const kept = await createEtCache({ datasetId: 'RUT', fetchFn: makeFetch(), now: () => at, waitForFirst: true }).getJourneys();
    assert.ok(kept.length <= all.length);
    assert.deepEqual(ids(kept, at), ids(all, at), `${h} t`);
    assert.deepEqual(ids(kept, at + 90_000), ids(all, at + 90_000), `${h} t + 90 s`);
  }
});

test('like mange turer som maxSize: advarsel om avkutting (Entur sender ikke MoreData)', async () => {
  const warn = mock.method(console, 'warn', () => {});
  const log = mock.method(console, 'log', () => {});
  try {
    await createEtCache({
      datasetId: 'SKY', fetchFn: makeFetch(), maxSize: 17, waitForFirst: true, now: () => FIXTURE_NOW,
    }).getJourneys();
    assert.ok(warn.mock.calls.some((c) => /17 turer ≥ maxSize=17/.test(c.arguments[0])));
    assert.ok(log.mock.calls.some((c) => /17 turer lest, 9 beholdt/.test(c.arguments[0])));
  } finally { warn.mock.restore(); log.mock.restore(); }
});

test('body som drypper: totalfrist avbryter selv om bitene kommer innen idle-tiden', async () => {
  let timer;
  const dripping = async () => new Response(new ReadableStream({
    start(c) { timer = setInterval(() => c.enqueue(new TextEncoder().encode(' ')), 10); },
    cancel() { clearInterval(timer); },
  }), { status: 200 });
  const cache = createEtCache({ datasetId: 'SKY', fetchFn: dripping, bodyIdleMs: 50, bodyTotalMs: 120, waitForFirst: true });
  const t0 = Date.now();
  await assert.rejects(cache.refreshNow(), /for treg/);
  assert.ok(Date.now() - t0 < 1000);
  clearInterval(timer);
});

test('429 og gammel cache: samme kjøretøy med og uten filter ved +7,5 og +15 min', async () => {
  const { selectJourneysForVehicles } = await import('../shared/et-journeys.js');
  const t0 = Date.parse('2026-11-05T12:00:00Z');
  const min = 60_000;
  const iso = (ms) => new Date(ms).toISOString();
  // Turer uten passerte kall som starter hvert 2. min de neste 60 min, hver med eget kjøretøy
  const body = Array.from({ length: 30 }, (_, i) => {
    const dep = t0 + (i * 2 + 1) * min;
    return `<EstimatedVehicleJourney><LineRef>RUT:Line:31</LineRef><FramedVehicleJourneyRef><DatedVehicleJourneyRef>T${i}</DatedVehicleJourneyRef></FramedVehicleJourneyRef>`
      + `<EstimatedCalls><EstimatedCall><StopPointRef>NSR:Quay:1</StopPointRef><ExpectedDepartureTime>${iso(dep)}</ExpectedDepartureTime></EstimatedCall>`
      + `<EstimatedCall><StopPointRef>NSR:Quay:2</StopPointRef><ExpectedArrivalTime>${iso(dep + 10 * min)}</ExpectedArrivalTime></EstimatedCall></EstimatedCalls></EstimatedVehicleJourney>`;
  }).join('');
  const xml = `<Siri><ServiceDelivery><EstimatedTimetableDelivery><EstimatedJourneyVersionFrame>${body}</EstimatedJourneyVersionFrame></EstimatedTimetableDelivery></ServiceDelivery></Siri>`;
  const make429After1 = () => {
    let n = 0;
    return async () => (n++ === 0 ? new Response(xml, { status: 200 }) : new Response('', { status: 429 }));
  };
  const warn = mock.method(console, 'warn', () => {});
  try {
    let t = t0;
    const mk = (parserOpts) => createEtCache({ datasetId: 'RUT', fetchFn: make429After1(), now: () => t, waitForFirst: true, ...(parserOpts ? { parserOpts } : {}) });
    const filtered = mk();
    const all = mk({ relevantWithinMs: null });
    await filtered.getJourneys();
    await all.getJourneys();
    t = t0 + 91_000; // utløpt: bakgrunnshenting gir 429
    await filtered.getJourneys(); await all.getJourneys();
    await tickIO(); await tickIO();
    const ids = (js) => selectJourneysForVehicles(js, t).map((j) => j.datedVehicleJourneyRef).sort();
    for (const age of [7.5, 15]) {
      t = t0 + age * min;
      const a = await filtered.getJourneys();
      const b = await all.getJourneys();
      assert.equal(filtered.getVersion(), 1, 'fortsatt første henting');
      assert.ok(ids(b).length > 0);
      assert.deepEqual(ids(a), ids(b), `+${age} min`);
    }
  } finally { warn.mock.restore(); }
});
