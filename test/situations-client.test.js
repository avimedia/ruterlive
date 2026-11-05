import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  badgeCount,
  situationsForLine,
  situationsForQuays,
  formatValidity,
  situationCardHtml,
  setSituations,
  getSituations,
  onSituationsChanged,
  fetchSituations,
  situationsSignature,
} from '../js/situations.js';

const NOW = Date.parse('2026-11-05T12:00:00Z');

const sit = (over) => ({
  id: 'RUT:SituationNumber:1',
  codespace: 'RUT',
  severity: 'normal',
  planned: false,
  validity: [],
  summary: 'Omkjøring',
  description: '',
  advice: '',
  links: [],
  lines: [],
  stops: [],
  ...over,
});

test('badgeCount: teller alle avvik i lista, også noImpact (Ruling 5)', () => {
  const list = [sit({ id: 'a' }), sit({ id: 'b', severity: 'noImpact' }), sit({ id: 'c', severity: 'severe' })];
  assert.equal(badgeCount(list), 3);
  assert.equal(badgeCount([]), 0);
  assert.equal(badgeCount(null), 0);
});

test('situationsForLine: treff på lineRef, ellers kodeområde + kode', () => {
  const byRef = sit({ id: 'ref', lines: [{ ref: 'RUT:Line:31', code: '31' }] });
  const byCode = sit({ id: 'code', lines: [{ ref: 'RUT:Line:INTERN-31', code: '31' }] });
  const otherSpace = sit({ id: 'sky', codespace: 'SKY', lines: [{ ref: 'SKY:Line:31', code: '31' }] });
  const otherLine = sit({ id: 'other', lines: [{ ref: 'RUT:Line:32', code: '32' }] });
  const list = [byRef, byCode, otherSpace, otherLine];
  assert.deepEqual(situationsForLine({ lineRef: 'RUT:Line:31', publicCode: '31', codespace: 'RUT' }, list).map((s) => s.id), ['ref', 'code']);
  // Uten kodeområde brukes prefikset i lineRef
  assert.deepEqual(situationsForLine({ lineRef: 'RUT:Line:31', publicCode: '31' }, list).map((s) => s.id), ['ref', 'code']);
  // Uten lineRef: bare kodeområde + kode
  assert.deepEqual(situationsForLine({ publicCode: '31', codespace: 'SKY' }, list).map((s) => s.id), ['sky']);
  // Vy-tog meldes som NSB
  const vy = sit({ id: 'nsb', codespace: 'NSB', lines: [{ ref: 'NSB:Line:L1', code: 'L1' }] });
  assert.deepEqual(situationsForLine({ publicCode: 'L1', codespace: 'VYG' }, [vy]).map((s) => s.id), ['nsb']);
  assert.deepEqual(situationsForLine({}, list), []);
});

test('situationsForQuays: union uten duplikater', () => {
  const a = sit({ id: 'a', stops: [{ id: 'NSR:Quay:1', name: 'A' }, { id: 'NSR:Quay:2', name: 'A' }] });
  const b = sit({ id: 'b', stops: [{ id: 'NSR:StopPlace:9', name: 'B' }] });
  assert.deepEqual(situationsForQuays(['NSR:Quay:1', 'NSR:Quay:2', 'NSR:StopPlace:9'], [a, b]).map((s) => s.id), ['a', 'b']);
  assert.deepEqual(situationsForQuays([], [a, b]), []);
});

test('formatValidity: åpen slutt, start i morgen, tom liste og flere perioder', () => {
  assert.equal(formatValidity([{ start: Date.parse('2026-11-03T07:00:00Z'), end: null }], NOW), 'Gjelder fra 3. nov. kl. 08.00 inntil videre');
  assert.equal(
    formatValidity([{ start: Date.parse('2026-11-06T05:00:00Z'), end: Date.parse('2026-11-06T09:00:00Z') }], NOW),
    'Gjelder fra i morgen kl. 06.00 til kl. 10.00',
  );
  assert.equal(formatValidity([], NOW), 'Gjelder inntil videre');
  assert.equal(formatValidity(null, NOW), 'Gjelder inntil videre');
  // Utløpte perioder hoppes over; flere igjen gir «og N perioder til»
  const periods = [
    { start: Date.parse('2026-11-01T07:00:00Z'), end: Date.parse('2026-11-01T09:00:00Z') },
    { start: Date.parse('2026-11-05T13:00:00Z'), end: Date.parse('2026-11-05T15:00:00Z') },
    { start: Date.parse('2026-11-12T13:00:00Z'), end: Date.parse('2026-11-12T15:00:00Z') },
  ];
  assert.equal(formatValidity(periods, NOW), 'Gjelder fra i dag kl. 14.00 til kl. 16.00 (og 1 periode til)');
});

