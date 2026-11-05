import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePreview, currentRegion, withRegion, viewKeyFor } from '../js/region.js';
import { REGIONS, visibleRegions } from '../shared/regions.js';

const withBergen = visibleRegions(['bergen']);
const bare = visibleRegions([], { oslo: REGIONS.oslo });

test('parsePreview: kommaseparert liste, tomt og ugyldig gir tom liste', () => {
  assert.deepEqual(parsePreview('bergen, oslo ,'), ['bergen', 'oslo']);
  assert.deepEqual(parsePreview(''), []);
  assert.deepEqual(parsePreview(undefined), []);
});

test('currentRegion: Oslo på /, Bergen på /bergen bare når synlig', () => {
  assert.equal(currentRegion('/', withBergen), REGIONS.oslo);
  assert.equal(currentRegion('/bergen', withBergen), REGIONS.bergen);
  assert.equal(currentRegion('/bergen', bare), REGIONS.oslo);
});

test('withRegion: Oslo-URL-er er uendret', () => {
  assert.equal(withRegion('/api/vehicles-live', '/', withBergen), '/api/vehicles-live');
  assert.equal(withRegion('/api/route-shapes-all?v=abc', '/', withBergen), '/api/route-shapes-all?v=abc');
});

test('withRegion: Bergen legger til region', () => {
  assert.equal(withRegion('/api/vehicles-live', '/bergen', withBergen), '/api/vehicles-live?region=bergen');
  assert.equal(withRegion('/api/route-shapes-all?v=abc', '/bergen', withBergen), '/api/route-shapes-all?v=abc&region=bergen');
});

test('viewKeyFor: Oslo beholder gammel nøkkel, andre får egen', () => {
  assert.equal(viewKeyFor(REGIONS.oslo, 'ruterlive-view'), 'ruterlive-view');
  assert.equal(viewKeyFor(REGIONS.bergen, 'ruterlive-view'), 'ruterlive-view-bergen');
});

test('parseLineParam: bruker gitt linjeliste, tom liste gir null', async () => {
  const { parseLineParam, linesFor } = await import('../shared/line-list.js');
  const bergen = await linesFor('bergen');
  const l = parseLineParam('?linje=FB50', bergen);
  assert.equal(l.code, 'FB50');
  assert.equal(l.authority, 'NWY');
  assert.equal(parseLineParam('?linje=FB50', []), null);
  assert.equal(parseLineParam('?linje=1', []), null);
  assert.equal(parseLineParam('?linje=1', bergen).mode, 'tram');
  assert.equal(parseLineParam('?linje=1', bergen).slug, 'bybanen-1');
});

import { chooseStartRegion } from '../js/region.js';

const choose = (o) => chooseStartRegion({ pathname: '/', stored: null, permission: 'prompt', position: null, visible: withBergen, ...o });
const bergenPos = { lat: 60.39, lon: 5.32 };
const osloPos = { lat: 59.91, lon: 10.75 };

test('chooseStartRegion: regionssti vinner (ingen løkke)', () => {
  assert.equal(choose({ pathname: '/bergen', stored: 'oslo' }), null);
  assert.equal(choose({ pathname: '/bergen', stored: 'bergen' }), null);
  assert.equal(choose({ pathname: '/bergen', permission: 'granted', position: osloPos }), null);
  assert.equal(choose({ pathname: '/bergen/linje/x', stored: 'oslo' }), null);
});

test('chooseStartRegion: lagret offentlig region ≠ stiens gir den regionens sti', () => {
  assert.equal(choose({ stored: 'bergen' }), '/bergen');
});

test('chooseStartRegion: lagret Oslo på / eller ugyldig/skjult lagret verdi gir null', () => {
  assert.equal(choose({ stored: 'oslo' }), null);
  assert.equal(choose({ stored: 'xyz' }), null);
  assert.equal(choose({ stored: 'bergen', visible: bare }), null);
  assert.equal(choose({ stored: 'toString' }), null);
});

test('chooseStartRegion: posisjon bare med tillatelse granted', () => {
  assert.equal(choose({ permission: 'granted', position: bergenPos }), '/bergen');
  assert.equal(choose({ permission: 'prompt', position: bergenPos }), null);
  assert.equal(choose({ permission: 'denied', position: bergenPos }), null);
  assert.equal(choose({ permission: 'granted', position: null }), null);
  assert.equal(choose({ permission: 'granted', position: osloPos }), null);
  assert.equal(choose({ permission: 'granted', position: bergenPos, visible: bare }), null);
});

test('chooseStartRegion: lagret valg vinner over posisjon', () => {
  assert.equal(choose({ stored: 'oslo', permission: 'granted', position: bergenPos }), null);
});

import { regionForPosition } from '../js/region.js';

test('regionForPosition: annen synlig region gir målet, ellers null', () => {
  assert.equal(regionForPosition(osloPos.lat, osloPos.lon, REGIONS.bergen, withBergen), REGIONS.oslo);
  assert.equal(regionForPosition(bergenPos.lat, bergenPos.lon, REGIONS.oslo, withBergen), REGIONS.bergen);
  assert.equal(regionForPosition(bergenPos.lat, bergenPos.lon, REGIONS.bergen, withBergen), null);
  assert.equal(regionForPosition(osloPos.lat, osloPos.lon, REGIONS.oslo, withBergen), null);
  assert.equal(regionForPosition(0, 0, REGIONS.oslo, withBergen), null);
  assert.equal(regionForPosition(bergenPos.lat, bergenPos.lon, REGIONS.oslo, bare), null);
});

import { hasLinkParams } from '../js/region.js';

test('chooseStartRegion: lenke med ?lat&lng velger regionen for posisjonen, lagret valg ignoreres', () => {
  const osloLink = '?lat=59.91&lng=10.75&z=15';
  assert.equal(choose({ stored: 'bergen', search: osloLink }), null, 'Oslo-lenke på / blir i Oslo');
  assert.equal(choose({ stored: 'bergen', search: `${osloLink}&linje=31` }), null);
  assert.equal(choose({ stored: 'oslo', search: '?lat=60.39&lng=5.32' }), '/bergen', 'Bergen-posisjon på / går til /bergen');
  assert.equal(choose({ pathname: '/bergen', stored: 'bergen', search: osloLink }), '/', 'Oslo-posisjon på /bergen går til /');
  assert.equal(choose({ pathname: '/bergen', search: '?lat=60.39&lng=5.32' }), null);
  assert.equal(choose({ stored: 'bergen', search: '?lat=0&lng=0' }), null, 'utenfor alle regioner: bli der du er');
  assert.equal(choose({ stored: 'oslo', search: '?lat=60.39&lng=5.32', visible: bare }), null, 'skjult region');
});

test('chooseStartRegion: bare ?linje= gir ingen omdirigering, ugyldig lat/lng følger vanlig regel', () => {
  assert.equal(choose({ stored: 'bergen', search: '?linje=31' }), null);
  assert.equal(choose({ stored: 'bergen', search: '?lat=abc&lng=10' }), '/bergen');
  assert.equal(choose({ stored: 'bergen', search: '' }), '/bergen');
});

test('hasLinkParams: lat+lng eller linje', () => {
  assert.equal(hasLinkParams('?lat=59.9&lng=10.7'), true);
  assert.equal(hasLinkParams('?linje=31'), true);
  assert.equal(hasLinkParams('?z=12'), false);
  assert.equal(hasLinkParams(''), false);
  assert.equal(hasLinkParams(undefined), false);
});
