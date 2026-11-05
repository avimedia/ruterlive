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

// Trimmet struktur fra ekte SKY-ET: LineRef + VehicleRef, ingen VehicleMode
const nowIso = (ms) => new Date(NOW + ms).toISOString();
const SKY_XML = (code) => `<EstimatedVehicleJourney><LineRef>SKY:Line:${code}</LineRef><VehicleRef>SKY:V:${code}</VehicleRef>
<RecordedCalls><RecordedCall><StopPointRef>NSR:Quay:1</StopPointRef><StopPointName>Ett</StopPointName><ActualDepartureTime>${nowIso(-60000)}</ActualDepartureTime></RecordedCall></RecordedCalls>
<EstimatedCalls><EstimatedCall><StopPointRef>NSR:Quay:2</StopPointRef><StopPointName>To</StopPointName><ExpectedArrivalTime>${nowIso(60000)}</ExpectedArrivalTime><ExpectedDepartureTime>${nowIso(70000)}</ExpectedDepartureTime></EstimatedCall>
<EstimatedCall><StopPointRef>NSR:Quay:3</StopPointRef><StopPointName>Tre</StopPointName><ExpectedArrivalTime>${nowIso(160000)}</ExpectedArrivalTime><ExpectedDepartureTime>${nowIso(170000)}</ExpectedDepartureTime></EstimatedCall></EstimatedCalls>
</EstimatedVehicleJourney>`;

async function skyVehicles(modes, codes = ['2']) {
  const p = createEtStreamParser({ keepUnknownMode: true, useVehicleMode: true });
  p.push(codes.map(SKY_XML).join(''));
  const parsed = p.end();
  assert.equal(parsed.length, codes.length, 'parseren beholder turer uten modus');
  assert.ok(parsed.every((j) => j.mode === null));
  return (await make('bergen', parsed, modes).getVehiclesAndShapes()).vehicles;
}

test('SKY uten VehicleMode, JP-modus bus: blir buss', async () => {
  const v = await skyVehicles({ 'SKY:Line:2': 'bus' });
  assert.equal(v.length, 1);
  assert.equal(v[0].mode, 'bus');
});

test('SKY uten VehicleMode og uten JP-modus: droppes', async () => {
  assert.equal((await skyVehicles({})).length, 0);
});

test('SKY:Line:2 med JP-modus tram blir tram', async () => {
  const v = await skyVehicles({ 'SKY:Line:2': 'tram', 'SKY:Line:9': 'bus' }, ['2', '9']);
  assert.deepEqual(v.map((x) => x.mode).sort(), ['bus', 'tram']);
});

test('shape-service dropper turer uten modus etter JP', async () => {
  const p = createEtStreamParser({ keepUnknownMode: true });
  p.push(SKY_XML('2'));
  const svc = createShapeService({ region: getRegion('bergen'), etCache: fakeCache(p.end()), deps: deps({}) });
  assert.deepEqual(await svc.refresh(), []);
});

test('parser: Oslo (uten keepUnknownMode) dropper SKY-turer uten modus', () => {
  const p = createEtStreamParser();
  p.push(SKY_XML('2'));
  assert.equal(p.end().length, 0);
});

test('drop() slipper 15 s-cachen, neste kall beregner på nytt', async () => {
  let journeys = [journey('SKY:Line:2', 'bus')];
  const svc = createEtVehiclesService({
    region: getRegion('bergen'),
    etCache: { getJourneys: async () => journeys, getVersion: () => 1 },
    deps: deps({ 'SKY:Line:2': 'tram' }),
  });
  assert.equal((await svc.getVehiclesAndShapes()).vehicles.length, 1);
  journeys = [];
  svc.drop();
  assert.equal((await svc.getVehiclesAndShapes()).vehicles.length, 0);
});

test('shape-service: hver time slås nye rutekart sammen med forrige; full ombygging etter 24 t', async () => {
  let t = 1_000_000;
  let journeys = [journey('SKY:Line:2', 'bus', 'a')];
  let jpCalls = 0;
  const svc = createShapeService({
    region: getRegion('oslo'),
    etCache: { getJourneys: async () => journeys },
    deps: {
      ...deps({ 'SKY:Line:2': 'bus', 'SKY:Line:3': 'bus' }),
      now: () => t,
      fetchJpRoutes: async () => { jpCalls++; return [{ mode: 'rail', line: 'R', from: 'a', to: 'b', points: [[0, 0], [1, 1]] }]; },
    },
  });
  const lines = (shapes) => shapes.filter((x) => x.mode !== 'rail').map((x) => x.line).sort();
  assert.deepEqual(lines(await svc.refresh()), ['2']);
  journeys = [journey('SKY:Line:3', 'bus', 'b')];
  t += 10 * 60_000;
  assert.deepEqual(lines(await svc.refresh()), ['2'], 'innen TTL: uendret');
  t += 50 * 60_000;
  const second = await svc.refresh();
  assert.deepEqual(lines(second), ['2', '3'], 'rutekart fra første oppdatering overlever');
  t += 60 * 60_000;
  assert.equal(await svc.refresh(), second, 'samme sett: samme array (ingen ny shapesVersion)');
  t += 24 * 60 * 60_000;
  assert.deepEqual(lines(await svc.refresh()), ['3'], 'etter 24 t: bygget helt på nytt');
  assert.equal(jpCalls, 2, 'JP-togruter bare ved start og etter 24 t');
});

test('tom ET caches ikke: turer som kommer sekunder senere vises med en gang', async () => {
  let journeys = [];
  const svc = createEtVehiclesService({
    region: getRegion('bergen'),
    etCache: { getJourneys: async () => journeys, getVersion: () => (journeys.length ? 1 : 0) },
    deps: deps({ 'SKY:Line:2': 'tram' }),
  });
  assert.equal((await svc.getVehiclesAndShapes()).vehicles.length, 0);
  journeys = [journey('SKY:Line:2', 'bus')];
  assert.equal((await svc.getVehiclesAndShapes()).vehicles.length, 1);
});

test('drop() under pågående beregning: resultatet lagres ikke', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  let calls = 0;
  const svc = createEtVehiclesService({
    region: getRegion('bergen'),
    etCache: { getJourneys: async () => { calls++; if (calls === 1) await gate; return [journey('SKY:Line:2', 'bus')]; }, getVersion: () => 1 },
    deps: deps({ 'SKY:Line:2': 'tram' }),
  });
  const first = svc.getVehiclesAndShapes();
  await new Promise((r) => setImmediate(r));
  svc.drop();
  release();
  await first;
  await svc.getVehiclesAndShapes();
  assert.equal(calls, 2, 'ny beregning etter drop(), ikke den gamle fra cachen');
});
