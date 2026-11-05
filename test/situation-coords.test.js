import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStopCoords, withStopCoords } from '../server/situation-coords.js';

// GTFS-kartet slik gtfs-stops-loader bygger det: quay → { lat, lon, name, parent } (parent = StopPlace-nummer)
const gtfs = new Map([
  ['NSR:Quay:1', { lat: 59.9111111, lon: 10.7500004, name: 'Jernbanetorget', parent: 100 }],
  ['NSR:Quay:2', { lat: 59.9113333, lon: 10.7510004, name: 'Jernbanetorget', parent: 100 }],
  ['NSR:Quay:3', { lat: 60.39, lon: 5.33, name: 'Bergen busstasjon', parent: 200 }],
]);
const catalog = [{ id: 'NSR:StopPlace:300', lat: 59.95, lon: 10.765 }];

test('createStopCoords: quay fra GTFS, stoppested som snitt av quayene, katalog som reserve, avrundet', () => {
  const coords = createStopCoords({ getStopsMap: () => gtfs, catalogStops: () => catalog });
  const m = coords(['NSR:Quay:1', 'NSR:StopPlace:100', 'NSR:StopPlace:300', 'NSR:Quay:999', 'NSR:StopPlace:999', 'x']);
  assert.deepEqual(m.get('NSR:Quay:1'), [59.91111, 10.75]);
  assert.deepEqual(m.get('NSR:StopPlace:100'), [59.91122, 10.7505]);
  assert.deepEqual(m.get('NSR:StopPlace:300'), [59.95, 10.765]);
  assert.equal(m.has('NSR:Quay:999'), false);
  assert.equal(m.has('NSR:StopPlace:999'), false);
  assert.equal(m.has('x'), false);
});

test('createStopCoords: uten GTFS gir bare katalogen', () => {
  const coords = createStopCoords({ getStopsMap: () => null, catalogStops: () => catalog });
  const m = coords(['NSR:Quay:1', 'NSR:StopPlace:300']);
  assert.equal(m.has('NSR:Quay:1'), false);
  assert.deepEqual(m.get('NSR:StopPlace:300'), [59.95, 10.765]);
});

test('withStopCoords: legger lat/lon på kjente stopp uten å endre originalen', () => {
  const coords = createStopCoords({ getStopsMap: () => gtfs, catalogStops: () => [] });
  const s = { id: 'a', summary: 'x', stops: [{ id: 'NSR:Quay:3', name: 'Bergen' }, { id: 'NSR:Quay:999', name: 'Ukjent' }] };
  const t = { id: 'b', summary: 'y', stops: [] };
  const [out, out2] = withStopCoords([s, t], coords);
  assert.deepEqual(out.stops, [{ id: 'NSR:Quay:3', name: 'Bergen', lat: 60.39, lon: 5.33 }, { id: 'NSR:Quay:999', name: 'Ukjent' }]);
  assert.equal('lat' in s.stops[0], false, 'indeksen deles med sidene og skal ikke endres');
  assert.equal(out2, t, 'uten stopp gjenbrukes objektet');
});
