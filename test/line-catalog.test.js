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

test('pickMainPattern bruker flest quays ved likt antall avganger', () => {
  const result = pickMainPattern([
    { quays: quays(5), serviceJourneys: journeys(10) },
    { quays: quays(9), serviceJourneys: journeys(10) },
  ]);
  assert.equal(result.stops.length, 9);
});

test('pickMainPattern gir null uten mønstre', () => {
  assert.equal(pickMainPattern([]), null);
  assert.equal(pickMainPattern(undefined), null);
});

test('countVehiclesForLine teller aliaser, uavhengig av store/små bokstaver', () => {
  const r13 = getLineBySlug('tog-r13');
  const vehicles = [
    { line: { publicCode: 'R13x' } },
    { line: { publicCode: 'r13' } },
    { line: { publicCode: 'R14' } },
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
