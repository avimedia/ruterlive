import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getRegion } from '../shared/regions.js';
import { createEtVehiclesService } from '../server/et-vehicles-service.js';
import { createShapeService } from '../server/shape-service.js';
import { createEtStreamParser } from '../server/et-parse.js';

const NOW = Date.now();
const QUAYS = new Map([
  ['NSR:Quay:1', [60.39, 5.32]],
  ['NSR:Quay:2', [60.40, 5.33]],
  ['NSR:Quay:3', [60.41, 5.34]],
  ['NSR:Quay:4', [60.42, 5.35]],
]);

function journey(lineRef, mode, id = 'v1') {
  return {
    vehicleId: id,
    mode,
    lineRef,
    destinationName: 'Slutt',
    datedVehicleJourneyRef: id,
    recordedCalls: [{ quayId: 'NSR:Quay:1', name: 'Ett', time: NOW - 60000 }],
    estimatedCalls: [
      { quayId: 'NSR:Quay:2', name: 'To', arrTime: NOW + 60000, depTime: NOW + 70000, delay: 0 },
      { quayId: 'NSR:Quay:3', name: 'Tre', arrTime: NOW + 160000, depTime: NOW + 170000, delay: 0 },
      { quayId: 'NSR:Quay:4', name: 'Fire', arrTime: NOW + 260000, depTime: NOW + 270000, delay: 0 },
    ],
  };
}

const fakeCache = (journeys) => ({ getJourneys: async () => journeys, getVersion: () => 1 });
function deps(modes = {}) {
  return {
    ensureGtfsStopsLoaded: async () => {},
    getGtfsQuayCache: () => QUAYS,
    ensureLineModes: async () => {},
    getLineMode: (ref) => modes[ref],
  };
}
const make = (regionId, journeys, modes) =>
  createEtVehiclesService({ region: getRegion(regionId), etCache: fakeCache(journeys), deps: deps(modes) });

test('Bergen: SKY-linje 2 med JP-modus tram blir tram, ikke T-bane', async () => {
  const svc = make('bergen', [journey('SKY:Line:2', 'bus')], { 'SKY:Line:2': 'tram' });
  const { vehicles } = await svc.getVehiclesAndShapes();
  assert.equal(vehicles.length, 1);
  assert.equal(vehicles[0].mode, 'tram');
  assert.equal(vehicles[0].line.publicCode, '2');
});

test('Bergen: uten JP-modus beholdes modus fra ET (ikke linjenummer)', async () => {
  const svc = make('bergen', [journey('SKY:Line:2', 'water')], {});
  const { vehicles } = await svc.getVehiclesAndShapes();
  assert.equal(vehicles[0].mode, 'water');
});

test('Oslo: uendret linjenummerkode, ukjent format gir ?', async () => {
  const svc = make('oslo', [journey('RUT:Line:2', 'metro', 'a'), journey('RUT:Line:abc', 'bus', 'b')], {});
  const { vehicles } = await svc.getVehiclesAndShapes();
  const byId = Object.fromEntries(vehicles.map((v) => [v.vehicleId, v.line.publicCode]));
  assert.deepEqual(byId, { a: '2', b: '?' });
});

test('Bergen: ikke-numerisk linjekode brukes som den er', async () => {
  const svc = make('bergen', [journey('SKY:Line:1A', 'bus')], {});
  const { vehicles } = await svc.getVehiclesAndShapes();
  assert.equal(vehicles[0].line.publicCode, '1A');
});

test('instanser har egen cache per region', async () => {
  const a = make('oslo', [journey('RUT:Line:5', 'metro')], {});
  const b = make('bergen', [journey('SKY:Line:2', 'bus', 'b1')], {});
  const [ra, rb] = await Promise.all([a.getVehiclesAndShapes(), b.getVehiclesAndShapes()]);
  assert.equal(ra.vehicles[0].vehicleId, 'v1');
  assert.equal(rb.vehicles[0].vehicleId, 'b1');
});

test('shape-service: JP-togruter fra Oslo S bare når region.jpRailFallback', async () => {
  for (const [id, expected] of [['oslo', 1], ['bergen', 0]]) {
    let jpCalls = 0;
    const svc = createShapeService({
      region: getRegion(id),
      etCache: fakeCache([]),
      deps: {
        ...deps(),
        fetchJpRoutes: async () => { jpCalls++; return [{ mode: 'rail', line: 'R', from: 'a', to: 'b', points: [] }]; },
      },
    });
    const shapes = await svc.refresh();
    assert.equal(jpCalls, expected, id);
    assert.equal(shapes.length, expected, id);
    assert.equal(svc.getCachedShapes(), shapes);
  }
});

test('shape-service Bergen: rutekart bruker SKY-linjekode og modus fra ET/JP', async () => {
  const svc = createShapeService({
    region: getRegion('bergen'),
    etCache: fakeCache([journey('SKY:Line:2', 'bus')]),
    deps: { ...deps({ 'SKY:Line:2': 'tram' }), fetchJpRoutes: async () => { throw new Error('skal ikke kalles'); } },
  });
  const shapes = await svc.refresh();
  assert.equal(shapes.length, 1);
  assert.equal(shapes[0].mode, 'tram');
  assert.equal(shapes[0].line, '2');
});

const SIRI = (lineRef, vehicleMode) => `<EstimatedVehicleJourney><LineRef>${lineRef}</LineRef>
${vehicleMode ? `<VehicleMode>${vehicleMode}</VehicleMode>` : ''}<VehicleRef>X1</VehicleRef>
<EstimatedCalls><EstimatedCall><StopPointRef>Q:2</StopPointRef><StopPointName>To</StopPointName>
<ExpectedArrivalTime>2026-11-05T10:00:00+01:00</ExpectedArrivalTime><ExpectedDepartureTime>2026-11-05T10:01:00+01:00</ExpectedDepartureTime></EstimatedCall></EstimatedCalls>
</EstimatedVehicleJourney>`;

test('parser: modus fra VehicleMode når useVehicleMode, aldri fra linjenummer for ikke-Ruter', () => {
  const p = createEtStreamParser({ useVehicleMode: true });
  p.push(SIRI('SKY:Line:2', 'tram') + SIRI('SKY:Line:3', 'ferry') + SIRI('SKY:Line:4', null));
  assert.deepEqual(p.end().map((j) => j.mode), ['tram', 'water']);
});

test('parser: Oslo (uten useVehicleMode) hopper over ikke-Ruter-turer som før', () => {
  const p = createEtStreamParser();
  p.push(SIRI('SKY:Line:2', 'tram') + SIRI('RUT:Line:5', 'bus'));
  assert.deepEqual(p.end().map((j) => j.mode), ['metro']);
});
