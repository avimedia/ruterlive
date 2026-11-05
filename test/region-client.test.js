import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePreview, currentRegion, withRegion, viewKeyFor } from '../js/region.js';
import { REGIONS, visibleRegions } from '../shared/regions.js';

const withBergen = visibleRegions(['bergen']);
const bare = visibleRegions([]);

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
