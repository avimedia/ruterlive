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
