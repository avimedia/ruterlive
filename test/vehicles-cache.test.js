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
  assert.doesNotMatch(buildVehiclesQuery(visibleRegions([])), /bergen:/);
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
