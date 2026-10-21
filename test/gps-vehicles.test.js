import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGpsVehicles } from '../shared/gps-vehicles.js';

const v = (id, extra = {}) => ({ vehicleId: id, lastUpdated: '2026-10-21T07:40:00Z', line: { publicCode: '20' }, destinationName: 'Skøyen', ...extra });

test('linjenummer fra lineRef når publicCode mangler', () => {
  const [out] = normalizeGpsVehicles([v('DS1', { line: { publicCode: null, lineRef: 'GOA:Line:50B' } })]);
  assert.equal(out.line.publicCode, '50B');
});

test('beholder publicCode når den finnes', () => {
  const [out] = normalizeGpsVehicles([v('A', { line: { publicCode: '20', lineRef: 'RUT:Line:20' } })]);
  assert.equal(out.line.publicCode, '20');
});

test('ett kjøretøy per vehicleId: foretrekker en med destinasjon', () => {
  const out = normalizeGpsVehicles([v('DS1', { destinationName: null }), v('DS1', { destinationName: 'Kristiansand' })]);
  assert.equal(out.length, 1);
  assert.equal(out[0].destinationName, 'Kristiansand');
});

test('ett kjøretøy per vehicleId: ellers sist oppdatert', () => {
  const out = normalizeGpsVehicles([
    v('X', { lastUpdated: '2026-10-21T07:40:00Z', destinationName: 'A' }),
    v('X', { lastUpdated: '2026-10-21T07:41:00Z', destinationName: 'B' }),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].destinationName, 'B');
});

test('tåler tom og ugyldig input', () => {
  assert.deepEqual(normalizeGpsVehicles(null), []);
  assert.equal(normalizeGpsVehicles([v('A'), null, v('B')]).length, 2);
});
