import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLOSED,
  SHEET_MEDIA_QUERY,
  REFRESH_MS,
  sheetReducer,
  prefersDepartureSheet,
  createRefreshScheduler,
  classifyContent,
  stopKey,
} from '../js/departure-sheet.js';

const READY = '<div class="departure-board"><table class="departure-table"></table></div>';
const LOADING = '<div class="departure-loading">Henter avganger…</div>';
const ERROR = '<div class="departure-error">Kunne ikke hente avganger.</div>';

test('åpne gir lasting, innhold gir klar tavle', () => {
  let s = sheetReducer(CLOSED, { type: 'open', name: 'Jernbanetorget', quayIds: ['NSR:Quay:1', 'NSR:Quay:2'] });
  assert.equal(s.status, 'loading');
  assert.equal(s.name, 'Jernbanetorget');
  assert.equal(s.key, 'NSR:Quay:1,NSR:Quay:2');
  s = sheetReducer(s, { type: 'content', quayIds: ['NSR:Quay:1', 'NSR:Quay:2'], html: READY });
  assert.equal(s.status, 'ready');
  assert.equal(s.html, READY);
});

test('ny holdeplass erstatter, og sent svar fra forrige ignoreres', () => {
  let s = sheetReducer(CLOSED, { type: 'open', name: 'A', quayIds: 'NSR:Quay:A' });
  s = sheetReducer(s, { type: 'open', name: 'B', quayIds: 'NSR:Quay:B' });
  assert.equal(s.name, 'B');
  assert.equal(s.status, 'loading');
  const after = sheetReducer(s, { type: 'content', quayIds: 'NSR:Quay:A', html: READY });
  assert.equal(after, s);
});

test('oppfriskning: «Henter…» og feil skjuler ikke en tavle som allerede vises', () => {
  let s = sheetReducer(CLOSED, { type: 'open', name: 'A', quayIds: 'q' });
  s = sheetReducer(s, { type: 'content', quayIds: 'q', html: READY });
  assert.equal(sheetReducer(s, { type: 'content', quayIds: 'q', html: LOADING }), s);
  assert.equal(sheetReducer(s, { type: 'content', quayIds: 'q', html: ERROR }), s);
  const fresh = READY.replace('table', 'table data-x="1"');
  assert.equal(sheetReducer(s, { type: 'content', quayIds: 'q', html: fresh }).html, fresh);
});

test('feil ved første henting vises', () => {
  let s = sheetReducer(CLOSED, { type: 'open', name: 'A', quayIds: 'q' });
  s = sheetReducer(s, { type: 'content', quayIds: 'q', html: ERROR });
  assert.equal(s.status, 'error');
});

test('lukk nullstiller, og innhold etter lukking ignoreres', () => {
  let s = sheetReducer(CLOSED, { type: 'open', name: 'A', quayIds: 'q' });
  s = sheetReducer(s, { type: 'close' });
  assert.equal(s.status, 'closed');
  assert.equal(sheetReducer(s, { type: 'content', quayIds: 'q', html: READY }), s);
  assert.equal(sheetReducer(s, { type: 'close' }), s);
});

test('classifyContent og stopKey', () => {
  assert.equal(classifyContent(LOADING), 'loading');
  assert.equal(classifyContent(ERROR), 'error');
  assert.equal(classifyContent(READY), 'ready');
  assert.equal(stopKey(['a', null, 'b']), 'a,b');
  assert.equal(stopKey('a'), 'a');
});

test('mediespørring: bunnark bare når (max-width: 600px) treffer', () => {
  const queries = [];
  const mm = (matches) => (q) => { queries.push(q); return { matches }; };
  assert.equal(prefersDepartureSheet(mm(true)), true);
  assert.equal(prefersDepartureSheet(mm(false)), false);
  assert.deepEqual(queries, [SHEET_MEDIA_QUERY, SHEET_MEDIA_QUERY]);
  assert.equal(SHEET_MEDIA_QUERY, '(max-width: 600px)');
  assert.equal(prefersDepartureSheet(undefined), false);
  assert.equal(prefersDepartureSheet(() => { throw new Error('x'); }), false);
});

function fakeTimers() {
  const timers = new Map();
  let next = 1;
  return {
    timers,
    setIntervalFn: (fn, ms) => { timers.set(next, { fn, ms }); return next++; },
    clearIntervalFn: (id) => timers.delete(id),
    fire: () => { for (const t of [...timers.values()]) t.fn(); },
  };
}

test('oppfriskning hvert 30. sekund, én tidtaker om gangen, stopper ved lukking', () => {
  const t = fakeTimers();
  let ticks = 0;
  const sch = createRefreshScheduler({ tick: () => ticks++, setIntervalFn: t.setIntervalFn, clearIntervalFn: t.clearIntervalFn });
  assert.equal(sch.isRunning(), false);
  sch.start();
  assert.equal(t.timers.size, 1);
  assert.equal([...t.timers.values()][0].ms, REFRESH_MS);
  assert.equal(REFRESH_MS, 30_000);
  sch.start(); // ny holdeplass: start på nytt, ikke to tidtakere
  assert.equal(t.timers.size, 1);
  t.fire();
  t.fire();
  assert.equal(ticks, 2);
  sch.stop();
  assert.equal(t.timers.size, 0);
  assert.equal(sch.isRunning(), false);
  t.fire();
  assert.equal(ticks, 2);
});
