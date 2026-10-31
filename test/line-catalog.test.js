import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LINES, RAIL_REGIONS, getLineBySlug, pickMainPattern } from '../server/line-catalog.js';
import { NORWAY_BOUNDS } from '../shared/regions.js';
import { countVehiclesForLine } from '../server/live-vehicles.js';

const quays = (n) => Array.from({ length: n }, (_, i) => ({ name: `Stopp ${i}` }));
const journeys = (n) => Array.from({ length: n }, (_, i) => ({ id: `SJ:${i}` }));

test('pickMainPattern velger mønsteret med flest avganger', () => {
  const result = pickMainPattern([
    { quays: [...quays(43)], serviceJourneys: journeys(566) },
    { quays: quays(43), serviceJourneys: journeys(550) },
    { quays: quays(19), serviceJourneys: journeys(16) },
  ]);
  assert.equal(result.stops.length, 43);
  assert.equal(result.from, 'Stopp 0');
  assert.equal(result.to, 'Stopp 42');
});

test('pickMainPattern bruker flest quays ved likt produkt', () => {
  const result = pickMainPattern([
    { quays: quays(5), serviceJourneys: journeys(18) },
    { quays: quays(9), serviceJourneys: journeys(10) },
    { quays: quays(10), serviceJourneys: journeys(9) },
  ]);
  assert.equal(result.stops.length, 10);
});

test('pickMainPattern: FLY2 velger mønsteret med 6 stopp', () => {
  const result = pickMainPattern([
    { quays: quays(2), serviceJourneys: journeys(2268) },
    { quays: quays(6), serviceJourneys: journeys(2184) },
  ]);
  assert.equal(result.stops.length, 6);
});

test('pickMainPattern: linje 5 og linje 13', () => {
  const l5 = pickMainPattern([
    { quays: quays(43), serviceJourneys: journeys(566) },
    { quays: quays(43), serviceJourneys: journeys(550) },
    { quays: quays(46), serviceJourneys: journeys(16) },
  ]);
  assert.equal(l5.stops.length, 43);
  const l13 = pickMainPattern([
    { quays: quays(19), serviceJourneys: journeys(327) },
    { quays: quays(20), serviceJourneys: journeys(323) },
  ]);
  assert.equal(l13.stops.length, 20);
});

test('pickMainPattern gir null uten mønstre', () => {
  assert.equal(pickMainPattern([]), null);
  assert.equal(pickMainPattern(undefined), null);
});

test('countVehiclesForLine teller aliaser, uavhengig av store/små bokstaver', () => {
  const r13 = getLineBySlug('tog-r13');
  const vehicles = [
    { mode: 'RAIL', line: { publicCode: 'R13x' } },
    { mode: 'rail', line: { publicCode: 'r13' } },
    { mode: 'rail', line: { publicCode: 'R14' } },
    {},
  ];
  assert.equal(countVehiclesForLine(vehicles, r13), 2);
});

test('linjekatalogen er komplett og konsistent', () => {
  assert.equal(getLineBySlug('t-bane-5').code, '5');
  assert.equal(getLineBySlug('finnes-ikke'), undefined);
  assert.equal(LINES.length, 62);
  assert.equal(new Set(LINES.map((l) => l.slug)).size, LINES.length);
  for (const line of LINES) {
    assert.ok(line.title, line.slug);
    assert.ok(line.intro && line.intro.trim().length > 0, `tom intro: ${line.slug}`);
  }
});

test('aliaser for x-varianter', () => {
  assert.deepEqual(getLineBySlug('tog-r13').aliases, ['R13x']);
  assert.deepEqual(getLineBySlug('tog-l2').aliases, ['L2x']);
  assert.deepEqual(getLineBySlug('tog-r23').aliases, ['R23x']);
  assert.deepEqual(getLineBySlug('tog-re11').aliases, ['RX11']);
  assert.deepEqual(getLineBySlug('tog-re20').aliases, ['RX20']);
});

test('countVehiclesForLine ignorerer buss med samme linjekode som T-bane', () => {
  const vehicles = [
    { mode: 'bus', line: { publicCode: '5' } },
    { mode: 'metro', line: { publicCode: '5' } },
  ];
  assert.equal(countVehiclesForLine(vehicles, getLineBySlug('t-bane-5')), 1);
  assert.equal(countVehiclesForLine([{ mode: 'BUS', line: { publicCode: 'FB1' } }], getLineBySlug('flybuss-fb1')), 1);
});

