import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isFlytogLineCode } from '../config.js';
import { getFallbackRailShapes } from '../server/rail-fallback-shapes.js';

test('isFlytogLineCode kjenner igjen FLY1 og FLY2', () => {
  assert.equal(isFlytogLineCode('FLY1'), true);
  assert.equal(isFlytogLineCode('fly2'), true);
});

test('isFlytogLineCode avviser Vy- og SJ-linjer med F-kode', () => {
  for (const code of ['F1', 'F4', 'F6', 'FX', 'FB1', 'R12', '', null, undefined]) {
    assert.equal(isFlytogLineCode(code), false, String(code));
  }
});

test('fallback-jernbane merker Flytoget som flytog', () => {
  const flytog = getFallbackRailShapes().filter((s) => s.mode === 'flytog');
  assert.ok(flytog.length > 0);
  assert.ok(flytog.every((s) => s.line === 'FLY1'));
});
