import test from 'node:test';
import assert from 'node:assert/strict';
import { createRegionRuntime } from '../server/region-runtime.js';

const MIN = 60_000;
const regions = [
  { id: 'oslo', alwaysActive: true },
  { id: 'bergen', alwaysActive: false },
];

function lag() {
  let t = 1_000_000;
  const rt = createRegionRuntime({ regions, now: () => t });
  return { rt, adv: (ms) => { t += ms; } };
}

test('alwaysActive er alltid aktiv', () => {
  const { rt, adv } = lag();
  adv(1000 * MIN);
  assert.equal(rt.stateOf('oslo'), 'active');
});

test('uten besøk er regionen hvilende fra start', () => {
  const { rt } = lag();
  assert.equal(rt.stateOf('bergen'), 'resting');
});

test('aktiv -> hvilende -> avlastet, onUnload én gang, touch gir aktiv', () => {
  const { rt, adv } = lag();
  const unloaded = [];
  rt.onUnload((id) => unloaded.push(id));
  rt.touch('bergen');
  assert.equal(rt.stateOf('bergen'), 'active');
  adv(9 * MIN);
  assert.equal(rt.stateOf('bergen'), 'active');
  adv(1 * MIN);
  assert.equal(rt.stateOf('bergen'), 'resting');
  adv(49 * MIN);
  rt.tick();
  assert.equal(rt.stateOf('bergen'), 'resting');
  assert.deepEqual(unloaded, []);
  adv(1 * MIN);
  rt.tick();
  rt.tick();
  assert.equal(rt.stateOf('bergen'), 'unloaded');
  assert.deepEqual(unloaded, ['bergen']);
  rt.touch('bergen');
  assert.equal(rt.stateOf('bergen'), 'active');
  adv(61 * MIN);
  rt.tick();
  assert.deepEqual(unloaded, ['bergen', 'bergen']);
});

test('region uten besøk avlastes 60 min etter oppstart; Oslo aldri', () => {
  const { rt, adv } = lag();
  const unloaded = [];
  rt.onUnload((id) => unloaded.push(id));
  adv(59 * MIN);
  rt.tick();
  assert.equal(rt.stateOf('bergen'), 'resting');
  adv(1 * MIN);
  rt.tick();
  assert.equal(rt.stateOf('bergen'), 'unloaded');
  assert.deepEqual(unloaded, ['bergen']);
});

test('tick kaster ikke når onUnload kaster', () => {
  const { rt, adv } = lag();
  const seen = [];
  const warn = console.warn;
  console.warn = () => {};
  try {
    rt.onUnload(() => { throw new Error('feil'); });
    rt.onUnload((id) => seen.push(id));
    adv(61 * MIN);
    assert.doesNotThrow(() => rt.tick());
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(seen, ['bergen']);
});

test('ukjent id: touch ignoreres, stateOf kaster ikke', () => {
  const { rt } = lag();
  rt.touch('finnes-ikke');
  assert.equal(rt.stateOf('finnes-ikke'), 'unloaded');
});

test('runExclusive kjører én om gangen', async () => {
  const { rt } = lag();
  const log = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const a = rt.runExclusive(async () => { log.push('a start'); await gate; log.push('a slutt'); return 1; });
  const b = rt.runExclusive(async () => { log.push('b start'); return 2; });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(log, ['a start']);
  release();
  assert.deepEqual(await Promise.all([a, b]), [1, 2]);
  assert.deepEqual(log, ['a start', 'a slutt', 'b start']);
});

test('runExclusive: avvist oppgave blokkerer ikke køen og avvisningen når kalleren', async () => {
  const { rt } = lag();
  const log = [];
  const a = rt.runExclusive(async () => { log.push('a'); throw new Error('boom'); });
  const b = rt.runExclusive(async () => { log.push('b'); return 'ok'; });
  await assert.rejects(a, /boom/);
  assert.equal(await b, 'ok');
  assert.deepEqual(log, ['a', 'b']);
});
