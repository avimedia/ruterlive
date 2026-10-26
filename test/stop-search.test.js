import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findCandidates,
  groupPlaces,
  finishPlaces,
  applyLocalities,
  formatLocality,
  sortLines,
  lineMode,
  parseQuay,
  placeHeader,
  createStopPlaceLookup,
  INFO_TTL_MS,
  NEGATIVE_TTL_MS,
} from '../server/stop-search.js';
import { formatDistance, groupLinesByMode, lineBadgesHtml } from '../js/stop-place-format.js';

// GTFS-utdrag: fire «Bjerke»-quays i Oslo, to i Lillestrøm, én «Bjerke bru» og én «Nedre Bjerke»
const gtfs = new Map([
  ['NSR:Quay:11015', { lat: 59.9428, lon: 10.8097, name: 'Bjerke' }],
  ['NSR:Quay:10988', { lat: 59.9426, lon: 10.8092, name: 'Bjerke' }],
  ['NSR:Quay:10985', { lat: 59.9424, lon: 10.8094, name: 'Bjerke' }],
  ['NSR:Quay:11020', { lat: 59.9429, lon: 10.8099, name: 'Bjerke' }],
  ['NSR:Quay:6001', { lat: 59.98, lon: 11.05, name: 'Bjerke' }],
  ['NSR:Quay:6002', { lat: 59.9802, lon: 11.0503, name: 'Bjerke' }],
  ['NSR:Quay:7001', { lat: 60.17, lon: 10.25, name: 'Bjerke bru' }],
  ['NSR:Quay:8001', { lat: 59.95, lon: 10.8, name: 'Nedre Bjerke' }],
  ['NSR:Quay:9001', { lat: 59.91, lon: 10.75, name: 'Jernbanetorget' }],
]);

const jpQuay = (id, sp, { publicCode = '', description = null, lines = [] } = {}) => ({
  id,
  name: sp.name,
  publicCode,
  description,
  latitude: gtfs.get(id)?.lat,
  longitude: gtfs.get(id)?.lon,
  stopPlace: { id: sp.id, name: sp.name, latitude: sp.lat, longitude: sp.lon },
  lines: lines.map(([publicCode, transportMode]) => ({ publicCode, transportMode })),
});

const OSLO = { id: 'NSR:StopPlace:6006', name: 'Bjerke', lat: 59.9426, lon: 10.8095 };
const LSK = { id: 'NSR:StopPlace:4063', name: 'Bjerke', lat: 59.9801, lon: 11.0501 };
const BRU = { id: 'NSR:StopPlace:17120', name: 'Bjerke bru', lat: 60.17, lon: 10.25 };
const NEDRE = { id: 'NSR:StopPlace:9', name: 'Nedre Bjerke', lat: 59.95, lon: 10.8 };

const JP_QUAYS = [
  jpQuay('NSR:Quay:11015', OSLO, { description: 'påkjøringsrampe mot Grorud', lines: [['380', 'bus'], ['FB1', 'bus']] }),
  jpQuay('NSR:Quay:10988', OSLO, { description: 'avkjøringsrampe fra sentrum', lines: [['31', 'bus'], ['26', 'bus'], ['31B', 'bus']] }),
  jpQuay('NSR:Quay:10985', OSLO, { description: 'påkjøringsrampe mot sentrum', lines: [['31', 'bus'], ['380', 'bus']] }),
  jpQuay('NSR:Quay:11020', OSLO, { lines: [['FB1', 'coach']] }),
  jpQuay('NSR:Quay:6001', LSK, { publicCode: 'A', lines: [['110', 'bus']] }),
  jpQuay('NSR:Quay:6002', LSK, { publicCode: 'B', lines: [['110', 'bus']] }),
  jpQuay('NSR:Quay:7001', BRU, { lines: [['221', 'bus']] }),
  jpQuay('NSR:Quay:8001', NEDRE, { lines: [['4', 'metro'], ['25', 'bus']] }),
];

const LOCALITIES = new Map([
  [OSLO.id, { locality: 'Oslo', county: 'Oslo' }],
  [LSK.id, { locality: 'Lillestrøm', county: 'Akershus' }],
  [BRU.id, { locality: 'Ringerike', county: 'Buskerud' }],
]);

