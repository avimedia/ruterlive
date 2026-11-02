import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { makeJsonEntry, sendJson, hashString } from '../server/json-cache.js';

function fakeRes() {
  return {
    headers: {}, statusCode: 200, body: null,
    set(k, v) { this.headers[k.toLowerCase()] = v; return this; },
    type(t) { this.headers['content-type'] = t; return this; },
    status(c) { this.statusCode = c; return this; },
    end(b) { this.body = b ?? null; return this; },
  };
}
const big = { a: 'x'.repeat(5000) };

test('velger br, gzip eller rå etter Accept-Encoding', () => {
  const e = makeJsonEntry(big);
  let r = fakeRes();
  sendJson({ headers: { 'accept-encoding': 'gzip, deflate, br' } }, r, e);
  assert.equal(r.headers['content-encoding'], 'br');
  assert.deepEqual(JSON.parse(zlib.brotliDecompressSync(r.body)), big);
  r = fakeRes();
  sendJson({ headers: { 'accept-encoding': 'gzip' } }, r, e);
  assert.equal(r.headers['content-encoding'], 'gzip');
  assert.deepEqual(JSON.parse(zlib.gunzipSync(r.body)), big);
  r = fakeRes();
  sendJson({ headers: {} }, r, e);
  assert.equal(r.headers['content-encoding'], undefined);
  assert.deepEqual(JSON.parse(r.body.toString()), big);
  assert.equal(r.headers.vary, 'Accept-Encoding');
});

test('304 ved matchende ETag', () => {
  const e = makeJsonEntry(big);
  const r = fakeRes();
  sendJson({ headers: { 'if-none-match': e.etag } }, r, e);
  assert.equal(r.statusCode, 304);
  assert.equal(r.body, null);
});

test('hash endres bare når innholdet endres', () => {
  assert.equal(hashString('[1,2]'), hashString('[1,2]'));
  assert.notEqual(hashString('[1,2]'), hashString('[1,3]'));
});

test('accepts respekterer q=0 og vanlige formater', async () => {
  const { accepts } = await import('../server/json-cache.js');
  assert.equal(accepts('gzip, deflate, br', 'br'), true);
  assert.equal(accepts('br;q=0, gzip', 'br'), false);
  assert.equal(accepts('br;q=0, gzip', 'gzip'), true);
  assert.equal(accepts('GZIP;q=0.5', 'gzip'), true);
  assert.equal(accepts('', 'gzip'), false);
});

test('store entries holder ikke rå JSON, men sender den dekomprimert ved behov', () => {
  const e = makeJsonEntry(big);
  assert.equal(e.json, null);
  assert.ok(e.gzip && e.br);
  const small = makeJsonEntry({ a: 1 });
  assert.equal(small.json.toString(), '{"a":1}');
  assert.equal(small.gzip, null);
  const r = fakeRes();
  sendJson({ headers: {} }, r, small);
  assert.equal(r.body.toString(), '{"a":1}');
});

test('makeJsonEntry gjenbruker forrige entry ved samme innhold', () => {
  const a = makeJsonEntry(big);
  assert.equal(makeJsonEntry({ a: 'x'.repeat(5000) }, a), a);
  assert.notEqual(makeJsonEntry({ a: 'y'.repeat(5000) }, a), a);
  assert.notEqual(makeJsonEntry(big, null), a);
});

test('memoEntry bygger bare på nytt når en nøkkel byttes ut', async () => {
  const { memoEntry } = await import('../server/json-cache.js');
  let builds = 0;
  const k1 = [1];
  const k2 = [2];
  const get = memoEntry((a, b) => { builds++; return makeJsonEntry([...a, ...b]); });
  const e = get(k1, k2);
  assert.equal(get(k1, k2), e);
  assert.equal(builds, 1);
  get([1], k2);
  assert.equal(builds, 2);
});

test('makeJsonEntry med brUpgrade bytter til mindre br i bakgrunnen', async () => {
  const { makeJsonEntry } = await import('../server/json-cache.js');
  const zlib = await import('node:zlib');
  const value = Array.from({ length: 3000 }, (_, i) => ({ id: `et-RUT:ServiceJourney:${(i * 7919).toString(16)}`, n: `Stopp ${i % 50}`, x: i }));
  // Oppgradering skjer først etter 120 s oppetid
  const uptime = process.uptime;
  process.uptime = () => 1000;
  const e = makeJsonEntry(value, null, { brQuality: 4, brUpgrade: 11 });
  process.uptime = uptime;
  const before = e.br.length;
  await new Promise((r) => setTimeout(r, 1500));
  assert.ok(e.br.length < before, `${e.br.length} < ${before}`);
  assert.deepEqual(JSON.parse(zlib.brotliDecompressSync(e.br).toString()), value);
});

test('awaitUpgrade venter på sterkere komprimering, men høyst maxMs', async () => {
  const { makeJsonEntry, awaitUpgrade } = await import('../server/json-cache.js');
  const value = Array.from({ length: 3000 }, (_, i) => ({ id: `x${(i * 7919).toString(16)}`, n: `Stopp ${i % 50}` }));
  const uptime = process.uptime;
  process.uptime = () => 1000;
  const e = makeJsonEntry(value, null, { brQuality: 4, brUpgrade: 11 });
  process.uptime = uptime;
  const before = e.br.length;
  await awaitUpgrade(e, 5000);
  assert.ok(e.br.length < before);
  assert.equal(e.upgraded, null);
  await awaitUpgrade(e); // ingen ventende oppgradering: returnerer straks
  await awaitUpgrade(null);
});
