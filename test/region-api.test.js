import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { REGIONS } from '../shared/regions.js';
import { parseRegionParam, createRegionRegistry, defaultRegionServices } from '../server/region-services.js';
import { registerLiveRoutes } from '../server/live-routes.js';
import { createRegionRuntime } from '../server/region-runtime.js';

const oslo = REGIONS.oslo;
const bergen = REGIONS.bergen;

const gpsVehicle = (id, lat, lon, code) => ({
  vehicleId: id,
  mode: 'bus',
  location: { latitude: lat, longitude: lon },
  line: { publicCode: code, lineRef: null },
  destinationName: 'Sentrum',
});

// Stabil identitet per region, som vehicles-cache.js
const GPS = {
  oslo: Object.freeze({ data: { vehicles: [gpsVehicle('RUT:1', 59.91, 10.75, '31')] } }),
  bergen: Object.freeze({ data: { vehicles: [gpsVehicle('SKY:7', 60.39, 5.32, '2')] } }),
};
const EMPTY_GPS = Object.freeze({ data: { vehicles: [] } });

const fakeEtVehicles = (vehicles = []) => {
  const result = Object.freeze({ vehicles, shapes: [] });
  return { getVehiclesAndShapes: async () => result };
};

/** Tjenester uten Entur: ET-kjøretøy gis direkte, ingen trasé. */
function stubServices(etByRegion = {}) {
  return (region) => ({
    etCache: { getJourneys: async () => [], getVersion: () => 0, drop() {}, start() {}, refreshNow: async () => {} },
    etVehicles: fakeEtVehicles(etByRegion[region.id] ?? []),
    shapes: { getCachedShapes: () => [], refresh: async () => [] },
    lineGeometry: { getShapes: () => [], refresh: async () => ({ failed: 0 }) },
  });
}

function makeRegistry({ regions, createServices = stubServices(), runtime } = {}) {
  return createRegionRegistry({
    regions,
    runtime: runtime ?? createRegionRuntime({ regions }),
    getGps: async (id) => GPS[id] ?? EMPTY_GPS,
    createRail: () => async (v) => v,
    railNetwork: { getShapes: () => [], refresh: async () => ({ failed: 0 }) },
    staticShapesFor: () => [],
    createServices,
  });
}

