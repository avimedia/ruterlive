import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEtStreamParser, parseEtJourneys } from '../server/et-parse.js';
import {
  trainKey,
  railLineCode,
  selectRailJourneys,
  railJourneyToVehicle,
  createQuayCoords,
  createRailEtService,
} from '../server/rail-et-service.js';
import { normalizeRailVehicles, createRailVehiclesCache, EMPTY_RAIL } from '../server/rail-vehicles-cache.js';
import { gpsTrainKeys, mergeRailVehicles, createRailLive } from '../server/rail-live.js';
import {
  pickRailLines,
  choosePatterns,
  buildRailShapes,
  snapToNetwork,
  snapUnsnapped,
  createRailNetworkService,
} from '../server/rail-network.js';
import { applyLineGeometry } from '../server/line-geometry.js';
import { matchRouteForVehicle } from '../shared/route-match.js';

const T0 = Date.parse('2026-10-26T15:00:00Z');
const iso = (min) => new Date(T0 + min * 60000).toISOString();

// --- ET-parser for BNR ---

const bnrXml = `<Siri><ServiceDelivery><EstimatedTimetableDelivery><EstimatedJourneyVersionFrame>
<EstimatedVehicleJourney><LineRef>SJN:Line:R70</LineRef><DatedVehicleJourneyRef>441:2026-10-26</DatedVehicleJourneyRef>
<DestinationName>Steinkjer</DestinationName><VehicleRef>441</VehicleRef>
<RecordedCalls><RecordedCall><StopPointRef>NSR:Quay:1</StopPointRef><StopPointName>Trondheim S</StopPointName><ActualDepartureTime>${iso(-10)}</ActualDepartureTime></RecordedCall></RecordedCalls>
<EstimatedCalls>
<EstimatedCall><StopPointRef>NSR:Quay:2</StopPointRef><StopPointName>Lademoen</StopPointName><Cancellation>true</Cancellation><ExpectedArrivalTime>${iso(-2)}</ExpectedArrivalTime><ExpectedDepartureTime>${iso(-1)}</ExpectedDepartureTime></EstimatedCall>
<EstimatedCall><StopPointRef>NSR:Quay:3</StopPointRef><StopPointName>Stjørdal</StopPointName><AimedArrivalTime>${iso(5)}</AimedArrivalTime><ExpectedArrivalTime>${iso(10)}</ExpectedArrivalTime><ExpectedDepartureTime>${iso(11)}</ExpectedDepartureTime></EstimatedCall>
<EstimatedCall><StopPointRef>NSR:Quay:4</StopPointRef><StopPointName>Steinkjer</StopPointName><ExpectedArrivalTime>${iso(60)}</ExpectedArrivalTime></EstimatedCall>
</EstimatedCalls></EstimatedVehicleJourney>
<EstimatedVehicleJourney><LineRef>SJV:Line:F1</LineRef><DatedVehicleJourneyRef>638:2026-10-26</DatedVehicleJourneyRef><Cancellation>true</Cancellation>
<EstimatedCalls><EstimatedCall><StopPointRef>NSR:Quay:9</StopPointRef><StopPointName>Oslo S</StopPointName><ExpectedDepartureTime>${iso(0)}</ExpectedDepartureTime></EstimatedCall>
<EstimatedCall><StopPointRef>NSR:Quay:8</StopPointRef><StopPointName>Lillestrøm</StopPointName><ExpectedArrivalTime>${iso(20)}</ExpectedArrivalTime></EstimatedCall></EstimatedCalls></EstimatedVehicleJourney>
<EstimatedVehicleJourney><LineRef>XYZ:Line:25</LineRef><DatedVehicleJourneyRef>25:2026-10-26</DatedVehicleJourneyRef>
<EstimatedCalls><EstimatedCall><StopPointRef>NSR:Quay:5</StopPointRef><StopPointName>A</StopPointName><ExpectedDepartureTime>${iso(0)}</ExpectedDepartureTime></EstimatedCall></EstimatedCalls></EstimatedVehicleJourney>
</EstimatedJourneyVersionFrame></EstimatedTimetableDelivery></ServiceDelivery></Siri>`;

function parseBnr(xml = bnrXml) {
  const p = createEtStreamParser({ mode: 'rail', skipCancelled: true });
  for (let i = 0; i < xml.length; i += 97) p.push(xml.slice(i, i + 97)); // vilkårlige biter
  return p.end();
}