const infos = new Map(JP_QUAYS.map((q) => [q.id, parseQuay(q)]));

test('findCandidates: samme navn før prefiks før ordtreff, så nærmest; kutter ved limit', () => {
  const c = findCandidates(gtfs, 'bjerke', { lat: 59.91, lng: 10.75 });
  assert.equal(c.length, 8);
  assert.deepEqual([...new Set(c.map((x) => x.name))], ['Bjerke', 'Bjerke bru', 'Nedre Bjerke']);
  assert.equal(c[0].id, 'NSR:Quay:10985'); // nærmeste Bjerke-quay
  assert.ok(c.slice(0, 4).every((x) => x.lon < 11), 'Oslo-quays før Lillestrøm');
  assert.equal(findCandidates(gtfs, 'bjerke', { limit: 3 }).length, 3);
  assert.deepEqual(findCandidates(gtfs, 'b'), []);
  // Uten posisjon: alfabetisk innen samme nivå
  assert.deepEqual(findCandidates(gtfs, 'bjerke').slice(0, 2).map((x) => x.id), ['NSR:Quay:6001', 'NSR:Quay:6002']);
});

test('groupPlaces + finishPlaces: ett treff per stoppested, sortert på nivå og avstand', () => {
  const pos = { lat: 59.91, lng: 10.75 };
  const places = applyLocalities(groupPlaces(findCandidates(gtfs, 'bjerke', pos), infos), LOCALITIES);
  const out = finishPlaces(places, pos);
  assert.deepEqual(out.map((p) => `${p.name}|${p.locality}`), ['Bjerke|Oslo', 'Bjerke|Lillestrøm', 'Bjerke bru|Ringerike', 'Nedre Bjerke|null']);
  const oslo = out[0];
  assert.equal(oslo.stopPlaceId, OSLO.id);
  assert.equal(oslo.quays.length, 4);
  assert.equal(oslo.lat, OSLO.lat);
  assert.deepEqual(oslo.modes, ['flybuss', 'bus']);
  assert.deepEqual(oslo.lines.map((l) => l.code), ['FB1', '26', '31', '31B', '380']);
  assert.equal(oslo.displayName, 'Bjerke (Oslo)');
  assert.equal(oslo.id, oslo.quays[0].id);
  assert.ok(oslo.distanceKm > 3 && oslo.distanceKm < 5, String(oslo.distanceKm));
  const q = oslo.quays.find((x) => x.id === 'NSR:Quay:11015');
  assert.deepEqual(q.lines, ['FB1', '380']);
  assert.equal(q.description, 'påkjøringsrampe mot Grorud');
  // Uten posisjon: navn, distanceKm null
  const byName = finishPlaces(applyLocalities(groupPlaces(findCandidates(gtfs, 'bjerke'), infos), LOCALITIES));
  assert.deepEqual(byName.map((p) => p.locality), ['Lillestrøm', 'Oslo', 'Ringerike', null]);
  assert.equal(byName[0].distanceKm, null);
  assert.equal(finishPlaces(places.slice(), { ...pos, limit: 2 }).length, 2);
});

test('groupPlaces: quays uten JP-data grupperes på navn og nærhet', () => {
  const out = groupPlaces(findCandidates(gtfs, 'bjerke'), new Map());
  const bjerke = out.filter((p) => p.name === 'Bjerke');
  assert.equal(bjerke.length, 2);
  assert.deepEqual(bjerke.map((p) => p.quays.length).sort(), [2, 4]);
  assert.ok(bjerke.every((p) => p.stopPlaceId === null && p.lines.length === 0));
});

test('formatLocality: fylke bare når kommunenavnet er tvetydig blant treffene', () => {
  assert.equal(formatLocality({ locality: 'Oslo', county: 'Oslo' }, true), 'Oslo');
  assert.equal(formatLocality({ locality: 'Våler', county: 'Østfold' }, true), 'Våler, Østfold');
  assert.equal(formatLocality({ locality: 'Våler', county: 'Østfold' }), 'Våler');
  assert.equal(formatLocality(null), null);
  const places = [{ stopPlaceId: 'a' }, { stopPlaceId: 'b' }, { stopPlaceId: 'c' }, { stopPlaceId: null }];
  applyLocalities(places, new Map([
    ['a', { locality: 'Våler', county: 'Østfold' }],
    ['b', { locality: 'Våler', county: 'Innlandet' }],
    ['c', { locality: 'Oslo', county: 'Oslo' }],
  ]));
  assert.deepEqual(places.map((p) => p.locality), ['Våler, Østfold', 'Våler, Innlandet', 'Oslo', null]);
});

