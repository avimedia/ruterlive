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