test('BNR-parser: fast modus rail, innstilte turer og kall hoppes over', () => {
  const js = parseBnr();
  assert.deepEqual(js.map((j) => j.lineRef), ['SJN:Line:R70', 'XYZ:Line:25']);
  assert.ok(js.every((j) => j.mode === 'rail'), 'linjenummer 25 skal ikke bli buss');
  assert.deepEqual(js[0].estimatedCalls.map((c) => c.quayId), ['NSR:Quay:3', 'NSR:Quay:4']);
  assert.equal(js[0].estimatedCalls[0].delay, 300);
});

test('ET-parser uten valg: uendret oppførsel (R70 uten tall hoppes over, innstilte kall beholdes)', () => {
  const js = parseEtJourneys(bnrXml);
  assert.deepEqual(js.map((j) => j.lineRef), ['XYZ:Line:25']);
  assert.equal(js[0].mode, 'bus');
});

test('trainKey og railLineCode', () => {
  assert.equal(trainKey('1793:2026-10-26'), '1793|2026-10-26');
  assert.equal(trainKey('320-2026-10-26'), '320|2026-10-26');
  assert.equal(trainKey('71-12'), null);
  assert.equal(trainKey('RUT:VehicleRef:123'), null);
  assert.equal(railLineCode('SJN:Line:R70'), 'R70');
  assert.equal(railLineCode('TM:Line:-'), null);
});

const journey = (over = {}) => ({
  vehicleId: '441',
  mode: 'rail',
  lineRef: 'SJN:Line:R70',
  destinationName: 'Steinkjer',
  datedVehicleJourneyRef: '441:2026-10-26',
  recordedCalls: [{ quayId: 'Q1', name: 'Trondheim S', time: T0 - 10 * 60000 }],
  estimatedCalls: [
    { quayId: 'Q2', name: 'Stjørdal', arrTime: T0 + 10 * 60000, depTime: T0 + 11 * 60000, delay: 120 },
    { quayId: 'Q3', name: 'Steinkjer', arrTime: T0 + 60 * 60000, depTime: T0 + 60 * 60000, delay: 0 },
  ],
  ...over,
});

test('selectRailJourneys: bare tog i gang eller like før avgang, uten GPS-dubletter', () => {
  const later = journey({
    datedVehicleJourneyRef: '445:2026-10-26',
    recordedCalls: [],
    estimatedCalls: [{ quayId: 'Q1', name: 'T', depTime: T0 + 3 * 3600000, arrTime: T0 + 3 * 3600000 }, { quayId: 'Q2', name: 'S', arrTime: T0 + 4 * 3600000 }],
  });
  const soon = journey({
    datedVehicleJourneyRef: '447:2026-10-26',
    recordedCalls: [],
    estimatedCalls: [{ quayId: 'Q1', name: 'T', depTime: T0 + 5 * 60000, arrTime: T0 + 5 * 60000 }, { quayId: 'Q2', name: 'S', arrTime: T0 + 40 * 60000 }],
  });
  const done = journey({ datedVehicleJourneyRef: '440:2026-10-26', estimatedCalls: [{ quayId: 'Q3', name: 'S', arrTime: T0 - 5 * 60000 }] });
  const withGps = journey({ datedVehicleJourneyRef: '320:2026-10-26' });
  const out = selectRailJourneys([journey(), later, soon, done, withGps, journey()], T0, new Set(['320|2026-10-26']));
  assert.deepEqual(out.map((j) => j.datedVehicleJourneyRef), ['441:2026-10-26', '447:2026-10-26']);
});

test('railJourneyToVehicle: interpolert posisjon, modus rail, linjekode fra lineRef', () => {
  const coords = { Q1: [63.43, 10.4], Q2: [63.46, 10.92], Q3: [64.01, 11.49] };
  const v = railJourneyToVehicle(journey(), (q) => coords[q], T0);
  assert.equal(v.vehicleId, 'BNR:441:2026-10-26');
  assert.equal(v.mode, 'rail');
  assert.equal(v.line.publicCode, 'R70');
  assert.equal(v.from, 'Trondheim S');
  assert.equal(v.to, 'Steinkjer');
  assert.equal(v.nextStop, 'Stjørdal');
  assert.equal(v.delay, 120);
  // Halvveis mellom Trondheim (−10 min) og Stjørdal (+10 min)
  assert.ok(Math.abs(v.location.latitude - 63.445) < 1e-3, `lat ${v.location.latitude}`);
  assert.ok(v.path.length >= 2);
  assert.equal(railJourneyToVehicle(journey(), () => undefined, T0), null);
  const tm = railJourneyToVehicle(journey({ lineRef: 'TM:Line:-' }), (q) => coords[q], T0);
  assert.equal(tm.line.publicCode, null);
  assert.equal(tm.mode, 'rail');
});

