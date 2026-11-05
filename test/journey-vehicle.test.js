import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findJourneyVehicle, SERVICE_JOURNEY_RE } from '../server/journey-vehicle.js';
import { normalizeGpsVehicles } from '../shared/gps-vehicles.js';

test('normalizeGpsVehicles samler turene per kjøretøy i journeyIds', () => {
  const out = normalizeGpsVehicles([
    { vehicleId: '533-2026-10-31', destinationName: 'Oslo S', serviceJourney: { id: 'VYG:ServiceJourney:533_1' } },
    { vehicleId: '533-2026-10-31', serviceJourney: { id: 'VYG:ServiceJourney:534_1' } },
    { vehicleId: 'X', line: { publicCode: '25' } },
  ]);
  const t = out.find((v) => v.vehicleId === '533-2026-10-31');
  assert.deepEqual(t.journeyIds, ['VYG:ServiceJourney:533_1', 'VYG:ServiceJourney:534_1']);
  assert.equal(t.serviceJourney, undefined);
  assert.equal(out.find((v) => v.vehicleId === 'X').journeyIds, undefined);
});

test('findJourneyVehicle: GPS først, så ET (VehicleRef gir bussen som kjører nå)', () => {
  const gps = [[{ vehicleId: 'tog1', journeyIds: ['VYG:ServiceJourney:1'] }]];
  const etJourneys = [
    { vehicleId: 'WMAA44', datedVehicleJourneyRef: 'RUT:ServiceJourney:neste' },
    { vehicleId: 'et-RUT:ServiceJourney:b', datedVehicleJourneyRef: 'RUT:ServiceJourney:b' },
  ];
  assert.equal(findJourneyVehicle('VYG:ServiceJourney:1', { gps, etJourneys }), 'tog1');
  assert.equal(findJourneyVehicle('RUT:ServiceJourney:neste', { gps, etJourneys }), 'WMAA44');
  assert.equal(findJourneyVehicle('RUT:ServiceJourney:b', { gps, etJourneys }), 'et-RUT:ServiceJourney:b');
  assert.equal(findJourneyVehicle('RUT:ServiceJourney:ukjent', { gps, etJourneys }), null);
});

test('SERVICE_JOURNEY_RE godtar Entur-id-er og avviser annet', () => {
  assert.ok(SERVICE_JOURNEY_RE.test('RUT:ServiceJourney:5083cafbe0e252646320c24ed434c0ca'));
  assert.ok(SERVICE_JOURNEY_RE.test('VYG:ServiceJourney:1166-MOS_443058-R'));
  assert.ok(!SERVICE_JOURNEY_RE.test('<script>'));
  assert.ok(!SERVICE_JOURNEY_RE.test('RUT:Line:31'));
});

import express from 'express';
import { registerJourneyVehicleRoute } from '../server/journey-vehicle.js';
import { REGIONS } from '../shared/regions.js';
import { parseRegionParam } from '../server/region-services.js';

test('/api/journey-vehicle: regionens GPS og ET, Oslo uten ?region=, ukjent region 400, besøk merkes', async () => {
  const regions = [REGIONS.oslo, REGIONS.bergen];
  const touched = [];
  const et = {
    oslo: [{ vehicleId: 'RUTBUS', datedVehicleJourneyRef: 'RUT:ServiceJourney:a' }],
    bergen: [{ vehicleId: 'SKYBUS', datedVehicleJourneyRef: 'SKY:ServiceJourney:b' }],
  };
  const gps = {
    oslo: { data: { vehicles: [] } },
    bergen: { data: { vehicles: [{ vehicleId: 'SKYGPS', journeyIds: ['SKY:ServiceJourney:g'] }] } },
  };
  const registry = {
    runtime: { touch: (id) => touched.push(id) },
    parseRegionParam: (q) => parseRegionParam(q, regions),
    get: (id) => ({ region: REGIONS[id], etCache: { getJourneys: async () => et[id] } }),
  };
  const app = express();
  registerJourneyVehicleRoute(app, {
    registry,
    getGps: async (id) => gps[id],
    getRail: async () => ({ data: { vehicles: [{ vehicleId: 'tog1', journeyIds: ['VYG:ServiceJourney:1'] }] } }),
  });
  const srv = app.listen(0);
  await new Promise((r) => srv.once('listening', r));
  const base = `http://127.0.0.1:${srv.address().port}/api/journey-vehicle`;
  const get = async (q) => { const r = await fetch(`${base}?${q}`); return { status: r.status, body: await r.json() }; };
  try {
    assert.deepEqual(await get('sj=RUT:ServiceJourney:a'), { status: 200, body: { vehicleId: 'RUTBUS' } });
    assert.equal((await get('sj=SKY:ServiceJourney:b')).status, 404, 'Bergen-tur finnes ikke i Oslo');
    assert.deepEqual(await get('sj=SKY:ServiceJourney:b&region=bergen'), { status: 200, body: { vehicleId: 'SKYBUS' } });
    assert.deepEqual(await get('sj=SKY:ServiceJourney:g&region=bergen'), { status: 200, body: { vehicleId: 'SKYGPS' } });
    assert.deepEqual(await get('sj=VYG:ServiceJourney:1&region=bergen'), { status: 200, body: { vehicleId: 'tog1' } }, 'tog i hele landet');
    assert.equal((await get('sj=RUT:ServiceJourney:a&region=xyz')).status, 400);
    assert.equal((await get('sj=<x>&region=bergen')).status, 400);
    assert.deepEqual([...new Set(touched)], ['oslo', 'bergen']);
  } finally { await new Promise((r) => srv.close(r)); }
});
