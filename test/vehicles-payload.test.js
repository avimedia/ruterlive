import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildVehiclesPayload } from '../server/vehicles-payload.js';
import { decodeVehiclePath, positionAt } from '../shared/vehicle-path.js';

const NOW = 1_792_574_800_750;
const T0 = 1_792_574_800;

const et = {
  vehicleId: 'ET1',
  mode: 'bus',
  location: { latitude: 59.902956292991306, longitude: 10.798937196695652 },
  line: { publicCode: '70' },
  destinationName: 'Nationaltheatret',
  bearing: null,
  from: 'Skullerud',
  to: 'Eirik Raudes vei',
  nextStop: null,
  via: 'Manglerudveien',
  path: [
    [59.90387, 10.80308, (T0 - 10) * 1000, (T0 - 10) * 1000],
    [59.90251, 10.7969, (T0 + 105) * 1000, (T0 + 120) * 1000],
  ],
};
const gps = {
  vehicleId: '3620803578',
  lastUpdated: '2026-10-21T09:28:58Z',
  location: { latitude: 60.1647567283362, longitude: 10.2577733527869 },
  line: { publicCode: '222', lineRef: 'BRA:Line:4_6222' },
  mode: 'BUS',
  bearing: 353.7900085449219,
  destinationName: 'Oppenåsen',
};

test('buildVehiclesPayload: t0, shapesVersion og kompakte kjøretøy', () => {
  const p = buildVehiclesPayload([et, gps], { shapesVersion: 'abc', nowMs: NOW });
  assert.equal(p.t0, T0);
  assert.equal(p.shapesVersion, 'abc');
  assert.deepEqual(p.vehicles[0], {
    vehicleId: 'ET1',
    mode: 'bus',
    location: { latitude: 59.90296, longitude: 10.79894 },
    line: { publicCode: '70' },
    destinationName: 'Nationaltheatret',
    from: 'Skullerud',
    to: 'Eirik Raudes vei',
    via: 'Manglerudveien',
    path: [[59.90387, 10.80308, -10], [59.90251, 10.7969, 105, 120]],
  });
  assert.deepEqual(p.vehicles[1], {
    vehicleId: '3620803578',
    mode: 'BUS',
    location: { latitude: 60.16476, longitude: 10.25777 },
    line: { publicCode: '222' },
    destinationName: 'Oppenåsen',
    bearing: 354,
  });
});

test('buildVehiclesPayload: path kan dekodes og gir samme posisjon', () => {
  const p = buildVehiclesPayload([et], { shapesVersion: 'x', nowMs: NOW });
  assert.deepEqual(decodeVehiclePath(p.vehicles[0].path, p.t0), et.path);
  const now = (T0 + 50) * 1000;
  assert.deepEqual(positionAt(p.vehicles[0].path, now, p.t0), positionAt(et.path, now));
});

test('buildVehiclesPayload: muterer ikke input og tåler rare kjøretøy', () => {
  const copy = structuredClone(et);
  const p = buildVehiclesPayload([et, null, { vehicleId: 'x' }], { shapesVersion: null, nowMs: NOW });
  assert.deepEqual(et, copy);
  assert.deepEqual(p.vehicles, [buildVehiclesPayload([et], { nowMs: NOW }).vehicles[0], { vehicleId: 'x' }]);
});