test('getLineStops: samtidige kall for ulike linjer henter linje-IDer bare én gang', async () => {
  const { getLineBySlug, getLineStops } = await import('../server/line-catalog.js');
  let idCalls = 0;
  const fetchFn = async (_url, opts) => {
    const q = String(opts?.body ?? '');
    if (q.includes('lines(publicCodes')) idCalls++;
    await new Promise((r) => setTimeout(r, 20));
    return { ok: true, json: async () => ({ data: q.includes('lines(publicCodes') ? { lines: [] } : { line: null } }) };
  };
  await Promise.all([
    getLineStops(getLineBySlug('t-bane-5'), fetchFn),
    getLineStops(getLineBySlug('trikk-17'), fetchFn),
  ]);
  assert.equal(idCalls, 1);
});

const railJourneys = (n, transportMode = 'rail') => Array.from({ length: n }, (_, i) => ({ id: `SJ:${i}`, transportMode }));
const named = (...names) => names.map((name) => ({ name }));

test('pickMainPattern rail: hopper over buss for tog', () => {
  const r = pickMainPattern([
    { quays: named('Trondheim S Fosenkaia', 'Støren', 'Oppdal', 'Dombås', 'Oslo S Trelastgata'), serviceJourneys: railJourneys(40, 'bus') },
    { quays: named('Trondheim S', 'Dombås', 'Oslo S'), serviceJourneys: railJourneys(3) },
  ], { rail: true });
  assert.deepEqual(r.stops, ['Trondheim S', 'Dombås', 'Oslo S']);
  // Uten rail-valget vinner bussmønsteret (gammel oppførsel for andre moduser)
  assert.equal(pickMainPattern([
    { quays: named('A', 'B', 'C', 'D'), serviceJourneys: railJourneys(40, 'bus') },
    { quays: named('A', 'D'), serviceJourneys: railJourneys(3) },
  ]).stops.length, 4);
});

test('pickMainPattern rail: fjerntog med ett mønster per tur telles sammen per endepunkt', () => {
  const long = (extra) => ({ quays: named('Oslo S', 'Drammen', ...extra, 'Bergen'), serviceJourneys: railJourneys(1) });
  const r = pickMainPattern([
    long(['Hønefoss', 'Geilo']),
    long(['Hønefoss', 'Gol', 'Geilo']),
    long(['Geilo']),
    long(['Hønefoss', 'Geilo', 'Finse']),
    { quays: named('Oslo S', 'Drammen', 'Hønefoss', 'Gol', 'Geilo', 'Finse', 'Voss', 'Arna'), serviceJourneys: railJourneys(2) },
  ], { rail: true });
  assert.equal(r.from, 'Oslo S');
  assert.equal(r.to, 'Bergen');
  assert.equal(r.stops.length, 6); // mønsteret med flest holdeplasser blant dem med samme ender
});

test('toglinjer utenfor Oslo: slug, region, myndighet og kartutsnitt', () => {
  const national = LINES.filter((l) => l.national);
  assert.equal(national.length, 16);
  const regions = new Set(RAIL_REGIONS.map(([id]) => id));
  for (const l of LINES.filter((x) => x.mode === 'rail')) {
    assert.equal(l.slug, `tog-${l.code.toLowerCase()}`, l.slug);
    assert.ok(regions.has(l.region), `${l.slug}: region ${l.region}`);
    assert.ok(['VYG', 'GOA', 'SJN'].includes(l.authority), l.slug);
  }
  for (const l of national) {
    const { lat, lng, z } = l.map;
    assert.ok(lat >= NORWAY_BOUNDS.minLat && lat <= NORWAY_BOUNDS.maxLat && lng >= NORWAY_BOUNDS.minLon && lng <= NORWAY_BOUNDS.maxLon, l.slug);
    assert.ok(Number.isInteger(z) && z >= 5 && z <= 13, l.slug);
    assert.match(l.title, new RegExp(`^Tog ${l.code} .+–.+`), l.slug);
  }
  for (const [id] of RAIL_REGIONS) assert.ok(LINES.some((l) => l.region === id), id);
});
