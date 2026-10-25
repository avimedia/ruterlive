import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitRouteAt } from '../js/route-split.js';

const line = [[60, 10], [60, 10.1], [60, 10.2]];

test('punkt midt på et segment deler linjen der', () => {
  const { driven, ahead } = splitRouteAt(line, [60.001, 10.05]);
  assert.equal(driven.length, 2);
  assert.deepEqual(driven[0], [60, 10]);
  assert.ok(Math.abs(driven[1][1] - 10.05) < 1e-9);
  assert.ok(Math.abs(driven[1][0] - 60) < 1e-9);
  assert.deepEqual(ahead[0], driven[1]);
  assert.deepEqual(ahead.at(-1), [60, 10.2]);
  assert.equal(ahead.length, 3);
});

test('velger nærmeste segment', () => {
  const { driven, ahead } = splitRouteAt(line, [60, 10.15]);
  assert.equal(driven.length, 3);
  assert.deepEqual(driven[1], [60, 10.1]);
  assert.equal(ahead.length, 2);
});

test('punkt før start gir tom kjørt del (kun startpunkt)', () => {
  const { driven, ahead } = splitRouteAt(line, [60, 9.9]);
  assert.deepEqual(driven, [[60, 10]]);
  assert.equal(ahead.length, 3);
  assert.deepEqual(ahead[0], [60, 10]);
});

test('punkt etter slutt gir hele linjen som kjørt', () => {
  const { driven, ahead } = splitRouteAt(line, [60, 10.5]);
  assert.equal(driven.length, 3);
  assert.deepEqual(ahead, [[60, 10.2]]);
});

test('for få punkter eller ugyldig punkt', () => {
  assert.deepEqual(splitRouteAt([], [60, 10]), { driven: [], ahead: [] });
  assert.deepEqual(splitRouteAt([[60, 10]], [60, 10]), { driven: [[60, 10]], ahead: [] });
  assert.deepEqual(splitRouteAt(line, null), { driven: [], ahead: line });
  assert.deepEqual(splitRouteAt(line, [NaN, 1]), { driven: [], ahead: line });
});

test('korrigerer for lengdegrad ved høy breddegrad', () => {
  // Rute nordover og østover; punktet er nærmest østsegmentet i meter
  const l = [[60, 10], [60.1, 10], [60.1, 10.3]];
  const { driven } = splitRouteAt(l, [60.099, 10.1]);
  assert.equal(driven.length, 3);
});

// --- chooseClosestShape: én rute for valgt kjøretøy ---
import { chooseClosestShape, distanceToRouteM } from '../js/route-split.js';

const trunk = [[59.91, 10.70], [59.91, 10.75]];
const branchNorth = { points: [...trunk, [59.95, 10.75]] }; // felles strekning, så nordover
const branchSouth = { points: [...trunk, [59.88, 10.75]] }; // felles strekning, så sørover
const shortOnly = { points: trunk };

test('distanceToRouteM gir meter til nærmeste segment', () => {
  const d = distanceToRouteM(trunk, [59.911, 10.72]); // ~111 m nord for linjen
  assert.ok(d > 100 && d < 125, `d=${d}`);
  assert.equal(distanceToRouteM([], [59.9, 10.7]), Infinity);
  assert.equal(distanceToRouteM(trunk, null), Infinity);
});

test('velger ruten nærmest kjøretøyet', () => {
  assert.equal(chooseClosestShape([branchNorth, branchSouth], [59.94, 10.751]), 0);
  assert.equal(chooseClosestShape([branchNorth, branchSouth], [59.89, 10.749]), 1);
});

test('lik avstand (felles strekning) gir den lengste ruten', () => {
  assert.equal(chooseClosestShape([shortOnly, branchSouth, branchNorth], [59.9101, 10.72]), 2);
  assert.equal(chooseClosestShape([branchSouth, shortOnly], [59.91, 10.72]), 0);
});

test('uten posisjon velges den lengste; tom liste gir -1', () => {
  assert.equal(chooseClosestShape([shortOnly, branchSouth], null), 1);
  assert.equal(chooseClosestShape([], [59.9, 10.7]), -1);
});

test('godtar { lat, lon }-punkter og hopper over ruter uten punkter', () => {
  const objShape = { points: [{ lat: 59.95, lon: 10.70 }, { lat: 59.95, lon: 10.80 }] };
  assert.equal(chooseClosestShape([{ points: [] }, shortOnly, objShape], [59.949, 10.75]), 2);
});
