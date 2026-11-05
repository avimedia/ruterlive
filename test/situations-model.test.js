import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normalizeSituation, isRelevant, buildSituationIndex, compareSituations,
  situationsForRegion, situationsForStop, countsTowardBadge, hasTargets, listableSituations,
} from '../server/situations-model.js';
import { REGIONS } from '../shared/regions.js';
import { areaFor, SITUATION_AREAS } from '../shared/situation-areas.js';

const raw = JSON.parse(readFileSync(new URL('./fixtures/situations-sample.json', import.meta.url))).data.situations;
const byNum = (n) => raw.find((s) => s.situationNumber.endsWith(':' + n));
const norm = (n) => normalizeSituation(byNum(n));
const NOW = Date.parse('2026-11-05T12:00:00Z');

test('normalisering: id, kodeområde, tider i ms', () => {
  const s = norm(1);
  assert.equal(s.id, 'RUT:SituationNumber:1');
  assert.equal(s.codespace, 'RUT');
  assert.equal(s.planned, true);
  assert.equal(s.validity[0].start, Date.parse('2026-10-01T00:00:00Z'));
  assert.equal(s.validity.length, 2);
  assert.deepEqual(s.lines, [{ ref: 'RUT:Line:10', code: '10' }]);
});

test('normalisering: språkvalg', () => {
  assert.equal(norm(5).summary, 'Route cancelled');
  assert.equal(norm(6).summary, 'Norsk uten språk');
  assert.equal(norm(2).advice, 'Ta buss.');
});

test('normalisering: null uten oppsummering og for closed', () => {
  assert.equal(norm(11), null);
  assert.equal(norm(4), null);
  assert.equal(normalizeSituation(null), null);
});

test('normalisering: bare http(s)-lenker beholdes', () => {
  assert.deepEqual(norm(7).links, ['https://ruter.no/x']);
});

test('normalisering: holdeplasser og alvorlighet', () => {
  assert.deepEqual(norm(8).stops, [{ id: 'NSR:StopPlace:1', name: 'Sted A' }, { id: 'NSR:Quay:2', name: 'Sted B' }]);
  assert.equal(norm(12).severity, 'undefined');
});

test('isRelevant', () => {
  assert.equal(isRelevant(norm(1), NOW), true); // én aktiv periode
  assert.equal(isRelevant({ validity: [{ start: 1, end: NOW - 1 }] }, NOW), false);
  assert.equal(isRelevant(norm(2), NOW), true); // end: null
  assert.equal(isRelevant(norm(3), NOW), false); // starter om 30 t
  assert.equal(isRelevant({ validity: [{ start: NOW + 2 * 3600_000, end: null }] }, NOW), true);
});

test('sortering: alvorlighet, så linjenummer', () => {
  const idx = buildSituationIndex([norm(9), norm(1), norm(2), norm(10), norm(12), norm(7)].filter(Boolean));
  assert.equal(idx.all[0].severity, 'verySevere');
  assert.equal(idx.all.at(-1).severity, 'noImpact');
  const sev = idx.all.map((s) => s.severity);
  assert.ok(sev.indexOf('undefined') > sev.indexOf('normal'));
  const a = { severity: 'normal', id: 'a', lines: [{ code: '2' }] };
  const b = { severity: 'normal', id: 'b', lines: [{ code: '10' }] };
  assert.ok(compareSituations(a, b) < 0);
  assert.ok(compareSituations(b, a) > 0);
});

test('indekser per linje, holdeplass og kodeområde', () => {
  const idx = buildSituationIndex(raw.map(normalizeSituation).filter(Boolean));
  assert.equal(idx.byLine.get('RUT:Line:10').length, 2);
  assert.equal(idx.byStop.get('NSR:Quay:2').length, 2);
  assert.equal(idx.byCodespace.get('SKY').length, 2);
});

test('situationsForRegion: Bergen gir SKY og tog, ikke RUT', () => {
  const idx = buildSituationIndex(raw.map(normalizeSituation).filter(Boolean));
  const cs = new Set(situationsForRegion(idx, REGIONS.bergen).map((s) => s.codespace));
  assert.deepEqual([...cs].sort(), ['SKY', 'VYG']);
  assert.ok(new Set(situationsForRegion(idx, REGIONS.oslo).map((s) => s.codespace)).has('RUT'));
});

test('situationsForStop: union uten duplikater', () => {
  const idx = buildSituationIndex(raw.map(normalizeSituation).filter(Boolean));
  const got = situationsForStop(idx, ['NSR:Quay:2', 'NSR:StopPlace:1']);
  assert.deepEqual(got.map((s) => s.id).sort(), ['RUT:SituationNumber:8', 'RUT:SituationNumber:9']);
  assert.deepEqual(situationsForStop(idx, ['NSR:Quay:999']), []);
});

test('countsTowardBadge', () => {
  assert.equal(countsTowardBadge(norm(9)), false);
  assert.equal(countsTowardBadge(norm(2)), true);
});

test('områder', () => {
  assert.equal(areaFor('VYG').id, 'rail');
  assert.equal(areaFor('SKY').name, 'Skyss (Vestland)');
  assert.equal(areaFor('ZZZ').id, 'other');
  assert.ok(SITUATION_AREAS.every((a) => a.id && a.name && Array.isArray(a.codespaces)));
});

const noTarget = { situationNumber: 'NSB:SituationNumber:99', severity: 'normal', progress: 'open', validityPeriods: [],
  summary: [{ value: 'Færre vogner', language: 'NO' }], affects: { stopPoints: [], affectedLines: [] } };

test('NSB regnes som tog', () => {
  assert.equal(areaFor('NSB').id, 'rail');
});

test('kodeområde: raw.codespace foretrekkes, ellers prefiks', () => {
  assert.equal(normalizeSituation({ ...noTarget, codespace: 'VYG' }).codespace, 'VYG');
  assert.equal(normalizeSituation(noTarget).codespace, 'NSB');
});

test('avvik uten mål: i indeksen, men ikke i region eller liste', () => {
  const t = normalizeSituation(noTarget);
  assert.equal(hasTargets(t), false);
  assert.equal(hasTargets(norm(2)), true);
  assert.equal(hasTargets(norm(8)), true);
  const idx = buildSituationIndex([t, norm(2), norm(10)]);
  assert.equal(idx.all.length, 3);
  assert.equal(idx.byCodespace.get('NSB').length, 1);
  assert.ok(!situationsForRegion(idx, REGIONS.oslo).some((s) => s.id === t.id));
  assert.deepEqual(listableSituations(idx).map((s) => s.id).sort(), [norm(2).id, norm(10).id].sort());
});
