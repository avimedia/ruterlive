import { test } from 'node:test';
import assert from 'node:assert/strict';
import { journeyVehicleId, selectJourneysForVehicles } from '../shared/et-journeys.js';

const NOW = Date.parse('2026-10-20T10:15:00+02:00');
const t = (hhmm) => Date.parse(`2026-10-20T${hhmm}:00+02:00`);

const ec = (quayId, hhmm) => ({ quayId, name: quayId, arrTime: t(hhmm), depTime: t(hhmm) });
const rc = (quayId, hhmm) => ({ quayId, name: quayId, time: t(hhmm) });

const fullfort = { vehicleId: 'V1', recordedCalls: [rc('A', '09:00'), rc('B', '09:20')], estimatedCalls: [] };
const igang = { vehicleId: 'V1', recordedCalls: [rc('B', '10:00')], estimatedCalls: [ec('C', '10:30')] };
const nesteTur = { vehicleId: 'V1', recordedCalls: [], estimatedCalls: [ec('C', '10:45'), ec('D', '11:00')] };

test('samme VehicleRef: fullført + i gang + ikke startet gir bare turen i gang', () => {
  const res = selectJourneysForVehicles([fullfort, nesteTur, igang], NOW);
  assert.deepEqual(res, [igang]);
});

test('samme VehicleRef: bare ikke-startede turer gir den tidligste', () => {
  const kl10 = { vehicleId: 'V2', recordedCalls: [], estimatedCalls: [ec('A', '10:00'), ec('B', '10:10')] };
  const kl1030 = { vehicleId: 'V2', recordedCalls: [], estimatedCalls: [ec('A', '10:30'), ec('B', '10:40')] };
  const sen = Date.parse('2026-10-20T09:00:00+02:00');
  assert.deepEqual(selectJourneysForVehicles([kl1030, kl10], sen), [kl10]);
});

test('fullført tur alene fjernes', () => {
  assert.deepEqual(selectJourneysForVehicles([fullfort], NOW), []);
});

test('flere turer i gang: den med seneste siste RecordedCall vinner', () => {
  const eldre = { vehicleId: 'V3', recordedCalls: [rc('A', '10:00')], estimatedCalls: [ec('B', '10:20')] };
  const nyere = { vehicleId: 'V3', recordedCalls: [rc('A', '10:05')], estimatedCalls: [ec('B', '10:25')] };
  assert.deepEqual(selectJourneysForVehicles([eldre, nyere], NOW), [nyere]);
});

test('id uten VehicleRef: fra DatedVehicleJourneyRef', () => {
  assert.equal(
    journeyVehicleId({ vehicleRef: '', datedVehicleJourneyRef: 'RUT:123', lineRef: 'RUT:Line:20', firstQuayId: 'A', firstTime: 1 }),
    'et-RUT:123',
  );
  assert.equal(journeyVehicleId({ vehicleRef: 'RUT:Veh:9', datedVehicleJourneyRef: 'x' }), 'RUT:Veh:9');
});

test('id uten begge er stabil og uavhengig av rekkefølge', () => {
  const args = { vehicleRef: '', datedVehicleJourneyRef: '', lineRef: 'RUT:Line:20', firstQuayId: 'NSR:Quay:1', firstTime: 1000 };
  assert.equal(journeyVehicleId(args), journeyVehicleId({ ...args }));
  assert.equal(journeyVehicleId(args), 'et-RUT:Line:20-NSR:Quay:1-1000');
});

test('ulike VehicleRef påvirker ikke hverandre', () => {
  const annen = { vehicleId: 'V9', recordedCalls: [], estimatedCalls: [ec('A', '10:00'), ec('B', '10:10')] };
  const res = selectJourneysForVehicles([fullfort, igang, nesteTur, annen], NOW);
  assert.equal(res.length, 2);
  assert.ok(res.includes(igang) && res.includes(annen));
});
