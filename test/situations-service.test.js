import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createSituationService } from '../server/situations.js';
import { registerSituationRoutes } from '../server/situations-routes.js';

const raw = (id, extra = {}) => ({
  situationNumber: id,
  summary: [{ value: 'Forsinkelser', language: 'no' }],
  affects: { affectedLines: [{ line: { lineRef: 'RUT:Line:1', publicCode: '1' } }] },
  ...extra,
});
const okResponse = (situations) => ({ ok: true, status: 200, json: async () => ({ data: { situations } }) });

function setup(responses) {
  const clock = { t: 1_000_000 };
  const calls = [];
  const fetchFn = async (url, options, config) => {
    calls.push({ url, options, config });
    const r = responses.shift();
    if (r instanceof Error) throw r;
    return r;
  };
  const service = createSituationService({ fetchFn, now: () => clock.t });
  return { clock, calls, service };
}

test('første henting gir indeks, med riktig URL, header og spørring', async () => {
  const { calls, service } = setup([okResponse([raw('RUT:SituationNumber:1')])]);
  assert.equal(service.getIndex(), null);
  assert.equal(service.getVersion(), 0);
  await service.refreshNow();
  assert.equal(service.getIndex().all.length, 1);
  assert.equal(service.getVersion(), 1);
  const c = calls[0];
  assert.equal(c.url, 'https://api.entur.io/realtime/v2/vehicles/graphql');
  assert.equal(c.options.method, 'POST');
  assert.equal(c.options.headers['ET-Client-Name'], 'ruterlive-web');
  assert.match(JSON.parse(c.options.body).query, /situations \{ situationNumber severity/);
  assert.deepEqual(c.config, { timeout: 15000, retries: 1 });
});

test('feil etter 10 min beholder forrige, etter 16 min null', async () => {
  const { clock, service } = setup([okResponse([raw('RUT:SituationNumber:1')]), new Error('nede'), new Error('nede')]);
  await service.refreshNow();
  clock.t += 10 * 60_000;
  await service.refreshNow();
  assert.equal(service.getIndex().all.length, 1);
  assert.equal(service.getVersion(), 1);
  clock.t += 6 * 60_000;
  await service.refreshNow();
  assert.equal(service.getIndex(), null);
});

test('errors uten data.situations er feil', async () => {
  const bad = { ok: true, status: 200, json: async () => ({ errors: [{ message: 'x' }] }) };
  const { service } = setup([okResponse([raw('RUT:SituationNumber:1')]), bad]);
  await service.refreshNow();
  await service.refreshNow();
  assert.equal(service.getVersion(), 1);
  assert.equal(service.getIndex().all.length, 1);
});

test('utløpte avvik filtreres ved bygging', async () => {
  const past = [{ startTime: '2000-01-01T00:00:00Z', endTime: '2000-01-02T00:00:00Z' }];
  const { service } = setup([okResponse([raw('RUT:SituationNumber:1', { validityPeriods: past })])]);
  await service.refreshNow();
  assert.equal(service.getIndex().all.length, 0);
});

async function withApp(service, fn) {
  const app = express();
  registerSituationRoutes(app, { service, visible: [{ id: 'oslo', situationCodespaces: ['RUT'] }, { id: 'bergen', situationCodespaces: ['SKY'] }] });
  const server = app.listen(0);
  try {
    await fn(`http://127.0.0.1:${server.address().port}/api/situations`);
  } finally {
    server.close();
  }
}

test('/api/situations: 400, no-store uten data, ETag stabil og ny etter ny versjon', async () => {
  const { service } = setup([okResponse([raw('RUT:SituationNumber:1')]), okResponse([raw('RUT:SituationNumber:1'), raw('RUT:SituationNumber:2')])]);
  await withApp(service, async (url) => {
    let r = await fetch(`${url}?region=xx`);
    assert.equal(r.status, 400);
    assert.deepEqual(await r.json(), { error: 'ukjent region' });

    r = await fetch(url);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await r.json(), { available: false, situations: [] });

    await service.refreshNow();
    r = await fetch(url);
    assert.equal(r.headers.get('cache-control'), 'public, max-age=60');
    const body = await r.json();
    assert.equal(body.available, true);
    assert.equal('updatedAt' in body, false);
    assert.equal(body.situations.length, 1);
    const etag = r.headers.get('etag');
    const r2 = await fetch(url);
    assert.equal(r2.headers.get('etag'), etag);
    const r3 = await fetch(url, { headers: { 'if-none-match': etag } });
    assert.equal(r3.status, 304);

    await service.refreshNow();
    const r4 = await fetch(url);
    assert.notEqual(r4.headers.get('etag'), etag);
    assert.equal((await r4.json()).situations.length, 2);
    // Bergen har ingen RUT-avvik
    const r5 = await fetch(`${url}?region=bergen`);
    assert.equal((await r5.json()).situations.length, 0);
  });
});

test('/api/situations: identisk Entur-data ved ny henting gir samme ETag (304)', async () => {
  const { service } = setup([okResponse([raw('RUT:SituationNumber:1')]), okResponse([raw('RUT:SituationNumber:1')])]);
  await service.refreshNow();
  await withApp(service, async (url) => {
    const r = await fetch(url);
    const etag = r.headers.get('etag');
    await service.refreshNow();
    assert.equal(service.getVersion(), 2);
    const r2 = await fetch(url, { headers: { 'if-none-match': etag } });
    assert.equal(r2.status, 304);
  });
});

test('/api/situations: stopp får lat/lon fra coordsFor, ukjente uten', async () => {
  const stops = { stopPoints: [{ id: 'NSR:Quay:1', name: 'A' }, { id: 'NSR:StopPlace:9', name: 'B' }] };
  const { service } = setup([okResponse([raw('RUT:SituationNumber:1', { affects: { ...raw('x').affects, ...stops } })])]);
  await service.refreshNow();
  const app = express();
  const coordsFor = (ids) => new Map(ids.filter((id) => id === 'NSR:Quay:1').map((id) => [id, [59.91, 10.75]]));
  registerSituationRoutes(app, { service, visible: [{ id: 'oslo', situationCodespaces: ['RUT'] }], coordsFor });
  const server = app.listen(0);
  try {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api/situations`);
    const body = await r.json();
    assert.deepEqual(body.situations[0].stops, [{ id: 'NSR:Quay:1', name: 'A', lat: 59.91, lon: 10.75 }, { id: 'NSR:StopPlace:9', name: 'B' }]);
    assert.equal('lat' in service.getIndex().all[0].stops[0], false);
  } finally {
    server.close();
  }
});