test('createQuayCoords: GTFS først, resten fra JP i grupper, cachet', async () => {
  const calls = [];
  const jpFetch = async (q) => {
    calls.push(q);
    const out = {};
    const ids = [...q.matchAll(/q(\d+): quay\(id: "([^"]+)"\)/g)];
    for (const [, k, id] of ids) out[`q${k}`] = id === 'NSR:Quay:404' ? null : { latitude: 60, longitude: Number(id.split(':')[2]) };
    return out;
  };
  const gtfs = new Map([['NSR:Quay:1', [59.9, 10.7]]]);
  const q = createQuayCoords({ jpFetch, gtfs: () => gtfs });
  const ids = ['NSR:Quay:1', 'NSR:Quay:404', 'bad', ...Array.from({ length: 30 }, (_, i) => `NSR:Quay:${100 + i}`)];
  await q.ensure(ids);
  assert.equal(calls.length, 2); // 31 ukjente → 25 + 6
  assert.deepEqual(q.get('NSR:Quay:1'), [59.9, 10.7]);
  assert.deepEqual(q.get('NSR:Quay:105'), [60, 105]);
  assert.equal(q.get('NSR:Quay:404'), undefined);
  await q.ensure(ids);
  assert.equal(calls.length, 2, 'ingen nye oppslag innen 24 t');
});

test('createRailEtService: henter i bakgrunnen, gir [] før første henting, hopper over GPS-tog', async () => {
  let fetches = 0;
  const coords = { Q1: [63.43, 10.4], Q2: [63.46, 10.92], Q3: [64.01, 11.49] };
  const svc = createRailEtService({
    fetchJourneys: async () => { fetches++; return [journey(), journey({ datedVehicleJourneyRef: '320:2026-10-26' })]; },
    jpFetch: async () => null,
    now: () => T0,
    gtfs: () => new Map(Object.entries(coords).map(([k, v]) => [k, v])),
  });
  assert.deepEqual(svc.getVehicles(), []);
  await svc.refresh();
  assert.equal(fetches, 1);
  const keys = new Set(['320|2026-10-26']);
  const vs = svc.getVehicles(keys);
  assert.deepEqual(vs.map((v) => v.vehicleId), ['BNR:441:2026-10-26']);
  assert.equal(svc.getVehicles(keys), vs, 'samme array innen 15 s');
  assert.equal(fetches, 1);
});

test('createRailEtService: 429 gir pause, ingen ny henting før den er over', async () => {
  let t = T0;
  let fetches = 0;
  const svc = createRailEtService({
    fetchJourneys: async () => { fetches++; const e = new Error('ET BNR 429'); e.status = 429; throw e; },
    jpFetch: async () => null,
    now: () => t,
    gtfs: () => null,
  });
  const warn = console.warn;
  console.warn = () => {};
  try {
    await svc.refresh();
    t += 5 * 60000;
    await svc.refresh();
    assert.equal(fetches, 1);
    t += 6 * 60000;
    await svc.refresh();
    assert.equal(fetches, 2);
  } finally {
    console.warn = warn;
  }
});

// --- GPS-tog og sammenslåing ---

test('normalizeRailVehicles: modus rail, uten posisjon hoppes over', () => {
  const out = normalizeRailVehicles([
    { vehicleId: '320-2026-10-26', mode: 'RAIL', location: { latitude: 59.7, longitude: 10.1 }, line: { publicCode: 'RE10' } },
    { vehicleId: 'x', mode: 'RAIL', location: null },
    { vehicleId: 'g', location: { latitude: 58.9, longitude: 5.7 }, line: { lineRef: 'GOA:Line:59' } },
  ]);
  assert.deepEqual(out.map((v) => [v.vehicleId, v.mode]), [['320-2026-10-26', 'rail'], ['g', 'rail']]);
  assert.equal(out[1].line.publicCode, '59');
});

test('createRailVehiclesCache: cache 30 s, feil gir EMPTY_RAIL uten unhandled rejection', async () => {
  let t = 0;
  let n = 0;
  let fail = false;
  const fetchFn = async () => {
    n++;
    if (fail) throw new Error('nede');
    return { ok: true, json: async () => ({ data: { vehicles: [{ vehicleId: `v${n}`, location: { latitude: 60, longitude: 10 } }] } }) };
  };
  const warn = console.warn;
  console.warn = () => {};
  try {
    const failing = createRailVehiclesCache({ fetchFn: async () => { throw new Error('nede'); }, now: () => t });
    assert.equal(await failing.get(), EMPTY_RAIL);
    const c = createRailVehiclesCache({ fetchFn, now: () => t });
    const a = await c.get();
    assert.equal(a.data.vehicles[0].vehicleId, 'v1');
    t += 10000;
    assert.equal(await c.get(), a);
    t += 30000;
    fail = true;
    assert.equal(await c.get(), a, 'gammel verdi mens revalidering feiler');
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(await c.get(), a);
  } finally {
    console.warn = warn;
  }
});

test('mergeRailVehicles: Oslo-lista først, dubletter på vehicleId fjernes, ET-tog til slutt', () => {
  const oslo = { data: { vehicles: [{ vehicleId: 'bus1', mode: 'BUS' }, { vehicleId: '320-2026-10-26', mode: 'RAIL' }] } };
  const gps = [{ vehicleId: '320-2026-10-26', mode: 'rail' }, { vehicleId: '64-2026-10-26', mode: 'rail' }];
  const et = [{ vehicleId: 'BNR:441:2026-10-26', mode: 'rail' }];
  const out = mergeRailVehicles(oslo, gps, et);
  assert.deepEqual(out.data.vehicles.map((v) => v.vehicleId), ['bus1', '320-2026-10-26', '64-2026-10-26', 'BNR:441:2026-10-26']);
  assert.equal(oslo.data.vehicles.length, 2, 'input uendret');
  assert.deepEqual([...gpsTrainKeys(oslo.data.vehicles, gps)].sort(), ['320|2026-10-26', '64|2026-10-26']);
});

test('createRailLive: samme objekt når kildene er uendret', async () => {
  const rail = { data: { vehicles: [{ vehicleId: '64-2026-10-26', mode: 'rail' }] } };
  const seenKeys = [];
  const etList = Object.freeze([{ vehicleId: 'BNR:1:2026-10-26', mode: 'rail' }]);
  const live = createRailLive({ getRail: async () => rail, railEt: { getVehicles: (k) => { seenKeys.push(k); return etList; } } });
  const oslo = { data: { vehicles: [] } };
  const a = await live(oslo);
  const b = await live(oslo);
  assert.equal(a, b);
  assert.equal(seenKeys[0], seenKeys[1], 'samme nøkkelsett');
  assert.ok(seenKeys[0].has('64|2026-10-26'));
  assert.equal(a.data.vehicles.length, 2);
  const failing = createRailLive({ getRail: async () => { throw new Error('x'); }, railEt: { getVehicles: () => { throw new Error('y'); } } });
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.deepEqual((await failing(oslo)).data.vehicles, []);
  } finally {
    console.warn = warn;
  }
});

