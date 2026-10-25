import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';
import { simplifyLine } from '../server/polyline.js';
import {
  GEOMETRY_TOL_DEG,
  applyLineGeometry,
  buildLineShapes,
  clipToBbox,
  compactJourneyPattern,
  createLineGeometryService,
  selectPatterns,
  traceFromEncoded,
} from '../server/line-geometry.js';
import { LINES } from '../server/line-catalog.js';

function encodeNum(v) {
  let n = v < 0 ? ~(v << 1) : v << 1;
  let out = '';
  while (n >= 0x20) { out += String.fromCharCode((0x20 | (n & 0x1f)) + 63); n >>= 5; }
  return out + String.fromCharCode(n + 63);
}
/** Google polyline-koding (motsatt av decodePolyline), for testdata. */
function encode(points) {
  let pl = 0, pn = 0, out = '';
  for (const [a, b] of points) {
    const la = Math.round(a * 1e5), lo = Math.round(b * 1e5);
    out += encodeNum(la - pl) + encodeNum(lo - pn);
    pl = la; pn = lo;
  }
  return out;
}

const quay = (id, name, lat, lon) => ({ id, name, latitude: lat, longitude: lon });
/** Rett nordover langs lon 10.75 fra 59.90 til 59.92, med et knekk øst i midten. */
const TRACE = [];
for (let i = 0; i <= 40; i++) TRACE.push([59.9 + i * 0.0005, 10.75 + (i === 20 ? 0.002 : 0)]);
const pattern = (quays, n, pts = TRACE) => ({
  quays,
  pointsOnLink: { points: encode(pts) },
  serviceJourneys: Array.from({ length: n }, (_, i) => ({ id: `SJ:${i}` })),
});
const A = quay('NSR:Quay:1', 'Alfa', 59.9, 10.75);
const B = quay('NSR:Quay:2', 'Beta', 59.91, 10.7502);
const C = quay('NSR:Quay:3', 'Gamma', 59.92, 10.75);
const metroLine = { slug: 't', code: '9', mode: 'metro', authority: 'RUT' };

test('simplifyLine: avvik under toleransen fjernes, over beholdes', () => {
  // ca. 3,3 m og 11 m sideveis avvik midt på en 1 km lang strekning
  const small = [[59.9, 10.75], [59.9045, 10.75 + 3e-5 / Math.cos((59.9 * Math.PI) / 180)], [59.909, 10.75]];
  const big = [[59.9, 10.75], [59.9045, 10.75 + 1e-4 / Math.cos((59.9 * Math.PI) / 180)], [59.909, 10.75]];
  assert.equal(simplifyLine(small, GEOMETRY_TOL_DEG).length, 2);
  assert.equal(simplifyLine(big, GEOMETRY_TOL_DEG).length, 3);
});

test('traceFromEncoded runder til 5 desimaler og beholder knekken', () => {
  const pts = traceFromEncoded(encode(TRACE));
  assert.ok(pts.length >= 4 && pts.length < TRACE.length);
  for (const [a, b] of pts) {
    assert.equal(Math.round(a * 1e5) / 1e5, a);
    assert.equal(Math.round(b * 1e5) / 1e5, b);
  }
  assert.ok(pts.some(([, lon]) => Math.abs(lon - 10.752) < 1e-9), 'knekken skal være med');
});

test('selectPatterns: hovedmønster per retning og vanlige varianter', () => {
  const fwd = pattern([A, B, C], 100);
  const rev = pattern([C, B, A], 90, [...TRACE].reverse());
  const shortFwd = pattern([A, B], 40, TRACE.slice(0, 21));
  const rare = pattern([B, C], 5, TRACE.slice(20));
  const chosen = selectPatterns([fwd, rev, shortFwd, rare].map(compactJourneyPattern));
  assert.deepEqual(chosen.map((p) => `${p.from}>${p.to}`), ['Alfa>Gamma', 'Alfa>Beta', 'Gamma>Alfa']);
  assert.equal(chosen[1].head, chosen[0]);
});

test('buildLineShapes: trasé som points, holdeplasser i quayStops, nøkkelfelt beholdt', () => {
  const shapes = buildLineShapes(metroLine, [pattern([A, B, C], 100), pattern([A, B], 40, TRACE.slice(0, 21))]);
  assert.equal(shapes.length, 2);
  const [main, short] = shapes;
  assert.equal(main.mode, 'metro');
  assert.equal(main.line, '9');
  assert.equal(main.from, 'Alfa');
  assert.equal(main.to, 'Gamma');
  assert.equal(main.via, 'Beta');
  assert.equal(main.pointsAreTrace, true);
  assert.deepEqual(main.quayStops, [
    [59.9, 10.75, 'NSR:Quay:1', 'Alfa'],
    [59.91, 10.7502, 'NSR:Quay:2', 'Beta'],
    [59.92, 10.75, 'NSR:Quay:3', 'Gamma'],
  ]);
  assert.ok(main.points.every((p) => p.length === 2), 'points er bare trasé');
  // Variant som utsnitt av hovedtraseen: mellompunktene er de samme
  const inner = short.points.slice(1, -1).map(String);
  const mainPts = new Set(main.points.map(String));
  assert.ok(inner.every((p) => mainPts.has(p)));
});

test('buildLineShapes hopper over mønstre der pointsOnLink bare er holdeplassene', () => {
  const straight = pattern([A, B, C], 100, [[59.9, 10.75], [59.91, 10.7502], [59.92, 10.75]]);
  assert.deepEqual(buildLineShapes(metroLine, [straight]), []);
});

