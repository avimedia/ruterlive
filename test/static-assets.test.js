import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickEncoding, cacheControlFor } from '../server/static-assets.js';

test('pickEncoding foretrekker br, deretter gzip', () => {
  assert.equal(pickEncoding('gzip, deflate, br'), 'br');
  assert.equal(pickEncoding('gzip, deflate'), 'gzip');
  assert.equal(pickEncoding('identity'), null);
  assert.equal(pickEncoding(undefined), null);
});

test('pickEncoding respekterer q=0 og tilgjengelige kodinger', () => {
  assert.equal(pickEncoding('br;q=0, gzip'), 'gzip');
  assert.equal(pickEncoding('br;q=0, gzip;q=0'), null);
  assert.equal(pickEncoding('br, gzip', ['gzip']), 'gzip');
  assert.equal(pickEncoding('br', ['gzip']), null);
});

test('cacheControlFor', () => {
  assert.match(cacheControlFor('/assets/index-abc.js'), /immutable/);
  assert.equal(cacheControlFor('/index.html'), 'no-cache');
  assert.equal(cacheControlFor('/sw.js'), 'no-cache');
  assert.equal(cacheControlFor('/content.css'), 'public, max-age=86400');
  assert.equal(cacheControlFor('/ads.txt'), null);
});
