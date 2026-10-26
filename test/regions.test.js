import test from 'node:test';
import assert from 'node:assert/strict';
import { REGIONS, DEFAULT_REGION, getRegion, isInBounds } from '../shared/regions.js';
import { getModeFromLineNumFallback, isRuterLine, mapJpTransportMode } from '../shared/line-mode.js';

test('Oslo er standardregion med alle innstillinger', () => {
  assert.equal(DEFAULT_REGION, 'oslo');
  const r = REGIONS.oslo;
  assert.equal(getRegion(), r);
  assert.equal(getRegion('finnes-ikke'), r);
  assert.equal(r.id, 'oslo');
  assert.deepEqual([...r.center], [59.9110, 10.7525]);
  assert.equal(r.defaultZoom, 14);
  assert.deepEqual(r.vehicleBounds, { minLat: 59.45, maxLat: 60.2, minLon: 10.15, maxLon: 11.25 });
  assert.deepEqual(r.stopsBounds, { minLat: 59.2, maxLat: 60.8, minLon: 10.0, maxLon: 11.6 });
  assert.deepEqual(r.geometryBounds, { s: 59.0, n: 60.45, w: 9.4, e: 12.1 });
  assert.deepEqual([...r.etDatasets], ['RUT']);
  assert.equal(r.lineNumberFallback, 'ruter');
  assert.deepEqual(r.mapLink, { lat: 59.925, lng: 10.75 });
});

test('isInBounds', () => {
  const r = getRegion('oslo');
  assert.equal(isInBounds(r, 59.911, 10.7525), true);
  assert.equal(isInBounds(r, 60.2, 11.25), true);
  assert.equal(isInBounds(r, 60.21, 10.75), false);
  assert.equal(isInBounds(r, 60.39, 5.32), false); // Bergen
});

test('linjenummer-fallback gjelder bare Ruter', () => {
  assert.equal(isRuterLine('RUT:Line:5'), true);
  assert.equal(isRuterLine('GOA:Line:5'), false);
  assert.equal(getModeFromLineNumFallback('RUT:Line:5'), 'metro');
  assert.equal(getModeFromLineNumFallback('RUT:Line:13'), 'tram');
  assert.equal(getModeFromLineNumFallback('RUT:Line:31'), 'bus');
  assert.equal(getModeFromLineNumFallback('RUT:Line:7'), null);
  assert.equal(getModeFromLineNumFallback('NOR:Line:5'), null);
  assert.equal(getModeFromLineNumFallback('Line:5'), null);
  assert.equal(getModeFromLineNumFallback(undefined), null);
});

test('mapJpTransportMode (delt)', () => {
  assert.equal(mapJpTransportMode('ferry'), 'water');
  assert.equal(mapJpTransportMode('coach'), null);
});
