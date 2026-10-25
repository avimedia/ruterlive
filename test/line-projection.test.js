import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  prepareLine,
  projectPoint,
  projectPair,
  pointAt,
  projectOnLine,
  pathSegmentAt,
  setLineGeometryData,
  onLinePosition,
  withoutTracedLines,
} from '../js/line-geometry.js';
import { positionAt } from '../shared/vehicle-path.js';

// L-formet trasé: 1,1 km nordover, så 1,1 km østover (ved 59,9° N)
const K = Math.cos((59.9 * Math.PI) / 180);
const dLon = (m) => m / (111320 * K);
const dLat = (m) => m / 111320;
const CORNER = [59.9 + dLat(1100), 10.75];
const END = [CORNER[0], 10.75 + dLon(1100)];
const L_TRACE = [[59.9, 10.75], CORNER, END];
const shape = (extra = {}) => ({ mode: 'tram', line: '17', from: 'Sør', to: 'Øst', points: L_TRACE, pointsAreTrace: true, ...extra });

const near = (a, b, m = 1) => Math.hypot((a[0] - b[0]) * 111320, (a[1] - b[1]) * 111320 * K) <= m;

test('prepareLine: kumulative avstander i meter', () => {
  const P = prepareLine(L_TRACE);
  assert.equal(P.n, 3);
  assert.ok(Math.abs(P.cum[1] - 1100) < 1);
  assert.ok(Math.abs(P.length - 2200) < 2);
  assert.equal(prepareLine([[1, 2]]), null);
});

test('projectPoint: nærmeste punkt, og bare etter minS', () => {
  const P = prepareLine(L_TRACE);
  const p = projectPoint(P, [59.9 + dLat(500), 10.75 + dLon(20)]);
  assert.ok(Math.abs(p.s - 500) < 1);
  assert.ok(Math.abs(p.d - 20) < 1);
  const later = projectPoint(P, [59.9 + dLat(500), 10.75], 1500);
  assert.ok(later.s >= 1500);
});

test('fraction → posisjon langs linjen, rundt hjørnet', () => {
  const a = [59.9 + dLat(600), 10.75]; // 600 m langs
  const b = [CORNER[0], 10.75 + dLon(600)]; // 1700 m langs
  const mid = projectOnLine(shape(), a, b, 0.5); // 1150 m: 50 m øst for hjørnet
  assert.ok(near(mid, [CORNER[0], 10.75 + dLon(50)], 1.5), String(mid));
  assert.ok(near(projectOnLine(shape(), a, b, 0), a));
  assert.ok(near(projectOnLine(shape(), a, b, 1), b));
  // Rett linje ville skåret over hjørnet
  const straight = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  assert.ok(!near(mid, straight, 50));
});

test('projeksjon er monoton når andelen øker', () => {
  const P = prepareLine(L_TRACE);
  const a = [59.9 + dLat(100), 10.75 + dLon(10)];
  const b = [CORNER[0] - dLat(8), 10.75 + dLon(1000)];
  const r = projectPair(P, a, b);
  assert.ok(r && r.sB > r.sA);
  let prev = -1;
  for (let f = 0; f <= 1.0001; f += 0.05) {
    const pos = projectOnLine([shape()], a, b, f);
    const s = projectPoint(P, pos).s;
    assert.ok(s >= prev - 0.01, `f=${f}`);
    prev = s;
  }
});

test('fallback: null når holdeplassen ligger langt fra linjen eller i feil rekkefølge', () => {
  const a = [59.9 + dLat(200), 10.75];
  const far = [59.9 + dLat(600), 10.75 + dLon(400)]; // 400 m fra linjen
  assert.equal(projectOnLine(shape(), a, far, 0.5), null);
  // Motsatt kjøreretning av traseen: ingen monoton projeksjon
  const b = [59.9 + dLat(800), 10.75];
  assert.equal(projectOnLine(shape(), b, a, 0.5), null);
  assert.equal(projectOnLine(shape(), a, a, 0.5), null);
  assert.equal(projectOnLine('tram|17|Finnes|Ikke', a, b, 0.5), null);
  assert.equal(projectOnLine(shape(), null, b, 0.5), null);
});

