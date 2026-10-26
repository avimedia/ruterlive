import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LINES } from '../server/line-catalog.js';
import { LINE_LIST, matchLines, parseLineQuery, chipLabel, parseLineParam } from '../shared/line-list.js';

test('LINE_LIST samsvarer med server/line-catalog.js', () => {
  const key = (l) => `${l.mode}|${l.code}|${[...(l.aliases || [])].join(',')}|${l.title}`;
  assert.deepEqual(LINE_LIST.map(key), LINES.map(key));
});

test('kode treffer uavhengig av store/små bokstaver og mellomrom', () => {
  assert.deepEqual(matchLines('31').map((l) => l.code), ['31']);
  assert.equal(matchLines('FB1')[0].code, 'FB1');
  assert.equal(matchLines('fb 1')[0].code, 'FB1');
  assert.equal(matchLines(' l1 ')[0].code, 'L1');
  assert.equal(matchLines('re11')[0].code, 'RE11');
  assert.equal(matchLines('RX11')[0].code, 'RE11');
});

test('modusord begrenser treffene', () => {
  assert.deepEqual(parseLineQuery('Trikk 13'), { mode: 'tram', rest: '13' });
  assert.deepEqual(matchLines('trikk 13').map((l) => `${l.mode}${l.code}`), ['tram13']);
  assert.deepEqual(matchLines('T-bane 5').map((l) => `${l.mode}${l.code}`), ['metro5']);
  assert.deepEqual(matchLines('t5').map((l) => `${l.mode}${l.code}`), ['metro5']);
  assert.deepEqual(matchLines('buss 31').map((l) => l.mode), ['bus']);
  assert.ok(matchLines('tog').every((l) => l.mode === 'rail'));
});

test('13 gir trikk foran buss (moduslisten), også for live-linjer', () => {
  const res = matchLines('13', [{ code: '13', mode: 'bus' }]);
  assert.deepEqual(res.map((l) => l.mode), ['tram', 'bus']);
  assert.equal(matchLines('13', [{ code: '13', mode: 'tram' }]).length, 1); // ingen duplikat
});

test('live-linjer som ikke er i listen får treff', () => {
  const res = matchLines('785', [{ code: '785', mode: 'bus' }]);
  assert.equal(res[0].title, 'Buss 785');
});

test('ett tegn krever eksakt treff, to tegn starter-med', () => {
  assert.deepEqual(matchLines('3').map((l) => l.code), ['3']);
  assert.equal(matchLines('fb').length, 3);
  assert.deepEqual(matchLines(''), []);
});

test('chip-etikett', () => {
  assert.equal(chipLabel({ code: '31', mode: 'bus' }), 'Linje 31');
});

test('?linje= gir linje', () => {
  assert.equal(parseLineParam('?linje=31').code, '31');
  assert.equal(parseLineParam('?lat=1&linje=fb1').code, 'FB1');
  assert.equal(parseLineParam('?linje=999'), null);
  assert.equal(parseLineParam('?lat=1'), null);
  assert.equal(parseLineParam(''), null);
});