// --- Togruter i hele landet ---

function encodeNum(v) {
  let n = v < 0 ? ~(v << 1) : v << 1;
  let out = '';
  while (n >= 0x20) { out += String.fromCharCode((0x20 | (n & 0x1f)) + 63); n >>= 5; }
  return out + String.fromCharCode(n + 63);
}
function encode(points) {
  let pl = 0, pn = 0, out = '';
  for (const [a, b] of points) {
    const la = Math.round(a * 1e5), lo = Math.round(b * 1e5);
    out += encodeNum(la - pl) + encodeNum(lo - pn);
    pl = la; pn = lo;
  }
  return out;
}

/** Svingete spor nordover fra 60.0 til 60.2 langs lon 10.0. */
const TRACK = [];
for (let i = 0; i <= 100; i++) TRACK.push([60 + i * 0.002, 10 + 0.003 * Math.sin(i / 5)]);
const quay = (id, name, [lat, lon]) => ({ id, name, latitude: lat, longitude: lon });
const A = quay('NSR:Quay:1', 'Alfa stasjon', TRACK[0]);
const B = quay('NSR:Quay:2', 'Beta stasjon', TRACK[50]);
const C = quay('NSR:Quay:3', 'Gamma stasjon', TRACK[100]);
const jp = (quays, n, mode = 'rail', id = 'sj') => ({
  quays,
  serviceJourneys: Array.from({ length: n }, (_, i) => ({ id: `${id}-${i}`, transportMode: mode })),
});

