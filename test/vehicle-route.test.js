import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodePolyline, simplifyLine } from '../server/polyline.js';
import {
  parseVehicleRouteParams,
  normDest,
  pickPatternForDest,
  createVehicleRouteService,
} from '../server/vehicle-route.js';

// Eksempel fra Googles dokumentasjon for polyline-formatet
const GOOGLE_EXAMPLE = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';

test('decodePolyline dekoder Googles eksempel', () => {
  assert.deepEqual(
    decodePolyline(GOOGLE_EXAMPLE).map(([a, b]) => [Math.round(a * 1e5) / 1e5, Math.round(b * 1e5) / 1e5]),
    [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]
  );
  assert.deepEqual(decodePolyline(''), []);
  assert.deepEqual(decodePolyline(null), []);
});

test('simplifyLine fjerner punkter på rett linje og beholder hjørner', () => {
  const pts = [[59.9, 10.7], [59.9, 10.71], [59.9, 10.72], [59.91, 10.72]];
  assert.deepEqual(simplifyLine(pts, 1e-5), [[59.9, 10.7], [59.9, 10.72], [59.91, 10.72]]);
  assert.deepEqual(simplifyLine([[1, 2]], 1e-5), [[1, 2]]);
});

test('parseVehicleRouteParams godtar gyldige verdier', () => {
  const r = parseVehicleRouteParams({ line: '30', mode: 'bus', dest: 'Bygdøy via Bygdøynes', ref: 'RUT:Line:30' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.params, { line: '30', mode: 'bus', dest: 'Bygdøy via Bygdøynes', authority: 'RUT', ref: 'RUT:Line:30' });
  const fb = parseVehicleRouteParams({ line: 'FB1', mode: 'flybuss', dest: 'Oslo lufthavn', authority: 'NBU' });
  assert.equal(fb.ok, true);
  assert.equal(fb.params.ref, null);
});

test('parseVehicleRouteParams avviser ugyldige og farlige verdier', () => {
  const bad = [
    {},
    { line: '30' },
    { line: '30"){x}', mode: 'bus' },
    { line: '30', mode: 'metro' },
    { line: '30', mode: 'bus', dest: 'x'.repeat(200) },
    { line: '30', mode: 'bus', dest: 'a{b}' },
    { line: '30', mode: 'bus', authority: 'rut1' },
    { line: '30', mode: 'bus', ref: 'RUT:Line:30") { id }' },
    { line: ['30', '31'], mode: 'bus' },
  ];
  for (const q of bad) assert.equal(parseVehicleRouteParams(q).ok, false, JSON.stringify(q));
});

test('normDest normaliserer store bokstaver, mellomrom og tegn', () => {
  assert.equal(normDest('  Jernbanetorget (Tollbugt) '), 'jernbanetorget tollbugt');
  assert.equal(normDest('Oslo  S'), 'oslo s');
});

const PATTERNS = [
  { from: 'Tamburveien', to: 'Huk', frontTexts: ['Bygdøy via Bygdøynes', 'Bygdøy'], journeys: 239, quays: 34 },
  { from: 'Tamburveien', to: 'Huk', frontTexts: ['Bygdøy'], journeys: 116, quays: 29 },
  { from: 'Huk', to: 'Tamburveien', frontTexts: ['Nydalen'], journeys: 351, quays: 29 },
  { from: 'Nationaltheatret', to: 'Tamburveien', frontTexts: ['Nydalen'], journeys: 2, quays: 17 },
  { from: 'Huk', to: 'Jernbanetorget', frontTexts: ['Jernbanetorget'], journeys: 14, quays: 16 },
];

test('pickPatternForDest velger retning etter frontText og hovedmønster ved likhet', () => {
  assert.equal(pickPatternForDest(PATTERNS, 'Nydalen'), PATTERNS[2]);
  assert.equal(pickPatternForDest(PATTERNS, 'Bygdøy via Bygdøynes'), PATTERNS[0]);
  assert.equal(pickPatternForDest(PATTERNS, 'Jernbanetorget'), PATTERNS[4]);
});

test('pickPatternForDest bruker siste holdeplass når frontText mangler', () => {
  const p = [
    { from: 'A', to: 'Bragernes torg', frontTexts: [], journeys: 10, quays: 20 },
    { from: 'Bragernes torg', to: 'Konnerud skole', frontTexts: [], journeys: 30, quays: 20 },
  ];
  assert.equal(pickPatternForDest(p, 'Bragernes torg'), p[0]);
  assert.equal(pickPatternForDest(p, 'Ukjent sted'), null);
  assert.equal(pickPatternForDest(p, ''), p[1]);
  assert.equal(pickPatternForDest([], 'x'), null);
});

test('pickPatternForDest: flyplass-destinasjoner matcher lufthavn', () => {
  const p = [
    { from: 'Oslo lufthavn', to: 'Oslo bussterminal', frontTexts: ['Oslo bussterminal'], journeys: 50, quays: 10 },
    { from: 'Oslo bussterminal', to: 'Oslo lufthavn', frontTexts: ['Oslo lufthavn'], journeys: 50, quays: 10 },
  ];
  assert.equal(pickPatternForDest(p, 'Gardermoen'), p[1]);
});

// --- Tjenesten med falsk fetch (ingen nettverk) ---

const ENC = GOOGLE_EXAMPLE;
function jpLine(id) {
  return {
    line: {
      id,
      publicCode: '30',
      transportMode: 'bus',
      journeyPatterns: [
        {
          quays: [
            { id: 'NSR:Quay:1', name: 'Huk', latitude: 59.898, longitude: 10.674 },
            { id: 'NSR:Quay:2', name: 'Tamburveien', latitude: 59.95, longitude: 10.768 },
          ],
          pointsOnLink: { points: ENC },
          serviceJourneys: [{ id: 'RUT:ServiceJourney:a' }, { id: 'RUT:ServiceJourney:b' }],
        },
        {
          quays: [
            { id: 'NSR:Quay:2', name: 'Tamburveien', latitude: 59.95, longitude: 10.768 },
            { id: 'NSR:Quay:1', name: 'Huk', latitude: 59.898, longitude: 10.674 },
          ],
          pointsOnLink: null,
          serviceJourneys: [{ id: 'RUT:ServiceJourney:c' }],
        },
        { quays: [{ id: 'q', name: 'X', latitude: 1, longitude: 1 }], pointsOnLink: null, serviceJourneys: [] },
      ],
    },
  };
}

function makeFetch({ fail = false } = {}) {
  const calls = [];
  const fetchFn = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push(body);
    assert.equal(opts.headers['ET-Client-Name'], 'ruterlive-web');
    if (fail) return { ok: false, status: 500, json: async () => ({}) };
    let data;
    if (body.query.includes('lines(')) {
      data = { lines: [
        { id: 'VKT:Line:30', publicCode: '30', transportMode: 'bus' },
        { id: 'VYS:Line:30', publicCode: '30', transportMode: 'rail' },
        { id: 'RUT:Line:30', publicCode: '30', transportMode: 'bus' },
      ] };
    } else if (body.query.includes('journeyPatterns')) {
      data = jpLine(body.variables.id);
    } else {
      data = {};
      for (const [k, v] of Object.entries(body.variables)) {
        const front = v.endsWith(':c') ? 'Bygdøy' : 'Nydalen';
        data[`p${k.slice(1)}`] = { passingTimes: [{ destinationDisplay: { frontText: front } }] };
      }
    }
    return { ok: true, json: async () => ({ data }) };
  };
  return { fetchFn, calls };
}