test('omvei mye lengre enn luftlinjen forkastes (sløyfe)', () => {
  // U-sving: ut 1 km og tilbake, holdeplassene 50 m fra hverandre på hver sin side
  const U = [[59.9, 10.75], [59.9 + dLat(1000), 10.75], [59.9 + dLat(1000), 10.75 + dLon(50)], [59.9, 10.75 + dLon(50)]];
  const s = { mode: 'tram', line: '1', points: U, pointsAreTrace: true };
  assert.equal(projectOnLine(s, [59.9 + dLat(10), 10.75], [59.9 + dLat(10), 10.75 + dLon(50)], 0.5), null);
});

test('pathSegmentAt følger positionAt: kjører, venter og etter siste stopp', () => {
  const path = [[59.9, 10.75, 0, 1000], [59.91, 10.75, 11000, 13000], [59.92, 10.75, 23000, 23000]];
  const seg = pathSegmentAt(path, 6000);
  assert.equal(seg.a, path[0]);
  assert.equal(seg.b, path[1]);
  assert.equal(seg.f, 0.5);
  const lin = positionAt(path, 6000);
  assert.ok(Math.abs(seg.a[0] + seg.f * (seg.b[0] - seg.a[0]) - lin[0]) < 1e-12);
  const wait = pathSegmentAt(path, 12000);
  assert.deepEqual([wait.a, wait.b, wait.f], [path[1], path[2], 0]);
  const end = pathSegmentAt(path, 99000);
  assert.deepEqual([end.a, end.b, end.f], [path[1], path[2], 1]);
  assert.equal(pathSegmentAt([path[0]], 0), null);
});

test('onLinePosition: zoom- og utsnittsgrense, oppslag på modus + linje + retning', () => {
  const back = { mode: 'tram', line: '17', from: 'Øst', to: 'Sør', points: [...L_TRACE].reverse(), pointsAreTrace: true };
  const straightEt = { mode: 'tram', line: '17', from: 'X', to: 'Y', points: [[59.9, 10.75, 'q', 'X'], END] };
  setLineGeometryData([shape(), back, straightEt], [
    { vehicleId: 'v1', mode: 'tram', line: { publicCode: '17' }, destinationName: 'Sør' },
    { vehicleId: 'v2', mode: 'bus', line: { publicCode: '17' }, destinationName: 'Sør' },
  ]);
  const a = [CORNER[0], 10.75 + dLon(600)];
  const b = [59.9 + dLat(600), 10.75];
  const path = [[a[0], a[1], 0, 0], [b[0], b[1], 10000, 10000]];
  const view = { zoom: 15, s: 59, n: 61, w: 10, e: 11 };
  const straight = positionAt(path, 5000);
  const pos = onLinePosition('v1', path, 5000, straight, view);
  assert.ok(near(pos, [CORNER[0], 10.75 + dLon(50)], 1.5), String(pos));
  assert.equal(onLinePosition('v1', path, 5000, straight, { ...view, zoom: 12 }), null);
  assert.equal(onLinePosition('v1', path, 5000, straight, { ...view, s: 60.5 }), null);
  assert.equal(onLinePosition('v2', path, 5000, straight, view), null, 'buss 17 bruker ikke trikketraseen');
  assert.equal(onLinePosition('ukjent', path, 5000, straight, view), null);
  // Samme par neste tikk: gjenbrukt oppslag, posisjonen flytter seg videre
  const later = onLinePosition('v1', path, 7000, positionAt(path, 7000), view);
  assert.ok(later && later[0] < CORNER[0]);
});

test('withoutTracedLines fjerner gamle rette streker for linjer med trasé', () => {
  const old = [
    { mode: 'tram', line: '17', from: 'X', to: 'Y', points: [] },
    { mode: 'tram', line: '18', from: 'X', to: 'Y', points: [] },
    { mode: 'bus', line: '17', from: 'X', to: 'Y', points: [] },
  ];
  const kept = withoutTracedLines(old, [shape()]);
  assert.deepEqual(kept.map((s) => `${s.mode}|${s.line}`), ['tram|18', 'bus|17']);
  assert.equal(withoutTracedLines(old, [{ mode: 'tram', line: '18', points: [] }]), old);
});
