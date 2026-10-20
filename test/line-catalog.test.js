import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LINES, getLineBySlug, pickMainPattern } from '../server/line-catalog.js';
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
  assert.equal(LINES.length, 28);
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
