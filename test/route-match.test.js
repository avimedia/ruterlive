import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchRouteForVehicle } from '../shared/route-match.js';

const shapes = [
  { mode: 'flytog', line: 'FLY1', from: 'Oslo S', to: 'Oslo lufthavn', via: 'Lillestrøm' },
  { mode: 'flytog', line: 'FLY1', from: 'Oslo lufthavn', to: 'Drammen stasjon' },
  { mode: 'flybuss', line: 'FB5', from: 'Oslo S', to: 'Oslo lufthavn' },
  { mode: 'rail', line: 'L1', from: 'Oslo S', to: 'Lillestrøm' },
];

test('GPS-modus RAIL matcher flytog-rute mot destinasjon', () => {
  const v = { line: { publicCode: 'FLY1' }, mode: 'RAIL', destinationName: 'Drammen' };
  assert.deepEqual(matchRouteForVehicle(v, shapes), { from: 'Oslo lufthavn', to: 'Drammen stasjon', via: null });
});

test('GPS-modus BUS matcher flybuss', () => {
  const v = { line: { publicCode: 'FB5' }, mode: 'BUS', destinationName: 'Oslo lufthavn' };
  assert.equal(matchRouteForVehicle(v, shapes)?.from, 'Oslo S');
});

test('ingen rute mot destinasjonen gir null (ikke feil retning)', () => {
  const v = { line: { publicCode: 'L1' }, mode: 'RAIL', destinationName: 'Spikkestad' };
  assert.equal(matchRouteForVehicle(v, shapes), null);
});

test('annen modusfamilie matcher ikke', () => {
  const v = { line: { publicCode: 'L1' }, mode: 'BUS', destinationName: 'Lillestrøm' };
  assert.equal(matchRouteForVehicle(v, shapes), null);
});
