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
