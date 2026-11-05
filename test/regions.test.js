import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REGIONS, DEFAULT_REGION, getRegion, isInBounds, findRegion, publicRegions, visibleRegions,
  regionFromPath, regionPath, regionAt,
} from '../shared/regions.js';
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

test('Bergen i regionmodellen, offentlig', () => {
  const b = REGIONS.bergen;
  assert.equal(b.id, 'bergen');
  assert.equal(b.public, true);
  assert.equal(b.path, '/bergen');
  assert.equal(b.alwaysActive, false);
  assert.deepEqual([...b.etDatasets], ['SKY']);
  assert.deepEqual([...b.authorities], ['SKY']);
  assert.equal(b.lineNumberFallback, null);
  assert.deepEqual([...b.center], [60.3925, 5.3240]);
  assert.deepEqual(b.vehicleBounds, { minLat: 59.3, maxLat: 62.6, minLon: 4.5, maxLon: 7.9 });
  assert.deepEqual(b.stopsBounds, { minLat: 59.1, maxLat: 62.8, minLon: 4.3, maxLon: 8.1 });
  assert.deepEqual(b.geometryBounds, { s: 58.9, n: 63.0, w: 4.1, e: 8.3 });
  const o = REGIONS.oslo;
  assert.equal(o.path, '');
  assert.equal(o.public, true);
  assert.equal(o.alwaysActive, true);
  assert.deepEqual([...o.authorities], ['RUT']);
  assert.equal(o.jpRailFallback, true);
  assert.notEqual(b.jpRailFallback, true);
});

test('findRegion kjenner bare egne id-er', () => {
  assert.equal(findRegion('__proto__'), null);
  assert.equal(findRegion('constructor'), null);
  assert.equal(findRegion('finnes-ikke'), null);
  assert.equal(findRegion('bergen'), REGIONS.bergen);
});

test('publicRegions og visibleRegions', () => {
  assert.deepEqual(publicRegions().map(r => r.id), ['oslo', 'bergen']);
  assert.deepEqual(visibleRegions().map(r => r.id), ['oslo', 'bergen']);
  // Skjult region (public: false) vises bare når den står i forhåndsvisningslisten
  const skjult = { oslo: REGIONS.oslo, bergen: { ...REGIONS.bergen, public: false } };
  assert.deepEqual(publicRegions(skjult).map(r => r.id), ['oslo']);
  assert.deepEqual(visibleRegions([], skjult).map(r => r.id), ['oslo']);
  assert.deepEqual(visibleRegions(['bergen'], skjult).map(r => r.id), ['oslo', 'bergen']);
  assert.deepEqual(visibleRegions(['finnes-ikke'], skjult).map(r => r.id), ['oslo']);
});

test('regionFromPath', () => {
  const vis = visibleRegions(['bergen']);
  let r = regionFromPath('/bergen/linje/buss-2', vis);
  assert.equal(r.region.id, 'bergen');
  assert.equal(r.rest, '/linje/buss-2');
  r = regionFromPath('/bergen', vis);
  assert.equal(r.region.id, 'bergen');
  assert.equal(r.rest, '/');
  r = regionFromPath('/', vis);
  assert.equal(r.region.id, 'oslo');
  assert.equal(r.rest, '/');
  r = regionFromPath('/linje/x', vis);
  assert.equal(r.region.id, 'oslo');
  assert.equal(r.rest, '/linje/x');
  r = regionFromPath('/bergensbanen', vis);
  assert.equal(r.region.id, 'oslo');
  assert.equal(r.rest, '/bergensbanen');
  // Ikke synlig: Oslo og hele stien
  r = regionFromPath('/bergen/linje/buss-2', visibleRegions([], { oslo: REGIONS.oslo }));
  assert.equal(r.region.id, 'oslo');
  assert.equal(r.rest, '/bergen/linje/buss-2');
});

test('regionPath', () => {
  assert.equal(regionPath(REGIONS.oslo, '/linje/x'), '/linje/x');
  assert.equal(regionPath(REGIONS.oslo), '/');
  assert.equal(regionPath(REGIONS.bergen), '/bergen');
  assert.equal(regionPath(REGIONS.bergen, '/linje/x'), '/bergen/linje/x');
});

test('regionAt', () => {
  const vis = visibleRegions(['bergen']);
  assert.equal(regionAt(60.39, 5.32, vis).id, 'bergen');
  assert.equal(regionAt(61.45, 5.85, vis).id, 'bergen'); // Førde, utenfor byen men i Vestland
  assert.equal(regionAt(59.91, 10.75, vis).id, 'oslo');
  assert.equal(regionAt(63.4, 10.4, vis), null);
  assert.equal(regionAt(60.39, 5.32, visibleRegions([], { oslo: REGIONS.oslo })), null); // Bergen ikke synlig
  assert.equal(regionAt(60.39, 5.32).id, 'bergen'); // standard: Bergen er offentlig
});