async function withApp(registry, fn) {
  const app = express();
  registerLiveRoutes(app, { registry });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test('parseRegionParam: mangler → Oslo, ukjent/skjult/søppel → null', () => {
  const visible = [oslo];
  assert.equal(parseRegionParam({}, visible), oslo);
  assert.equal(parseRegionParam({ region: '' }, visible), oslo);
  assert.equal(parseRegionParam({ region: 'oslo' }, visible), oslo);
  assert.equal(parseRegionParam({ region: 'bergen' }, visible), null, 'public: false uten forhåndsvisning');
  assert.equal(parseRegionParam({ region: 'bergen' }, [oslo, bergen]), bergen);
  for (const bad of ['__proto__', 'constructor', 'toString', 'xyz', 'Oslo', ['oslo', 'bergen'], { a: 1 }]) {
    assert.equal(parseRegionParam({ region: bad }, [oslo, bergen]), null, String(bad));
  }
});

test('API: ?region=__proto__ og skjult Bergen gir 400 på alle live-endepunkter', async () => {
  const registry = makeRegistry({ regions: [oslo] });
  await withApp(registry, async (base) => {
    for (const path of ['/api/vehicles-live', '/api/route-shapes-all', '/api/initial-data', '/api/route-shapes']) {
      for (const q of ['__proto__', 'bergen', 'xyz']) {
        const res = await fetch(`${base}${path}?region=${q}`);
        assert.equal(res.status, 400, `${path}?region=${q}`);
        assert.deepEqual(await res.json(), { error: 'ukjent region' });
      }
    }
  });
});

test('API: uten region gir samme body og ETag som ?region=oslo', async () => {
  const registry = makeRegistry({ regions: [oslo, bergen] });
  await withApp(registry, async (base) => {
    for (const path of ['/api/vehicles-live', '/api/route-shapes-all', '/api/initial-data']) {
      const a = await fetch(`${base}${path}`);
      const b = await fetch(`${base}${path}?region=oslo`);
      assert.equal(a.status, 200, path);
      assert.equal(a.headers.get('etag'), b.headers.get('etag'), path);
      assert.equal(await a.text(), await b.text(), path);
    }
    const live = await (await fetch(`${base}/api/vehicles-live`)).json();
    assert.deepEqual(live.vehicles.map((v) => v.vehicleId), ['RUT:1']);
  });
});

test('API: Bergen har egne kjøretøy, eget ETag og egen shapesVersion', async () => {
  const etByRegion = {
    oslo: [{ vehicleId: 'RUT:ET:1', mode: 'tram', location: { latitude: 59.92, longitude: 10.76 }, line: { publicCode: '12' } }],
    bergen: [{ vehicleId: 'SKY:ET:1', mode: 'tram', location: { latitude: 60.38, longitude: 5.33 }, line: { publicCode: '1' } }],
  };
  const registry = makeRegistry({ regions: [oslo, bergen], createServices: stubServices(etByRegion) });
  // Ulike rutekart per region gir ulike versjoner
  registry.get('bergen').shapes.getCachedShapes = () => [{ mode: 'tram', line: '1', from: 'Byparken', to: 'Flesland', points: [[60.39, 5.32], [60.29, 5.22]] }];
  await withApp(registry, async (base) => {
    const o = await fetch(`${base}/api/vehicles-live`);
    const b = await fetch(`${base}/api/vehicles-live?region=bergen`);
    assert.notEqual(o.headers.get('etag'), b.headers.get('etag'));
    const ob = await o.json();
    const bb = await b.json();
    assert.deepEqual(bb.vehicles.map((v) => v.vehicleId).sort(), ['SKY:7', 'SKY:ET:1']);
    assert.deepEqual(ob.vehicles.map((v) => v.vehicleId).sort(), ['RUT:1', 'RUT:ET:1']);
    assert.notEqual(ob.shapesVersion, bb.shapesVersion);
    const shapes = await (await fetch(`${base}/api/route-shapes-all?region=bergen&v=${bb.shapesVersion}`)).json();
    assert.deepEqual(shapes.map((s) => s.line), ['1']);
  });
});

test('API: besøk merker regionen som aktiv', async () => {
  let t = 0;
  const regions = [oslo, bergen];
  const runtime = createRegionRuntime({ regions, now: () => t });
  const registry = makeRegistry({ regions, runtime });
  t = 2 * 3_600_000;
  assert.equal(runtime.stateOf('bergen'), 'unloaded');
  await withApp(registry, async (base) => {
    await fetch(`${base}/api/vehicles-live?region=bergen`);
    assert.equal(runtime.stateOf('bergen'), 'active');
  });
});

test('API: avlastet Bergen svarer med GPS innen 200 ms når ET-hentingen henger', async () => {
  const regions = [oslo, bergen];
  let t = 0;
  const runtime = createRegionRuntime({ regions, now: () => t });
  let etCalls = 0;
  const hang = () => { etCalls++; return new Promise(() => {}); };
  const gtfs = new Map([['NSR:Quay:1', [60.39, 5.32]]]);
  const deps = {
    ensureGtfsStopsLoaded: async () => {},
    getGtfsQuayCache: () => gtfs,
    ensureLineModes: async () => {},
    getLineMode: () => null,
    fetchJpRoutes: async () => [],
  };
  const registry = makeRegistry({
    regions,
    runtime,
    createServices: (region, ctx) => defaultRegionServices(region, { ...ctx, etFetchFn: hang, deps, lines: [] }),
  });
  t = 2 * 3_600_000; // over én time uten besøk
  runtime.tick();
  assert.equal(runtime.stateOf('bergen'), 'unloaded');
  await withApp(registry, async (base) => {
    const t0 = performance.now();
    const res = await fetch(`${base}/api/vehicles-live?region=bergen`);
    const ms = performance.now() - t0;
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.vehicles.map((v) => v.vehicleId), ['SKY:7']);
    assert.ok(ms < 200, `${ms.toFixed(0)} ms`);
    assert.equal(etCalls, 1, 'ET-henting startet i bakgrunnen');
  });
});

