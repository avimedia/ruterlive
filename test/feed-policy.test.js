import test from 'node:test';
import assert from 'node:assert/strict';
import { createFeedPolicy, shouldFallBackToLegacy, gpsGlideMs } from '../js/feed-policy.js';

test('prøver live hver gang uten feil', () => {
  const p = createFeedPolicy();
  assert.ok(p.shouldTryLive() && p.shouldTryLive());
});

test('etter feil prøves live igjen hver 3. poll, og nullstilles ved suksess', () => {
  const p = createFeedPolicy();
  p.recordFailure();
  assert.deepEqual([p.shouldTryLive(), p.shouldTryLive(), p.shouldTryLive()], [false, false, true]);
  p.recordFailure();
  assert.deepEqual([p.shouldTryLive(), p.shouldTryLive(), p.shouldTryLive()], [false, false, true]);
  p.recordSuccess();
  assert.ok(p.shouldTryLive());
});

test('fallback til legacy ved 404/ikke-JSON, ikke ved 5xx', () => {
  assert.equal(shouldFallBackToLegacy({ status: 404 }), true);
  assert.equal(shouldFallBackToLegacy(new SyntaxError('x')), true);
  assert.equal(shouldFallBackToLegacy({ status: 503 }), false);
});

test('gpsGlideMs begrenses til 8–20 s', () => {
  assert.equal(gpsGlideMs(undefined), 10000);
  assert.equal(gpsGlideMs(5000), 8000);
  assert.equal(gpsGlideMs(30000), 15000);
  assert.equal(gpsGlideMs(120000), 20000);
});
