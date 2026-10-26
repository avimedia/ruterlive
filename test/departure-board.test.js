import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  perQuayCount,
  expandQuayIds,
  trimCalls,
  createDepartureBoard,
  DEPARTURES_TTL_MS,
  MAX_QUAYS,
  TOTAL_CAP,
} from '../server/departure-board.js';
import { createStopPlaceLookup, parseQuay } from '../server/stop-search.js';

const BJERKE = ['NSR:Quay:11015', 'NSR:Quay:10988', 'NSR:Quay:10985', 'NSR:Quay:11020'];
const T0 = Date.parse('2026-10-26T12:00:00Z');
const at = (min) => new Date(T0 + min * 60000).toISOString();

const bjerkeInfo = (id) =>
  parseQuay({
    id,
    name: 'Bjerke',
    stopPlace: { id: 'NSR:StopPlace:6006', name: 'Bjerke', quays: BJERKE.map((q) => ({ id: q, lines: [{ publicCode: '31', transportMode: 'bus' }] })) },
    lines: [],
  });

test('perQuayCount: 24 fordelt, minst 3', () => {
  assert.equal(perQuayCount(1), 24);
  assert.equal(perQuayCount(2), 12);
  assert.equal(perQuayCount(4), 6);
  assert.equal(perQuayCount(7), 4);
  assert.equal(perQuayCount(13), 3);
  assert.equal(perQuayCount(30), 3);
  assert.equal(perQuayCount(0), 24);
});

test('expandQuayIds: én quay gir hele stoppestedet, den forespurte først', () => {
  const infos = new Map([['NSR:Quay:10985', bjerkeInfo('NSR:Quay:10985')]]);
  const { quayIds, placeIds } = expandQuayIds(['NSR:Quay:10985'], infos);
  assert.deepEqual(quayIds, ['NSR:Quay:10985', 'NSR:Quay:11015', 'NSR:Quay:10988', 'NSR:Quay:11020']);
  assert.deepEqual(placeIds, ['NSR:StopPlace:6006']);
  // Ukjent quay står som den er
  assert.deepEqual(expandQuayIds(['NSR:Quay:1'], new Map([['NSR:Quay:1', null]])).quayIds, ['NSR:Quay:1']);
});

test('expandQuayIds: tak på antall quays, forespurte beholdes', () => {
  const many = Array.from({ length: 40 }, (_, i) => `NSR:Quay:${100 + i}`);
  const info = parseQuay({ id: 'NSR:Quay:999', stopPlace: { id: 'NSR:StopPlace:1', name: 'Hub', quays: many.map((id) => ({ id })) } });
  const { quayIds } = expandQuayIds(['NSR:Quay:999'], new Map([['NSR:Quay:999', info]]));
  assert.equal(quayIds.length, MAX_QUAYS);
  assert.equal(quayIds[0], 'NSR:Quay:999');
});

test('trimCalls: sortert per quay og runde for runde under taket', () => {
  const quays = Array.from({ length: 20 }, (_, i) => ({
    id: `q${i}`,
    calls: [5, 1, 3].map((m) => ({ expectedDepartureTime: at(m + i) })),
  }));
  const out = trimCalls(quays);
  const total = [...out.values()].reduce((s, l) => s + l.length, 0);
  assert.equal(total, TOTAL_CAP);
  assert.ok([...out.values()].every((l) => l.length >= 1), 'alle quays er med');
  assert.deepEqual(out.get('q0').map((c) => c.expectedDepartureTime), [at(1), at(3)]);
  assert.equal(trimCalls([{ id: 'a', calls: [] }]).get('a').length, 0);
});

function fakeBoard({ fail = false } = {}) {
  const calls = { departures: [] };
  let clock = T0;
  const lookup = {
    getQuays: async (ids) => new Map(ids.map((id) => [id, BJERKE.includes(id) ? bjerkeInfo(id) : null])),
    header: async (ids) => ({ stopPlaceId: 'NSR:StopPlace:6006', name: 'Bjerke', locality: 'Oslo', lines: [] }),
  };
  const jpQueryFn = async (query, _fetch, _timeout, { ids }) => {
    calls.departures.push({ ids, n: Number(query.match(/numberOfDepartures: (\d+)/)[1]) });
    await new Promise((r) => setTimeout(r, 5));
    if (fail) throw new Error('JP 429');
    return {
      quays: ids.map((id, i) => ({
        id,
        name: 'Bjerke',
        publicCode: '',
        description: `rampe ${i}`,
        estimatedCalls: [3, 1].map((m) => ({ expectedDepartureTime: at(m + i), destinationDisplay: { frontText: 'X' } })),
      })),
    };
  };
  const board = createDepartureBoard({ lookup, jpQueryFn, now: () => clock });
  return { board, calls, tick: (ms) => (clock += ms) };
}