test('pickRailLines: bare norske selskap med linjekode, flytog som egen modus', () => {
  const out = pickRailLines([
    { id: 'VYG:Line:R12', publicCode: 'R12' },
    { id: 'SJN:Line:26', publicCode: 'R70' },
    { id: 'FLT:Line:FLY1', publicCode: 'FLY1' },
    { id: 'SAM:Line:9011', publicCode: '' },
    { id: 'VYS:Line:30', publicCode: '30' },
    { id: 'VYG:Line:R12', publicCode: 'R12' },
  ]);
  assert.deepEqual(out.map((l) => `${l.id}/${l.mode}`), ['FLT:Line:FLY1/flytog', 'SJN:Line:26/rail', 'VYG:Line:R12/rail']);
});

test('choosePatterns: buss for tog hoppes over, mønstre med samme endepunkter slås sammen', () => {
  const chosen = choosePatterns([
    jp([A, B, C], 1, 'rail', 'r1'),
    jp([A, C], 1, 'rail', 'r2'), // samme endepunkter, færre stopp
    jp([A, B, C], 1, 'rail', 'r3'),
    jp([C, B, A], 2, 'rail', 'back'),
    jp([quay('NSR:Quay:9', 'Alfa busstasjon', [60, 10.01]), quay('NSR:Quay:8', 'Gamma bussterminal', [60.2, 10.01])], 9, 'bus', 'bus'),
  ]);
  assert.deepEqual(chosen.map((c) => `${c.pattern.from}>${c.pattern.to}:${c.pattern.journeys}`), ['Alfa stasjon>Gamma stasjon:3', 'Gamma stasjon>Alfa stasjon:2']);
  assert.match(chosen[0].id, /^r[13]-0$/);
});

test('buildRailShapes: trasé uten Oslo-klipping, variant som utsnitt, holdeplass-trasé til snapping', () => {
  const chosen = choosePatterns([jp([A, B, C], 5, 'rail', 'main'), jp([B, C], 3, 'rail', 'short')]);
  const enc = new Map(chosen.map((c) => [c.id, encode(TRACK)]));
  const line = { code: 'F7', mode: 'rail' };
  const { shapes, unsnapped } = buildRailShapes(line, chosen, enc);
  assert.equal(unsnapped.length, 0);
  assert.equal(shapes.length, 2);
  assert.equal(shapes[0].from, 'Alfa stasjon');
  assert.equal(shapes[0].to, 'Gamma stasjon');
  assert.ok(shapes[0].points.length > 4 && shapes[0].points.length < TRACK.length, 'forenklet');
  assert.ok(shapes[0].pointsAreTrace);
  assert.equal(shapes[0].quayStops.length, 3);
  assert.equal(shapes[1].from, 'Beta stasjon');

  // Bare holdeplassene som pointsOnLink (Flytoget)
  const fly = choosePatterns([jp([A, B, C], 5, 'rail', 'fly')]);
  const r = buildRailShapes({ code: 'FLY1', mode: 'flytog' }, fly, new Map([[fly[0].id, encode([TRACK[0], TRACK[50], TRACK[100]])]]));
  assert.equal(r.shapes.length, 0);
  assert.equal(r.unsnapped.length, 1);

  const snapped = snapUnsnapped([{ line: { code: 'FLY1', mode: 'flytog' }, pattern: r.unsnapped[0] }], shapes);
  assert.equal(snapped.length, 1);
  assert.equal(snapped[0].mode, 'flytog');
  assert.ok(snapped[0].points.length > 4, 'følger sporet, ikke rette streker');
});