test('endepunkt uten navn erstattes av nærmeste holdeplass med navn', () => {
  const p = compactJourneyPattern(pattern([A, B, quay('NSR:Quay:9', '-', 59.92, 10.75)], 10));
  assert.equal(p.to, 'Beta');
});

test('clipToBbox: lengste del innenfor, med ett punkt utenfor i hver ende', () => {
  const bbox = { s: 0, n: 10, w: 0, e: 10 };
  const pts = [[-5, 1], [1, 1], [2, 2], [3, 3], [20, 3], [4, 4]];
  assert.deepEqual(clipToBbox(pts, bbox), [[-5, 1], [1, 1], [2, 2], [3, 3], [20, 3]]);
  assert.deepEqual(clipToBbox([[1, 1], [2, 2]], bbox), [[1, 1], [2, 2]]);
  assert.deepEqual(clipToBbox([[20, 20]], bbox), []);
});

test('applyLineGeometry: erstatter rette streker for linjen, beholder andre linjer og moduser', () => {
  const geo = buildLineShapes(metroLine, [pattern([A, B, C], 100)]);
  const et = [
    { mode: 'metro', line: '9', from: 'Alfa', to: 'Gamma', points: [[59.9, 10.75, 'NSR:Quay:1', 'Alfa'], [59.92, 10.75, 'NSR:Quay:3', 'Gamma']] },
    { mode: 'metro', line: '9', from: 'Beta', to: 'Gamma', points: [] },
    { mode: 'bus', line: '9', from: 'X', to: 'Y', points: [] },
    { mode: 'metro', line: '8', from: 'X', to: 'Y', points: [] },
  ];
  const out = applyLineGeometry(et, geo);
  const keys = out.map((s) => `${s.mode}|${s.line}|${s.from}|${s.to}`);
  assert.deepEqual(keys, ['bus|9|X|Y', 'metro|8|X|Y', 'metro|9|Alfa|Gamma']);
  assert.equal(out[2].pointsAreTrace, true);
  assert.equal(out[2].quayStops.length, 3);
  assert.equal(applyLineGeometry(et, []), et);
});

test('tjenesten: GraphQL-variabler, ET-Client-Name, 24 t cache, in-flight-dedup og negativ cache', async () => {
  let t = 0;
  const calls = [];
  let failLine = true;
  const fetchFn = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ headers: init.headers, body });
    assert.equal(init.headers['ET-Client-Name'], 'ruterlive-web');
    assert.ok(init.signal, 'hard tidsgrense via AbortController');
    if (body.query.includes('lines(')) {
      assert.deepEqual(body.variables.codes, ['9', '8']);
      return { ok: true, json: async () => ({ data: { lines: [
        { id: 'RUT:Line:9', publicCode: '9', transportMode: 'metro' },
        { id: 'RUT:Line:8', publicCode: '8', transportMode: 'metro' },
      ] } }) };
    }
    if (body.variables.id === 'RUT:Line:8' && failLine) return { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, json: async () => ({ data: { line: { journeyPatterns: [pattern([A, B, C], 100)] } } }) };
  };
  const lines = [metroLine, { slug: 'u', code: '8', mode: 'metro', authority: 'RUT' }];
  const svc = createLineGeometryService({ fetchFn, now: () => t, lines });
  const warn = console.warn, log = console.log;
  console.warn = () => {};
  console.log = () => {};
  try {
    const [r1, r2] = await Promise.all([svc.refresh(), svc.refresh()]);
    assert.equal(r1, r2, 'samtidige kall deler henting');
    assert.equal(calls.length, 3);
    assert.equal(r1.failed, 1);
    const first = svc.getShapes();
    assert.equal(first.length, 1);
    assert.ok(calls.every((c) => c.body.variables), 'alltid GraphQL-variabler');

    await svc.refresh(); // linje 8 er i negativ cache
    assert.equal(calls.length, 3);

    t += 11 * 60 * 1000;
    failLine = false;
    await svc.refresh();
    assert.equal(calls.length, 4, 'bare den feilede linjen hentes på nytt');
    assert.equal(svc.getShapes().length, 2);

    const same = svc.getShapes();
    t += 25 * 60 * 60 * 1000;
    await svc.refresh();
    assert.equal(svc.getShapes(), same, 'uendret innhold gir samme array (ingen ny shapesVersion)');
  } finally {
    console.warn = warn;
    console.log = log;
  }
});

test('bytebudsjett: trasé for alle katalog-linjer fra fixture', () => {
  const raw = JSON.parse(zlib.gunzipSync(readFileSync(new URL('./fixtures/jp-line-patterns.json.gz', import.meta.url))));
  const shapes = LINES.flatMap((l) => buildLineShapes(l, raw[l.slug] ?? []));
  const json = JSON.stringify(shapes);
  const br = zlib.brotliCompressSync(Buffer.from(json), { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } }).length;
  // Hele route-shapes-all skal holde seg under ~500 kB br; traseen alene får ta maks 70 kB
  assert.ok(br < 70 * 1024, `trasé br ${br} B`);
  assert.ok(json.length < 700 * 1024, `trasé rå ${json.length} B`);
  const modes = new Set(shapes.map((s) => s.mode));
  for (const m of ['metro', 'tram', 'rail', 'flybuss']) assert.ok(modes.has(m), `mangler ${m}`);
  for (const s of shapes) {
    assert.ok(s.points.length >= 2 && s.quayStops.length >= 1, `${s.line} ${s.from}`);
    for (const p of s.points) assert.ok(p[0] >= 58.9 && p[0] <= 60.6, 'klippet til regionen');
  }
});
