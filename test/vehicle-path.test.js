import { test } from 'node:test';
import assert from 'node:assert/strict';
import { positionAt } from '../shared/vehicle-path.js';

// [lat, lon, arrMs, depMs]
const path = [
  [59.0, 10.0, 0, 1000],
  [59.1, 10.2, 2000, 3000],
  [59.3, 10.4, 5000, 5000],
];

const near = (a, b) => {
  assert.ok(Array.isArray(a), `forventet posisjon, fikk ${a}`);
  assert.ok(Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9, `${a} != ${b}`);
};

test('før første avgang: står på første punkt', () => {
  near(positionAt(path, -5000), [59.0, 10.0]);
  near(positionAt(path, 500), [59.0, 10.0]);
});

test('lineært mellom avgang og neste ankomst', () => {
  near(positionAt(path, 1500), [59.05, 10.1]);
  near(positionAt(path, 1000), [59.0, 10.0]);
  near(positionAt(path, 2000), [59.1, 10.2]);
});

test('venter ved holdeplass mellom ankomst og avgang', () => {
  near(positionAt(path, 2000), [59.1, 10.2]);
  near(positionAt(path, 2500), [59.1, 10.2]);
  near(positionAt(path, 3000), [59.1, 10.2]);
});

test('krysser holdeplass uten opphold', () => {
  const p = [
    [59.0, 10.0, 0, 0],
    [59.1, 10.0, 1000, 1000],
    [59.2, 10.0, 2000, 2000],
  ];
  near(positionAt(p, 999), [59.0999, 10.0]);
  near(positionAt(p, 1000), [59.1, 10.0]);
  near(positionAt(p, 1001), [59.1001, 10.0]);
});

test('etter siste ankomst: står på siste punkt', () => {
  near(positionAt(path, 5000), [59.3, 10.4]);
  near(positionAt(path, 99999), [59.3, 10.4]);
});

test('ett punkt: alltid der', () => {
  near(positionAt([[59.5, 10.5, 100, 200]], 0), [59.5, 10.5]);
  near(positionAt([[59.5, 10.5, 100, 200]], 1e12), [59.5, 10.5]);
});

test('ugyldig input gir null', () => {
  assert.equal(positionAt(null, 0), null);
  assert.equal(positionAt(undefined, 0), null);
  assert.equal(positionAt([], 0), null);
  assert.equal(positionAt('abc', 0), null);
  assert.equal(positionAt(path, NaN), null);
  assert.equal(positionAt([[59, 'x', 0, 0]], 0), null);
  assert.equal(positionAt([null, [59, 10, 0, 0]], 0), null);
});

test('manglende eller baklengs tider: ingen NaN, ingen hopp bakover', () => {
  const p = [
    [59.0, 10.0, null, 1000],
    [59.1, 10.0, 900, 900], // ankomst før forrige avgang
  ];
  const pos = positionAt(p, 950);
  assert.ok(pos && Number.isFinite(pos[0]) && Number.isFinite(pos[1]));
  near(positionAt(p, 2000), [59.1, 10.0]);
});

import { buildVehiclePath } from '../shared/vehicle-path.js';

const coords = new Map([
  ['A', [59.123456789, 10.1]],
  ['B', [59.2, 10.2]],
  ['C', [59.3, 10.3]],
  ['D', [59.4, 10.4]],
  ['E', [59.5, 10.5]],
]);
const get = (q) => coords.get(q);

test('buildVehiclePath: siste passerte + tre neste, avrundet', () => {
  const rec = [{ quayId: 'X', time: 1 }, { quayId: 'A', time: 1000 }];
  const est = ['B', 'C', 'D', 'E'].map((q, i) => ({ quayId: q, arrTime: 2000 + i * 1000, depTime: 2500 + i * 1000 }));
  const p = buildVehiclePath(rec, est, get);
  assert.deepEqual(p, [
    [59.12346, 10.1, 1000, 1000],
    [59.2, 10.2, 2000, 2500],
    [59.3, 10.3, 3000, 3500],
    [59.4, 10.4, 4000, 4500],
  ]);
});

test('buildVehiclePath: uten passerte kall starter på første estimerte', () => {
  const est = [{ quayId: 'A', arrTime: 0, depTime: 100 }, { quayId: 'B', arrTime: 200 }];
  assert.deepEqual(buildVehiclePath([], est, get), [[59.12346, 10.1, 0, 100], [59.2, 10.2, 200, 200]]);
});

test('buildVehiclePath: stopper ved manglende koordinater, null ved < 2 punkter', () => {
  const est = [{ quayId: 'A', arrTime: 0, depTime: 0 }, { quayId: 'B', arrTime: 1, depTime: 1 }, { quayId: 'Q', arrTime: 2, depTime: 2 }, { quayId: 'C', arrTime: 3, depTime: 3 }];
  assert.equal(buildVehiclePath([], est, get).length, 2);
  assert.equal(buildVehiclePath([{ quayId: 'Q', time: 0 }], est, get), null);
  assert.equal(buildVehiclePath([], [], get), null);
  assert.equal(buildVehiclePath(null, undefined, get), null);
});

test('buildVehiclePath: kutter ved urimelig langt sprang', () => {
  const est = [{ quayId: 'A', arrTime: 0, depTime: 0 }, { quayId: 'B', arrTime: 1, depTime: 1 }, { quayId: 'E', arrTime: 2, depTime: 2 }];
  assert.equal(buildVehiclePath([], est, get, { maxHopKm: 20 }).length, 2);
});