test('snapToNetwork: korteste spor mellom nabostopp, rett strek uten treff', () => {
  const detour = [TRACK[0], [60.1, 10.2], TRACK[100]];
  const stops = [[...TRACK[0]], [...TRACK[100]]];
  const out = snapToNetwork(stops, [detour, TRACK]);
  assert.ok(out.length > 10, 'velger det korte, svingete sporet framfor omveien');
  assert.ok(out.every((p) => p[1] < 10.1));
  assert.equal(snapToNetwork([[50, 5], [50.1, 5]], [TRACK]), null);
  // Feil retning: sporet går nordover, stoppene sørover – gir ikke treff
  assert.equal(snapToNetwork([[...TRACK[100]], [...TRACK[0]]], [TRACK]), null);
});

test('createRailNetworkService: henter linjer og mønstre fra JP, stabil array, feil beholder forrige', async () => {
  let failR70 = false;
  const bodies = [];
  const fetchFn = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    bodies.push(body);
    let data;
    if (body.query.includes('lines(transportModes')) {
      data = { lines: [{ id: 'SJN:Line:26', publicCode: 'R70' }, { id: 'SAM:Line:1', publicCode: '' }] };
    } else if (body.variables?.id) {
      if (failR70) return { ok: false, status: 500, json: async () => ({}) };
      data = { line: { journeyPatterns: [jp([A, B, C], 4, 'rail', 'a'), jp([C, B, A], 4, 'rail', 'b')] } };
    } else {
      data = {};
      for (const [, k] of body.query.matchAll(/p(\d+): serviceJourney/g)) data[`p${k}`] = { journeyPattern: { pointsOnLink: { points: encode(TRACK) } } };
    }
    return { ok: true, json: async () => ({ data }) };
  };
  const log = console.log;
  const warn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  try {
    let t = 0;
    const svc = createRailNetworkService({ fetchFn, pauseMs: 0, now: () => t });
    const { shapes } = await svc.refresh();
    assert.equal(shapes.length, 2);
    assert.deepEqual(shapes.map((s) => `${s.mode}|${s.line}|${s.from}|${s.to}`), [
      'rail|R70|Alfa stasjon|Gamma stasjon',
      'rail|R70|Gamma stasjon|Alfa stasjon',
    ]);
    assert.equal(bodies.length, 3);
    // Innen et døgn: ingen nye mønsterkall, samme array
    t += 60000;
    assert.equal((await svc.refresh()).shapes, shapes);
    assert.equal(bodies.length, 4);
    // Etter et døgn med feil: forrige trasé beholdes
    t += 25 * 3600000;
    failR70 = true;
    const r = await svc.refresh();
    assert.equal(r.failed, 1);
    assert.equal(r.shapes, shapes);
    assert.equal(svc.getShapes(), shapes);
  } finally {
    console.log = log;
    console.warn = warn;
  }
});

test('applyLineGeometry med landsdekkende togruter: erstatter Oslo-utsnitt og eldre togkart for samme linje', () => {
  const old = [
    { mode: 'rail', line: 'F4', from: 'Kongsberg', to: 'Oslo S', points: [[59, 9], [59.9, 10.7]] },
    { mode: 'rail', line: 'R12', from: 'Kongsberg stasjon', to: 'Eidsvoll stasjon', points: [[59.6, 9.6]], pointsAreTrace: true },
    { mode: 'metro', line: '1', from: 'A', to: 'B', points: [] },
  ];
  const national = [
    { mode: 'rail', line: 'F4', from: 'Oslo S', to: 'Bergen stasjon', points: [[59.9, 10.7], [60.39, 5.33]], pointsAreTrace: true },
    { mode: 'rail', line: 'R12', from: 'Kongsberg stasjon', to: 'Eidsvoll stasjon', points: [[59.6, 9.6], [60.3, 11.2]], pointsAreTrace: true },
  ];
  const out = applyLineGeometry(old, national);
  assert.deepEqual(out.map((s) => `${s.line}|${s.to}`), ['1|B', 'F4|Bergen stasjon', 'R12|Eidsvoll stasjon']);
  // GPS-tog på F4 mot Bergen får fra/til fra den nye ruta
  const m = matchRouteForVehicle({ mode: 'RAIL', line: { publicCode: 'F4' }, destinationName: 'Bergen' }, out);
  assert.deepEqual(m, { from: 'Oslo S', to: 'Bergen stasjon', via: null });
});
