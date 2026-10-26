import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupDepartures, quayHeader } from '../js/departure-groups.js';

const T0 = Date.parse('2026-10-26T12:00:00Z');
const call = (quayId, min, line = '31', mode = 'bus', dest = '') => ({
  quayId,
  destinationDisplay: { frontText: dest },
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
  assert.deepEqual(groups.map((g) => g.header), [null, 'Mot sentrum', 'Mot Grorud']);
  assert.deepEqual(groups[1].calls.map((c) => c.expectedDepartureTime), [call('q1', 1), call('q1', 5)].map((c) => c.expectedDepartureTime));
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

test('groupDepartures: to quays uten retning blir to grupper med destinasjoner, mot sentrum først', () => {
  // Årvollveien: to quays uten description og plattform
  const quays = [{ id: 'NSR:Quay:11011' }, { id: 'NSR:Quay:11012' }];
  const calls = [
    call('NSR:Quay:11011', 2, '31', 'bus', 'Tonsenhagen'),
    call('NSR:Quay:11011', 6, '25', 'bus', 'Kjelsås'),
    call('NSR:Quay:11011', 9, '31', 'bus', 'Tonsenhagen'),
    call('NSR:Quay:11012', 1, '31', 'bus', 'Snarøya'),
    call('NSR:Quay:11012', 4, '26', 'bus', 'Jernbanetorget'),
  ];
  const groups = groupDepartures(calls, quays);
  assert.deepEqual(groups.map((g) => g.header), ['Mot Snarøya, Jernbanetorget', 'Mot Tonsenhagen, Kjelsås']);
  // Uten sentrum-destinasjon: fast rekkefølge etter quay-ID, uansett hvilken som går først
  const plain = calls.map((c) => ({ ...c, destinationDisplay: { frontText: c.destinationDisplay.frontText.replace('Jernbanetorget', 'Fornebu') } }));
  assert.deepEqual(groupDepartures(plain, quays).map((g) => g.header), ['Mot Tonsenhagen, Kjelsås', 'Mot Snarøya, Fornebu']);
  assert.deepEqual(groupDepartures(plain.reverse(), [...quays].reverse()).map((g) => g.header), ['Mot Tonsenhagen, Kjelsås', 'Mot Snarøya, Fornebu']);
});

test('groupDepartures: Bjerke-rampene gir fire grupper, «mot sentrum» først', () => {
  const quays = [
    { id: 'NSR:Quay:11015', description: 'påkjøringsrampe mot Grorud' },
    { id: 'NSR:Quay:10988', description: 'avkjøringsrampe fra sentrum' },
    { id: 'NSR:Quay:10985', description: 'påkjøringsrampe mot sentrum' },
    { id: 'NSR:Quay:11020', description: 'avkjøringsrampe fra Grorud' },
  ];
  const groups = groupDepartures(quays.map((q, i) => call(q.id, i + 1)), quays);
  assert.deepEqual(groups.map((g) => g.header), [
    'Påkjøringsrampe mot sentrum',
    'Avkjøringsrampe fra Grorud',
    'Avkjøringsrampe fra sentrum',
    'Påkjøringsrampe mot Grorud',
  ]);
});

test('groupDepartures: plattformkode sorteres numerisk før retningsnavn', () => {
  const quays = [
    { id: 'a', publicCode: '10', description: 'Retning vest' },
    { id: 'b', publicCode: '2', description: 'Retning øst' },
  ];
  assert.deepEqual(groupDepartures([call('a', 1), call('b', 2)], quays).map((g) => g.header), ['Retning øst', 'Retning vest']);
});

test('groupDepartures: én quay uten retning får ingen destinasjonsoverskrift', () => {
  const groups = groupDepartures([call('q', 1, '31', 'bus', 'Snarøya'), call('q', 2, '31', 'bus', 'Tonsenhagen')], [{ id: 'q' }]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].header, null);
});