test('situationCardHtml: escaper tekst og dropper lenker som ikke er http(s)', () => {
  const html = situationCardHtml(sit({
    summary: '<img src=x onerror=alert(1)>',
    description: 'Første linje\n<b>andre</b>',
    advice: 'Bruk "buss" & trikk',
    links: ['javascript:alert(1)', 'https://ruter.no/avvik?a=1&b=2', 'data:text/html,hei'],
    lines: [{ ref: 'RUT:Line:31', code: '31"><script>' }],
    stops: [{ id: 'NSR:Quay:1', name: '<Jernbanetorget>' }],
  }), { now: NOW });
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('Første linje<br>&lt;b&gt;andre&lt;/b&gt;'));
  assert.ok(html.includes('Bruk &quot;buss&quot; &amp; trikk'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;Jernbanetorget&gt;'));
  assert.ok(!html.includes('javascript:'));
  assert.ok(!html.includes('data:text'));
  assert.ok(html.includes('href="https://ruter.no/avvik?a=1&amp;b=2"'));
  assert.ok(html.includes('rel="noopener nofollow"'));
  assert.ok(html.includes('target="_blank"'));
  assert.ok(html.includes('data-line-index="0"'));
  assert.ok(html.includes('Vis mer'));
});

test('situationCardHtml: uten mer tekst ingen «Vis mer»', () => {
  const html = situationCardHtml(sit({ summary: 'Kort' }), { now: NOW });
  assert.ok(!html.includes('Vis mer'));
});

test('setSituations varsler lyttere; fetchSituations er stille ved feil', async () => {
  const seen = [];
  const off = onSituationsChanged((list) => seen.push(list.length));
  setSituations([sit({ id: 'x' })]);
  assert.equal(getSituations().length, 1);
  off();
  setSituations([]);
  assert.deepEqual(seen, [1]);

  setSituations([sit({ id: 'y' })]);
  assert.equal(await fetchSituations(async () => ({ ok: false, status: 404, json: async () => ({}) })), false);
  assert.equal(await fetchSituations(async () => { throw new Error('nett'); }), false);
  assert.equal(await fetchSituations(async () => ({ ok: true, json: async () => '<html>' })), false);
  assert.equal(getSituations().length, 1, 'feil beholder forrige liste');
  assert.equal(await fetchSituations(async (url) => {
    assert.equal(url, '/api/situations');
    return { ok: true, json: async () => ({ updatedAt: 1, situations: [sit({ id: 'z' }), sit({ id: 'w' })] }) };
  }), true);
  assert.equal(getSituations().length, 2);
});

test('fetchSituations: uendret svar (samme updatedAt og id-er) gir ingen endringshendelse', async () => {
  const data = { updatedAt: 42, situations: [sit({ id: 'a' }), sit({ id: 'b' })] };
  const reply = (d) => async () => ({ ok: true, json: async () => d });
  assert.equal(situationsSignature(data), situationsSignature({ ...data, situations: data.situations.map((s) => ({ ...s })) }));
  assert.notEqual(situationsSignature(data), situationsSignature({ ...data, updatedAt: 43 }));
  assert.notEqual(situationsSignature(data), situationsSignature({ ...data, situations: [data.situations[0]] }));
  let events = 0;
  const off = onSituationsChanged(() => { events += 1; });
  assert.equal(await fetchSituations(reply(data)), true);
  assert.equal(await fetchSituations(reply({ ...data })), true);
  assert.equal(events, 1);
  assert.equal(await fetchSituations(reply({ ...data, updatedAt: 43 })), true);
  assert.equal(events, 2);
  off();
});

test('situationNoteHtml: tom uten avvik, maks 2 + «og N til», escaper', async () => {
  const { situationNoteHtml, lineKeyFromCall, lineKeyFromVehicle } = await import('../js/situations.js');
  assert.equal(situationNoteHtml([]), '');
  assert.equal(situationNoteHtml(null), '');
  const three = [sit({ summary: 'A' }), sit({ summary: 'B' }), sit({ summary: 'C' })];
  const html = situationNoteHtml(three);
  assert.match(html, /Avvik på linja/);
  assert.match(html, /<li>A<\/li><li>B<\/li>/);
  assert.doesNotMatch(html, /<li>C<\/li>/);
  assert.match(html, /og 1 til/);
  assert.doesNotMatch(situationNoteHtml(three.slice(0, 2)), /og \d+ til/);
  const evil = situationNoteHtml([sit({ summary: '<img onerror=x>' })], { title: '<b>' });
  assert.doesNotMatch(evil, /<img|<b>/);
  assert.deepEqual(lineKeyFromCall({ serviceJourney: { journeyPattern: { line: { id: 'RUT:Line:31', publicCode: '31' } } } }), { lineRef: 'RUT:Line:31', publicCode: '31' });
  assert.deepEqual(lineKeyFromVehicle({ line: { ref: 'RUT:Line:31', publicCode: '31' } }), { lineRef: 'RUT:Line:31', publicCode: '31' });
  assert.deepEqual(lineKeyFromVehicle({ line: { lineRef: 'X:Line:1', publicCode: '1' } }), { lineRef: 'X:Line:1', publicCode: '1' });
});
