import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupStops, normalizeStopName, displayStopName } from '../js/stop-groups.js';

// Ca. 0,0009° breddegrad = 100 m
const at = (lat, lon, name, quayId) => ({ lat, lon, name, quayId });

test('normalizeStopName: plattformsuffiks, «stasjon» og tall til slutt fjernes', () => {
  assert.equal(normalizeStopName('Nationaltheatret [4311]'), 'nationaltheatret');
  assert.equal(normalizeStopName('Nationaltheatret spor 3'), 'nationaltheatret');
  assert.equal(normalizeStopName('Nationaltheatret stasjon'), 'nationaltheatret');
  assert.equal(normalizeStopName('Oslo bussterminal 12'), 'oslo bussterminal');
  assert.equal(normalizeStopName('Oslo S plattform B'), 'oslo s');
  assert.equal(normalizeStopName('Oslo S'), 'oslo s');
  assert.equal(displayStopName('Jernbanetorget [4311]'), 'Jernbanetorget');
  assert.equal(displayStopName('Oslo S'), 'Oslo S');
});

test('groupStops: plattformer med samme navn blir én markør i midtpunktet med alle quay-ID-er', () => {
  const g = groupStops([
    at(59.9150, 10.7320, 'Nationaltheatret', 'NSR:Quay:1'),
    at(59.9152, 10.7322, 'Nationaltheatret', 'NSR:Quay:2'),
    at(59.9154, 10.7324, 'Nationaltheatret spor 3', 'NSR:Quay:3'),
    at(59.9150, 10.7320, 'Nationaltheatret', 'NSR:Quay:1'), // samme quay to ganger
  ]);
  assert.equal(g.length, 1);
  assert.equal(g[0].name, 'Nationaltheatret');
  assert.deepEqual(g[0].quayIds, ['NSR:Quay:1', 'NSR:Quay:2', 'NSR:Quay:3']);
  assert.ok(Math.abs(g[0].lat - 59.91515) < 1e-6);
  assert.ok(Math.abs(g[0].lon - 10.73215) < 1e-6);
});

test('groupStops: avlange terminaler lenkes stopp for stopp (innenfor 120 m av nærmeste)', () => {
  const stops = [];
  for (let i = 0; i < 8; i++) stops.push(at(59.9110 + i * 0.0005, 10.7560, `Oslo bussterminal ${i + 1}`, `NSR:Quay:${10 + i}`));
  const g = groupStops(stops);
  assert.equal(g.length, 1);
  assert.equal(g[0].quayIds.length, 8);
});

test('groupStops: et stopp som binder sammen to grupper slår dem sammen', () => {
  const g = groupStops([
    at(59.9100, 10.7500, 'Jernbanetorget', 'NSR:Quay:1'),
    at(59.9120, 10.7500, 'Jernbanetorget', 'NSR:Quay:2'), // ca. 220 m: egen gruppe foreløpig
    at(59.9110, 10.7500, 'Jernbanetorget', 'NSR:Quay:3'), // ca. 110 m fra begge
  ]);
  assert.equal(g.length, 1);
  assert.deepEqual([...g[0].quayIds].sort(), ['NSR:Quay:1', 'NSR:Quay:2', 'NSR:Quay:3']);
});

test('groupStops: ulike navn holdes adskilt selv om de ligger tett', () => {
  const g = groupStops([
    at(59.9110, 10.7520, 'Oslo S', 'NSR:Quay:1'),
    at(59.9111, 10.7521, 'Jernbanetorget', 'NSR:Quay:2'),
    at(59.9112, 10.7522, 'Oslo S', 'NSR:Quay:3'),
  ]);
  assert.deepEqual(g.map((x) => x.name), ['Oslo S', 'Jernbanetorget']);
  assert.deepEqual(g[0].quayIds, ['NSR:Quay:1', 'NSR:Quay:3']);
});

test('groupStops: samme navn langt fra hverandre blir egne grupper', () => {
  const g = groupStops([
    at(59.9100, 10.7500, 'Storgata', 'NSR:Quay:1'),
    at(59.9120, 10.7500, 'Storgata', 'NSR:Quay:2'), // ca. 220 m unna
  ]);
  assert.equal(g.length, 2);
});

test('groupStops: stopp uten navn eller med ugyldige koordinater', () => {
  const g = groupStops([at(59.91, 10.75, ''), at(59.91, 10.75, ''), at(NaN, 10.75, 'X'), null]);
  assert.equal(g.length, 2);
  assert.equal(g[0].name, '');
  assert.deepEqual(g[0].quayIds, []);
});

test('groupStops: gruppen beholder det første stoppets egenskaper', () => {
  const g = groupStops([{ ...at(59.91, 10.75, 'Majorstuen', 'NSR:Quay:1'), color: '#2a9d8f' }, { ...at(59.9101, 10.75, 'Majorstuen', 'NSR:Quay:2'), color: '#e63946' }]);
  assert.equal(g[0].first.color, '#2a9d8f');
});
