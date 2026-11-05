import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withoutStraightRail, MIN_RAIL_POINTS } from '../server/static-shapes.js';

const pts = (n) => Array.from({ length: n }, (_, i) => [59.9 + i * 0.001, 10.7]);

test('rette togstreker (få punkter) tas bort, traseer og tette ruter beholdes', () => {
  const straight = { mode: 'flytog', line: 'FLY2', points: pts(2) };
  const dense = { mode: 'rail', line: 'L1', points: pts(MIN_RAIL_POINTS) };
  const trace = { mode: 'rail', line: 'R10', points: pts(3), pointsAreTrace: true };
  assert.deepEqual(withoutStraightRail([straight, dense, trace]), [dense, trace]);
  assert.deepEqual(withoutStraightRail(null), []);
});
