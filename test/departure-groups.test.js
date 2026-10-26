import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupDepartures, quayHeader } from '../js/departure-groups.js';

const T0 = Date.parse('2026-10-26T12:00:00Z');
const call = (quayId, min, line = '31', mode = 'bus') => ({
  quayId,
  expectedDepartureTime: new Date(T0 + min * 60000).toISOString(),
  aimedDepartureTime: new Date(T0 + min * 60000).toISOString(),
  serviceJourney: { journeyPattern: { line: { publicCode: line, transportMode: mode } } },
});

test('quayHeader: description, ellers plattform/spor, ellers ingenting', () => {
  assert.equal(quayHeader({ description: 'retning sentrum', publicCode: 'A' }), 'Retning sentrum');
  assert.equal(quayHeader({ description: '  ', publicCode: 'B' }), 'Plattform B');
  assert.equal(quayHeader({ publicCode: '3' }, ['rail']), 'Spor 3');
  assert.equal(quayHeader({ publicCode: '3' }, ['rail', 'bus']), 'Plattform 3');
  assert.equal(quayHeader({ publicCode: '', description: null }), null);
  assert.equal(quayHeader(undefined), null);
});

test('groupDepartures: én gruppe per retning, sortert, uten tomme grupper', () => {
  const quays = [
    { id: 'q1', description: 'mot sentrum' },
    { id: 'q2', description: 'mot Grorud' },
    { id: 'q3', publicCode: '' },
  ];
  const groups = groupDepartures([call('q1', 5), call('q2', 2), call('q1', 1), call('q3', 3), call('q2', 9)], quays);
  assert.deepEqual(groups.map((g) => g.header), [null, 'Mot Grorud', 'Mot sentrum']);
  assert.deepEqual(groups[2].calls.map((c) => c.expectedDepartureTime), [call('q1', 1), call('q1', 5)].map((c) => c.expectedDepartureTime));
  // Quay uten avganger gir ingen gruppe
  assert.equal(groupDepartures([call('q1', 1), call('q2', 2)], [...quays, { id: 'q4', description: 'X' }]).length, 2);
});

test('groupDepartures: én gruppe (eller bare quays uten retning) gir ingen overskrift', () => {
  const one = groupDepartures([call('q1', 1), call('q1', 2)], [{ id: 'q1', description: 'mot sentrum' }]);
  assert.equal(one.length, 1);
  assert.equal(one[0].header, null);
  const none = groupDepartures([call('a', 1), call('b', 2)], [{ id: 'a' }, { id: 'b', publicCode: '' }]);
  assert.equal(none.length, 1);
  assert.equal(none[0].header, null);
  assert.deepEqual(groupDepartures([], []), []);
});

test('groupDepartures: quays med samme overskrift slås sammen, og antall per gruppe begrenses', () => {
  const quays = [
    { id: 'a', description: 'mot sentrum' },
    { id: 'b', description: 'Mot sentrum' },
    { id: 'c', publicCode: 'C' },
  ];
  const calls = [1, 2, 3, 4, 5, 6, 7].map((m) => call(m % 2 ? 'a' : 'b', m)).concat([call('c', 1)]);
  const groups = groupDepartures(calls, quays);
  assert.deepEqual(groups.map((g) => g.header), ['Mot sentrum', 'Plattform C']);
  assert.equal(groups[0].calls.length, 5);
  const many = groupDepartures(
    'abcdef'.split('').flatMap((id) => [call(id, 1), call(id, 2), call(id, 3)]),
    'abcdef'.split('').map((id) => ({ id, publicCode: id.toUpperCase() }))
  );
  assert.equal(many.length, 6);
  assert.ok(many.every((g) => g.calls.length === 2));
  assert.deepEqual(many.map((g) => g.header), ['Plattform A', 'Plattform B', 'Plattform C', 'Plattform D', 'Plattform E', 'Plattform F']);
});

test('groupDepartures: uten grupper maks 3 per modus og 10 totalt (som før)', () => {
  const calls = Array.from({ length: 8 }, (_, i) => call('q', i + 1, '31', 'bus')).concat(
    Array.from({ length: 8 }, (_, i) => call('q', i + 1, '5', 'metro'))
  );
  const [g] = groupDepartures(calls, [{ id: 'q' }]);
  assert.equal(g.calls.length, 6);
});