test('sortLines og lineMode: unike, modus først, så numerisk', () => {
  assert.equal(lineMode('coach', 'FB2'), 'flybuss');
  assert.equal(lineMode('rail', 'FLY1'), 'flytog');
  assert.equal(lineMode('rail', 'R12'), 'rail');
  assert.equal(lineMode('ferry', 'B10'), 'water');
  const lines = sortLines([
    { code: '110', mode: 'bus' }, { code: '25', mode: 'bus' }, { code: '4', mode: 'metro' },
    { code: '25', mode: 'bus' }, { code: '17', mode: 'tram' }, { code: '5', mode: 'metro' }, { code: '31E', mode: 'bus' }, { code: '31', mode: 'bus' },
  ]);
  assert.deepEqual(lines.map((l) => `${l.mode}:${l.code}`), ['metro:4', 'metro:5', 'tram:17', 'bus:25', 'bus:31', 'bus:31E', 'bus:110']);
});

test('placeHeader: stoppestedet med flest quays, kommune og alle linjer', () => {
  const h = placeHeader(['NSR:Quay:10985', 'NSR:Quay:11015', 'NSR:Quay:999'], infos, LOCALITIES);
  assert.equal(h.name, 'Bjerke');
  assert.equal(h.locality, 'Oslo');
  assert.deepEqual(h.lines.map((l) => l.code), ['FB1', '31', '380']);
  assert.equal(placeHeader(['NSR:Quay:999'], infos, LOCALITIES), null);
});

function fakeEntur() {
  const calls = { jp: [], geo: [] };
  const fetchFn = async (url, init) => {
    if (String(url).includes('geocoder')) {
      const ids = new URL(url).searchParams.get('ids').split(',');
      calls.geo.push(ids);
      assert.equal(init.headers['ET-Client-Name'], 'ruterlive-web');
      return {
        ok: true,
        json: async () => ({
          features: ids.filter((id) => LOCALITIES.has(id)).map((id) => ({ properties: { id, ...LOCALITIES.get(id) } })),
        }),
      };
    }
    const body = JSON.parse(init.body);
    calls.jp.push(body.variables.ids);
    assert.equal(init.headers['ET-Client-Name'], 'ruterlive-web');
    return { ok: true, json: async () => ({ data: { quays: JP_QUAYS.filter((q) => body.variables.ids.includes(q.id)) } }) };
  };
  return { calls, fetchFn };
}

test('lookup: ett JP-kall og ett geocoder-kall per søk, gjentatte søk fra cache', async () => {
  const { calls, fetchFn } = fakeEntur();
  let t = 0;
  const lookup = createStopPlaceLookup({ fetchFn, now: () => t });
  const [a, b] = await Promise.all([
    lookup.search(gtfs, 'bjerke', { lat: 59.91, lng: 10.75 }),
    lookup.search(gtfs, 'bjerke', { lat: 59.91, lng: 10.75 }),
  ]);
  assert.deepEqual(a, b);
  assert.equal(a[0].locality, 'Oslo');
  assert.equal(calls.jp.length, 1, 'samtidige søk deler ett JP-kall');
  assert.equal(calls.geo.length, 1);
  for (let i = 0; i < 5; i++) await lookup.search(gtfs, 'bjerke', { lat: 59.91, lng: 10.75 });
  assert.equal(calls.jp.length, 1);
  // Overskrift for tavla fra samme cache
  const h = await lookup.header(['NSR:Quay:10985']);
  assert.equal(h.locality, 'Oslo');
  assert.equal(calls.jp.length, 1);
  // Nye quays hentes, kjente ikke
  await lookup.search(gtfs, 'jernbanetorget');
  assert.deepEqual(calls.jp[1], ['NSR:Quay:9001']);
  // Ukjent quay (negativ) prøves igjen først etter 10 min; kjente etter 24 t
  t += NEGATIVE_TTL_MS - 1;
  await lookup.search(gtfs, 'jernbanetorget');
  assert.equal(calls.jp.length, 2);
  t += 2;
  await lookup.search(gtfs, 'jernbanetorget');
  assert.equal(calls.jp.length, 3);
  await lookup.search(gtfs, 'bjerke');
  assert.equal(calls.jp.length, 3);
  t = INFO_TTL_MS + 1;
  await lookup.search(gtfs, 'bjerke');
  assert.equal(calls.jp.length, 4);
  assert.equal(lookup.stats.jp, 4);
});

