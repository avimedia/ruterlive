import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LINES } from '../server/line-catalog.js';
import {
  LINE_LIST,
  matchLines,
  parseLineQuery,
  chipLabel,
  parseLineParam,
  lineHighlightOf,
  vehicleOnLine,
  preferredAuthority,
} from '../shared/line-list.js';

test('LINE_LIST samsvarer med server/line-catalog.js', () => {
  const key = (l) => `${l.mode}|${l.code}|${[...(l.aliases || [])].join(',')}|${l.title}|${l.authority}`;
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

const bus = (code, ref) => ({ mode: 'bus', line: ref === undefined ? { publicCode: code } : { publicCode: code, lineRef: ref } });

test('linjetreff foretrekker linjas authority når kjøretøyet har linje-ID', () => {
  const h = lineHighlightOf(matchLines('buss 31')[0]);
  assert.equal(h.authority, 'RUT');
  assert.equal(vehicleOnLine(bus('31', 'RUT:Line:31'), 'bus', h), true);
  assert.equal(vehicleOnLine({ mode: 'bus', line: { publicCode: '31', ref: 'RUT:Line:31' } }, 'bus', h), true);
  assert.equal(vehicleOnLine(bus('31', 'VKT:Line:31_x'), 'bus', h), false);
  assert.equal(vehicleOnLine(bus('31'), 'bus', h), true); // uten linje-ID: kode og modus
  assert.equal(vehicleOnLine(bus('31', null), 'bus', h), true);
  assert.equal(vehicleOnLine(bus('32', 'RUT:Line:32'), 'bus', h), false);
  assert.equal(vehicleOnLine(bus('31', 'RUT:Line:31'), 'tram', h), false);
  assert.equal(vehicleOnLine(bus('031', 'RUT:Line:31'), 'bus', h), true);
});

test('linjetreff for andre authorities og alias', () => {
  const fb = lineHighlightOf(matchLines('FB1')[0]);
  assert.equal(fb.authority, 'NBU');
  assert.equal(vehicleOnLine(bus('FB1', 'NBU:Line:FB1'), 'flybuss', fb), true);
  assert.equal(vehicleOnLine(bus('FB1', 'RUT:Line:FB1'), 'flybuss', fb), false);
  const l2 = lineHighlightOf(matchLines('L2')[0]);
  assert.equal(vehicleOnLine({ mode: 'rail', line: { publicCode: 'L2x', lineRef: 'VYG:Line:L2x' } }, 'rail', l2), true);
  // Brakar-linje 4 er buss, ikke T-bane 4
  const t4 = lineHighlightOf(matchLines('t4')[0]);
  assert.equal(vehicleOnLine(bus('4', 'BRA:Line:4_6022'), 'bus', t4), false);
  assert.equal(vehicleOnLine({ mode: 'metro', line: { publicCode: '4', lineRef: 'BRA:Line:4_6022' } }, 'metro', t4), false);
});

test('live-linjer utenfor listen får authority fra kjøretøyene (RUT først)', () => {
  assert.equal(preferredAuthority(['VKT', 'RUT']), 'RUT');
  assert.equal(preferredAuthority(['BRA']), 'BRA');
  assert.equal(preferredAuthority(['BRA', 'VKT']), null);
  assert.equal(preferredAuthority([]), null);
  const live = matchLines('785', [{ code: '785', mode: 'bus', authority: 'RUT' }])[0];
  assert.equal(lineHighlightOf(live).authority, 'RUT');
  const none = matchLines('786', [{ code: '786', mode: 'bus', authority: null }])[0];
  assert.equal(vehicleOnLine(bus('786', 'BRA:Line:786'), 'bus', lineHighlightOf(none)), true);
});
