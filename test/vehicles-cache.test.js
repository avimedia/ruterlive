import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVehiclesCache, buildVehiclesQuery } from '../server/vehicles-cache.js';
import { parsePreview } from '../server/region-preview.js';
import { REGIONS, visibleRegions } from '../shared/regions.js';

const gps = (id) => ({
  vehicleId: id,
  lastUpdated: new Date().toISOString(),
  location: { latitude: 60, longitude: 10 },
  line: { publicCode: '1', lineRef: 'X:Line:1' },
  mode: 'BUS',
  bearing: 0,
  destinationName: 'Der',
  serviceJourney: { id: 'sj' },
});

function fakeFetch(payload, calls) {
  return async (url, opts) => {
    calls.push(JSON.parse(opts.body).query);
    return { json: async () => ({ data: payload }) };
  };
}

const begge = () => visibleRegions(['bergen']);

test('parsePreview: kommaseparert, trimmet, tom gir []', () => {
  assert.deepEqual(parsePreview('bergen, Oslo ,'), ['bergen', 'oslo']);
  assert.deepEqual(parsePreview(''), []);
  assert.deepEqual(parsePreview(undefined), []);
});

test('spørringen har ett alias per region', () => {
  const q = buildVehiclesQuery(begge());
  assert.match(q, /oslo: vehicles\(boundingBox/);
  assert.match(q, /bergen: vehicles\(boundingBox/);
  assert.equal((q.match(/vehicles\(boundingBox/g) || []).length, 2);
  assert.ok(q.includes(`minLat: ${REGIONS.bergen.vehicleBounds.minLat}`));
});

test('skjult region er ikke med uten forhåndsvisning', () => {
  assert.doesNotMatch(buildVehiclesQuery(visibleRegions([], { oslo: REGIONS.oslo })), /bergen:/);
});

test('svar med to alias gir riktig liste per region, ett kall', async () => {
  const calls = [];
  const get = createVehiclesCache({
    getRegions: begge,
    fetchFn: fakeFetch({ oslo: [gps('A')], bergen: [gps('B'), gps('C')] }, calls),
  });
  const oslo = await get();
  const bergen = await get('bergen');
  assert.deepEqual(oslo.data.vehicles.map((v) => v.vehicleId), ['A']);
  assert.deepEqual(bergen.data.vehicles.map((v) => v.vehicleId), ['B', 'C']);
  assert.equal(calls.length, 1);
});

test('ukjent region gir tom liste', async () => {
  const get = createVehiclesCache({ getRegions: begge, fetchFn: fakeFetch({ oslo: [gps('A')], bergen: [] }, []) });
  assert.deepEqual(await get('trondheim'), { data: { vehicles: [] } });
});

test('samme objekt uten ny henting, nytt objekt etter ny henting', async () => {
  let n = 0;
  const get = createVehiclesCache({
    getRegions: begge,
    fetchFn: async () => ({ json: async () => ({ data: { oslo: [gps('A' + n++)], bergen: [] } }) }),
  });
  const a = await get();
  assert.equal(await get(), a);
  assert.equal(await get('trondheim'), await get('trondheim'));
  const realNow = Date.now;
  Date.now = () => realNow() + 60000;
  try {
    await get(); // stale: starter revalidering
    await new Promise((r) => setTimeout(r, 10));
    const b = await get();
    assert.notEqual(b, a);
  } finally {
    Date.now = realNow;
  }
});

test('delvis GraphQL-feil: regionen som svarte beholdes, den som feilet beholder forrige liste', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  let payload = { data: { oslo: [gps('A')], bergen: [gps('B')] } };
  const get = createVehiclesCache({ getRegions: begge, fetchFn: async () => ({ json: async () => payload }) });
  const firstBergen = await get('bergen');
  payload = { data: { oslo: [gps('A2')], bergen: null }, errors: [{ message: 'Timeout', path: ['bergen'] }] };
  const realNow = Date.now;
  Date.now = () => realNow() + 60000;
  try {
    await get(); // stale: revalidering
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual((await get()).data.vehicles.map((v) => v.vehicleId), ['A2'], 'Oslo-GPS beholdes');
    assert.equal(await get('bergen'), firstBergen, 'Bergen: forrige liste');
  } finally { Date.now = realNow; }
  assert.ok(warn.mock.calls.some((c) => /bergen/.test(c.arguments.join(' '))));
});

test('delvis GraphQL-feil ved første henting: tom liste for regionen som feilet', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const get = createVehiclesCache({
    getRegions: begge,
    fetchFn: async () => ({ json: async () => ({ data: { oslo: [gps('A')] }, errors: [{ message: 'feil', path: ['bergen'] }] }) }),
  });
  assert.deepEqual((await get()).data.vehicles.map((v) => v.vehicleId), ['A']);
  assert.deepEqual((await get('bergen')).data.vehicles, []);
});

test('GraphQL-feil uten data for noen region kaster', async () => {
  const get = createVehiclesCache({
    getRegions: begge,
    fetchFn: async () => ({ json: async () => ({ data: null, errors: [{ message: 'nede' }] }) }),
  });
  await assert.rejects(get(), /nede/);
});
