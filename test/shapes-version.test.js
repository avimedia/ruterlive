import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortShapes, createThrottledSnapshot } from '../server/shapes-version.js';
import { makeJsonEntry } from '../server/json-cache.js';

const a = { mode: 'bus', line: '31', from: 'Tonsenhagen', to: 'Snarøya', points: [[59.9, 10.7]] };
const b = { mode: 'metro', line: '1', from: 'Frognerseteren', to: 'Bergkrystallen', points: [[59.9, 10.6]] };
const c = { mode: 'bus', line: '20', from: 'Galgeberg', to: 'Skøyen', points: [[59.9, 10.8]] };

test('sortShapes: samme sett i annen rekkefølge gir samme ETag', () => {
  const e1 = makeJsonEntry(sortShapes([a, b, c]));
  const e2 = makeJsonEntry(sortShapes([c, a, b]));
  assert.equal(e1.etag, e2.etag);
});

test('sortShapes: muterer ikke input', () => {
  const input = [c, a, b];
  sortShapes(input);
  assert.deepEqual(input, [c, a, b]);
});

test('createThrottledSnapshot: første verdi tas, nye avvises innenfor intervallet', () => {
  let t = 0;
  const snap = createThrottledSnapshot(1000, { now: () => t });
  const v1 = [a];
  const v2 = [b];
  const v3 = [c];
  assert.equal(snap(v1), v1);
  t = 500;
  assert.equal(snap(v2), v1);
  t = 1000;
  assert.equal(snap(v3), v3);
  t = 1500;
  assert.equal(snap(v2), v3);
});

test('createThrottledSnapshot: tom verdi byttes med en gang mot ikke-tom (kald start)', () => {
  let t = 0;
  const snap = createThrottledSnapshot(1000, { now: () => t });
  const empty = [];
  const full = [a];
  assert.equal(snap(empty), empty);
  t = 10;
  assert.equal(snap(full), full);
  t = 20;
  assert.equal(snap(empty), full);
});