test('board: én rampe gir alle fire quays i ett kall, med per-quay-antall', async () => {
  const { board, calls } = fakeBoard();
  const res = await board.get(['NSR:Quay:10985']);
  assert.equal(calls.departures.length, 1);
  assert.deepEqual([...calls.departures[0].ids].sort(), [...BJERKE].sort());
  assert.equal(calls.departures[0].n, 6);
  assert.equal(res.id, 'NSR:Quay:10985');
  assert.equal(res.place.name, 'Bjerke');
  assert.equal(res.quays.length, 4);
  assert.equal(new Set(res.estimatedCalls.map((c) => c.quayId)).size, 4);
  // Sortert etter tid innen hver quay
  const first = res.estimatedCalls.filter((c) => c.quayId === 'NSR:Quay:10985').map((c) => c.expectedDepartureTime);
  assert.deepEqual(first, [...first].sort());
});

test('board: expand=0 gir bare de gitte quayene', async () => {
  const { board, calls } = fakeBoard();
  const res = await board.get(['NSR:Quay:10985'], { expand: false });
  assert.deepEqual(calls.departures[0].ids, ['NSR:Quay:10985']);
  assert.equal(calls.departures[0].n, 24);
  assert.equal(res.quays.length, 1);
});

test('board: cache per stoppested i 30 s, delt mellom markører, og in-flight-dedup', async () => {
  const { board, calls, tick } = fakeBoard();
  // Fem samtidige trykk og en annen markør på samme stoppested
  await Promise.all([
    ...Array.from({ length: 5 }, () => board.get(['NSR:Quay:10985'])),
    board.get(['NSR:Quay:11015', 'NSR:Quay:10988']),
  ]);
  assert.equal(calls.departures.length, 1);
  tick(DEPARTURES_TTL_MS - 1000);
  const other = await board.get(['NSR:Quay:11020']);
  assert.equal(other.id, 'NSR:Quay:11020');
  assert.equal(calls.departures.length, 1);
  tick(2000);
  await board.get(['NSR:Quay:10985']);
  assert.equal(calls.departures.length, 2);
  assert.equal(board.stats.jp, 2);
});

test('board: feil caches ikke', async () => {
  const { board, calls } = fakeBoard({ fail: true });
  await assert.rejects(board.get(['NSR:Quay:10985']), /429/);
  await assert.rejects(board.get(['NSR:Quay:10985']), /429/);
  assert.equal(calls.departures.length, 2);
});

test('board med ekte quay-oppslag: ett JP-kall for stoppestedet, deretter bare avgangskall', async () => {
  const bodies = [];
  const fetchFn = async (url, opts) => {
    if (String(url).includes('geocoder')) {
      return { ok: true, json: async () => ({ features: [{ properties: { id: 'NSR:StopPlace:6006', locality: 'Oslo' } }] }) };
    }
    const body = JSON.parse(opts.body);
    bodies.push(body);
    const isDepartures = body.query.includes('estimatedCalls');
    const quays = body.variables.ids.map((id) => ({
      id,
      name: 'Bjerke',
      publicCode: '',
      description: 'rampe',
      stopPlace: { id: 'NSR:StopPlace:6006', name: 'Bjerke', quays: BJERKE.map((q) => ({ id: q, lines: [] })) },
      lines: [],
      ...(isDepartures ? { estimatedCalls: [{ expectedDepartureTime: at(1) }] } : {}),
    }));
    return { ok: true, json: async () => ({ data: { quays } }) };
  };
  const lookup = createStopPlaceLookup({ fetchFn });
  const { jpQuery } = await import('../server/line-catalog.js');
  const board = createDepartureBoard({ lookup, jpQueryFn: jpQuery, fetchFn });
  const res = await board.get(['NSR:Quay:10985']);
  assert.equal(res.place.locality, 'Oslo');
  assert.equal(res.quays.length, 4);
  for (let i = 0; i < 4; i++) await board.get([BJERKE[i]]);
  const deps = bodies.filter((b) => b.query.includes('estimatedCalls'));
  assert.equal(deps.length, 1);
  assert.equal(bodies.length - deps.length, 1, 'ett quay-oppslag (stoppestedet)');
});