test('tjenesten bygger rute med punkter og stopp, og cacher linjen', async () => {
  const { fetchFn, calls } = makeFetch();
  const svc = createVehicleRouteService({ fetchFn });
  const r = await svc.getRoute({ line: '30', mode: 'bus', dest: 'Nydalen', authority: 'RUT', ref: 'RUT:Line:30' });
  assert.equal(r.from, 'Huk');
  assert.equal(r.to, 'Tamburveien');
  assert.equal(r.line, '30');
  assert.equal(r.mode, 'bus');
  assert.ok(r.points.length >= 2);
  for (const p of r.points) for (const x of p) assert.equal(Math.round(x * 1e5) / 1e5, x);
  assert.deepEqual(r.stops[0], [59.898, 10.674, 'Huk', 'NSR:Quay:1']);
  // Ingen lines()-oppslag når ref er kjent: mønstre + frontText = 2 kall
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => c.variables), 'bruker GraphQL-variabler');

  const back = await svc.getRoute({ line: '30', mode: 'bus', dest: 'Bygdøy', authority: 'RUT', ref: 'RUT:Line:30' });
  assert.equal(back.from, 'Tamburveien');
  assert.equal(back.to, 'Huk');
  // Uten pointsOnLink: holdeplassene blir linjen
  assert.deepEqual(back.points, [[59.95, 10.768], [59.898, 10.674]]);
  assert.equal(calls.length, 2, 'samme linje er cachet');
});