test('lookup: JP-feil gir navnegruppering og kort negativ cache', async () => {
  let n = 0;
  let t = 0;
  const lookup = createStopPlaceLookup({
    fetchFn: async () => { n++; throw new Error('nede'); },
    now: () => t,
  });
  const out = await lookup.search(gtfs, 'bjerke');
  assert.equal(out.filter((p) => p.name === 'Bjerke').length, 2);
  await lookup.search(gtfs, 'bjerke');
  assert.equal(n, 1);
  t += NEGATIVE_TTL_MS + 1;
  await lookup.search(gtfs, 'bjerke');
  assert.equal(n, 2);
});

test('lookup: seedQuays fra avgangskallet gjør overskriften gratis', async () => {
  const { calls, fetchFn } = fakeEntur();
  const lookup = createStopPlaceLookup({ fetchFn });
  lookup.seedQuays([JP_QUAYS[0]], ['NSR:Quay:11015', 'NSR:Quay:123']);
  const h = await lookup.header(['NSR:Quay:11015', 'NSR:Quay:123']);
  assert.equal(h.name, 'Bjerke');
  assert.equal(calls.jp.length, 0);
  assert.equal(calls.geo.length, 1);
});

test('lookup: tidsavbrudd på hengende JP-kall', async () => {
  const lookup = createStopPlaceLookup({ fetchFn: () => new Promise(() => {}), timeoutMs: 20 });
  const out = await lookup.search(gtfs, 'nedre');
  assert.equal(out.length, 1);
  assert.equal(out[0].stopPlaceId, null);
});

test('klientformatering: avstand, linjegrupper og merker', () => {
  assert.equal(formatDistance(1.234), '1,2 km');
  assert.equal(formatDistance(0.43), '430 m');
  assert.equal(formatDistance(23.6), '24 km');
  assert.equal(formatDistance(null), '');
  assert.deepEqual(groupLinesByMode([{ code: '31', mode: 'bus' }, { code: '4', mode: 'metro' }, { code: '31', mode: 'bus' }]), [
    { mode: 'metro', codes: ['4'] },
    { mode: 'bus', codes: ['31'] },
  ]);
  const html = lineBadgesHtml([{ code: '17', mode: 'tram' }, { code: '<b>', mode: 'bus' }, { code: '20', mode: 'bus' }], { max: 2 });
  assert.match(html, /mini-badge--dark[^>]*>17</);
  assert.match(html, /&lt;b&gt;/);
  assert.match(html, /\+1/);
  assert.equal(lineBadgesHtml([]), '');
});

test('stoppestedets linjer fra alle quays: samme overskrift fra én quay som fra søket', () => {
  const sp = { ...OSLO, quays: [{ lines: [{ publicCode: '31', transportMode: 'bus' }] }, { lines: [{ publicCode: 'FB1', transportMode: 'coach' }, { publicCode: '26', transportMode: 'bus' }] }] };
  const q = (id) => ({ ...jpQuay(id, OSLO), stopPlace: { id: sp.id, name: sp.name, latitude: sp.lat, longitude: sp.lon, quays: sp.quays } });
  const places = new Map();
  const a = parseQuay(q('NSR:Quay:10985'), places);
  const b = parseQuay(q('NSR:Quay:10988'), places);
  assert.equal(a.stopPlace, b.stopPlace, 'delt objekt per stoppested');
  const m = new Map([[a.id, a], [b.id, b]]);
  const h = placeHeader([a.id], m, LOCALITIES);
  assert.deepEqual(h.lines.map((l) => l.code), ['FB1', '26', '31']);
  const [place] = groupPlaces(findCandidates(gtfs, 'bjerke').filter((c) => m.has(c.id)), m);
  assert.deepEqual(place.lines, h.lines);
});