test('runtime.onUnload slipper ET-turene for regionen', () => {
  let t = 0;
  const regions = [oslo, bergen];
  const runtime = createRegionRuntime({ regions, now: () => t });
  const dropped = [];
  const registry = makeRegistry({
    regions,
    runtime,
    createServices: (region) => ({ ...stubServices()(region), etCache: { drop: () => dropped.push(region.id) } }),
  });
  registry.watchUnload();
  t = 2 * 3_600_000;
  runtime.tick();
  assert.deepEqual(dropped, ['bergen']);
});

test('defaultRegionServices: Bergen-ET beholder ukjent modus, Oslo venter på første henting', () => {
  const runtime = createRegionRuntime({ regions: [oslo, bergen] });
  const o = defaultRegionServices(oslo, { runtime, lines: [] });
  const b = defaultRegionServices(bergen, { runtime, lines: [] });
  assert.deepEqual(o.etCacheOptions.parserOpts, {});
  assert.equal(o.etCacheOptions.waitForFirst, true);
  assert.deepEqual(b.etCacheOptions.parserOpts, { keepUnknownMode: true, useVehicleMode: true });
  assert.equal(b.etCacheOptions.waitForFirst, false);
  assert.equal(b.etCacheOptions.datasetId, 'SKY');
  assert.equal(b.etCacheOptions.maxSize, 10000, 'SKY har ~6800 turer');
  assert.equal(o.etCacheOptions.maxSize, 5000);
  assert.equal(o.etCacheOptions.runExclusive, runtime.runExclusive);
});

test('avlasting slipper forrige ET-resultat og ferdige live-svar', async () => {
  let t = 0;
  const regions = [oslo, bergen];
  const runtime = createRegionRuntime({ regions, now: () => t });
  const etResult = Object.freeze({ vehicles: [{ vehicleId: 'SKY:ET:1', mode: 'tram', location: { latitude: 60.38, longitude: 5.33 }, line: { publicCode: '1' } }], shapes: [] });
  let hang = false;
  const etDropped = [];
  const registry = createRegionRegistry({
    regions,
    runtime,
    getGps: async (id) => GPS[id] ?? EMPTY_GPS,
    createRail: () => async (v) => v,
    railNetwork: { getShapes: () => [], refresh: async () => ({ failed: 0 }) },
    staticShapesFor: () => [],
    etWaitMs: 20,
    createServices: (region) => ({
      ...stubServices()(region),
      etVehicles: {
        getVehiclesAndShapes: () => (hang ? new Promise(() => {}) : Promise.resolve(etResult)),
        drop: () => etDropped.push(region.id),
      },
    }),
  });
  registry.watchUnload();
  const live = registry.get('bergen').live;
  const before = await live.getLiveEntries();
  hang = true;
  const keepAlive = setTimeout(() => {}, 5000); // ventetimeren i registeret er unref
  t = 2 * 3_600_000;
  runtime.tick();
  assert.deepEqual(etDropped, ['bergen']);
  const after = await live.getLiveEntries();
  assert.notEqual(after.vehiclesEntry, before.vehiclesEntry, 'ny entry etter avlasting');
  const { vehiclesData, etResult: et } = await live.getLiveSources();
  assert.deepEqual(et.vehicles, [], 'forrige ET-resultat er sluppet');
  assert.ok(vehiclesData);
  clearTimeout(keepAlive);
});