test('tjenesten slår opp linje-ID og foretrekker RUT uten ref og authority', async () => {
  const { fetchFn, calls } = makeFetch();
  const svc = createVehicleRouteService({ fetchFn });
  const r = await svc.getRoute({ line: '30', mode: 'bus', dest: 'Nydalen', authority: null, ref: null });
  assert.equal(r.to, 'Tamburveien');
  assert.equal(calls[1].variables.id, 'RUT:Line:30');
  const v = await svc.getRoute({ line: '30', mode: 'bus', dest: 'Nydalen', authority: 'VKT', ref: null });
  assert.ok(v);
  assert.equal(calls.at(-2).variables.id, 'VKT:Line:30');
});

test('samtidige kall deler én henting', async () => {
  const { fetchFn, calls } = makeFetch();
  const svc = createVehicleRouteService({ fetchFn });
  const p = { line: '30', mode: 'bus', dest: 'Nydalen', authority: 'RUT', ref: 'RUT:Line:30' };
  const [a, b] = await Promise.all([svc.getRoute(p), svc.getRoute({ ...p, dest: 'Bygdøy' })]);
  assert.ok(a && b);
  assert.equal(calls.length, 2);
});

test('feil caches kort (negativ cache) og prøves igjen etter utløp', async () => {
  let now = 1_000_000;
  const failing = makeFetch({ fail: true });
  const ok = makeFetch();
  let useOk = false;
  const svc = createVehicleRouteService({
    fetchFn: (...a) => (useOk ? ok.fetchFn(...a) : failing.fetchFn(...a)),
    now: () => now,
    failureTtlMs: 10 * 60 * 1000,
  });
  const p = { line: '30', mode: 'bus', dest: 'Nydalen', authority: 'RUT', ref: 'RUT:Line:30' };
  assert.equal(await svc.getRoute(p), null);
  useOk = true;
  assert.equal(await svc.getRoute(p), null, 'feilen er cachet');
  assert.equal(ok.calls.length, 0);
  now += 10 * 60 * 1000 + 1;
  assert.ok(await svc.getRoute(p));
  assert.equal(ok.calls.length, 2);
});

test('linjecachen er begrenset (LRU) og utløper etter 24 t', async () => {
  let now = 0;
  const { fetchFn, calls } = makeFetch();
  const svc = createVehicleRouteService({ fetchFn, now: () => now, maxLines: 2 });
  const get = (ref) => svc.getRoute({ line: '30', mode: 'bus', dest: 'Nydalen', authority: 'RUT', ref });
  await get('RUT:Line:30');
  await get('VKT:Line:30');
  await get('RUT:Line:30'); // treff, blir nyest
  await get('AKT:Line:30'); // kaster VKT
  assert.equal(svc.size(), 2);
  const before = calls.length;
  await get('RUT:Line:30');
  assert.equal(calls.length, before, 'RUT fortsatt cachet');
  await get('VKT:Line:30');
  assert.equal(calls.length, before + 2, 'VKT ble kastet');
  now += 24 * 60 * 60 * 1000 + 1;
  await get('VKT:Line:30');
  assert.equal(calls.length, before + 4, 'utløpt etter 24 t');
});

test('hengende JP-kall gir null innen tidsgrensen', async () => {
  const svc = createVehicleRouteService({ fetchFn: () => new Promise(() => {}), timeoutMs: 30 });
  const t = Date.now();
  assert.equal(await svc.getRoute({ line: '30', mode: 'bus', dest: '', authority: 'RUT', ref: 'RUT:Line:30' }), null);
  assert.ok(Date.now() - t < 1000);
});
