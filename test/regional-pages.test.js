// Regionale sider: ruter, kartsider (tittel/ingen AdSense), sitemap, stoppkatalog og stopplister per region.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { REGIONS, visibleRegions } from '../shared/regions.js';
import { registerPageRoutes } from '../server/page-routes.js';
import { buildSitemap, isMapPath } from '../server/pages/sitemap.js';
import { regionMapHtml } from '../server/pages/region-map.js';
import { REGION_LINES, getLineStops, getLineBySlug } from '../server/line-catalog.js';
import { countVehiclesForLine } from '../server/live-vehicles.js';
import { getStopBySlug, loadStops, featuredStopsFor } from '../server/stop-catalog.js';
import { renderStopPage, renderStopIndex } from '../server/pages/stop-page.js';
import { renderGuideIndex } from '../server/pages/guide-index.js';
import { renderGuidePage } from '../server/pages/guide-page.js';
import { renderLinePage } from '../server/pages/line-page.js';

const visible = visibleRegions(['bergen']);
const bergen = REGIONS.bergen;
const stubGuide = { slug: 'bybanen', region: 'bergen', title: 'Bybanen i Bergen', description: 'Om Bybanen.', published: '2026-11-05', updated: '2026-11-05' };
const stubStop = { slug: 'byparken', id: 'NSR:StopPlace:1', name: 'Byparken', lat: 60.39, lon: 5.32, modes: ['tram'], region: 'bergen', featured: true };

const dir = mkdtempSync(path.join(tmpdir(), 'regional-'));
const indexPath = path.join(dir, 'index.html');
writeFileSync(indexPath, readFileSync(new URL('../index.html', import.meta.url), 'utf8'));

let server;
let base;
let calls;

function startApp(deps = {}) {
  const app = express();
  calls = { vehicles: [] };
  registerPageRoutes(app, {
    visible,
    indexPath,
    sendNotFound: (res) => res.status(404).type('html').send('<h1>404</h1>'),
    getLineStops: async () => ({ stops: ['A', 'B', 'C'], from: 'A', to: 'C', name: 'x', fetchedAt: '2026-11-05T10:00:00Z' }),
    getMergedVehicles: async (regionId) => { calls.vehicles.push(regionId); return []; },
    stopService: { getInfo: async () => null, getDepartures: async () => null },
    getGuide: (slug, regionId) => (regionId === 'bergen' && slug === stubGuide.slug ? stubGuide : undefined),
    loadGuideBody: async () => '<p>Brødtekst</p>',
    getStop: (slug, regionId) => (regionId === 'bergen' && slug === stubStop.slug ? stubStop : undefined),
    getStopText: async () => '',
    ...deps,
  });
  return new Promise((resolve) => {
    server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); });
  });
}

before(() => startApp());
after(() => server.close());

const get = async (p) => { const r = await fetch(base + p); return { status: r.status, body: await r.text() }; };

test('/bergen: kartet med Bergens tittel, canonical og uten AdSense', async () => {
  const { status, body } = await get('/bergen');
  assert.equal(status, 200);
  assert.match(body, /<title>[^<]*Bergen og Vestland[^<]*<\/title>/);
  assert.doesNotMatch(body, /<title>[^<]*Oslo/);
  assert.match(body, /<link rel="canonical" href="https:\/\/livetrafikk\.no\/bergen">/);
  assert.match(body, /<meta property="og:title" content="[^"]*Bergen og Vestland/);
  assert.match(body, /<meta name="twitter:description" content="[^"]*Bergen og Vestland/);
  assert.match(body, /<meta name="description" content="[^"]*Bergen og Vestland/);
  assert.doesNotMatch(body, /adsbygoogle|pagead2/);
  assert.equal((await get('/bergen/')).status, 200);
});

test('/bergen/linje/buss-23: 200 og noindex uten tekst, ingen AdSense, Bergens kjøretøy', async () => {
  const { status, body } = await get('/bergen/linje/buss-23');
  assert.equal(status, 200);
  assert.match(body, /<meta name="robots" content="noindex">/);
  assert.doesNotMatch(body, /adsbygoogle/);
  assert.deepEqual(calls.vehicles.at(-1), 'bergen');
  assert.match(body, /Buss 23/);
});

test('/bergen/linje/bybanen-1 med egen tekst: indeksert, AdSense, canonical og Bergen-guide', async () => {
  const { status, body } = await get('/bergen/linje/bybanen-1');
  assert.equal(status, 200);
  assert.doesNotMatch(body, /name="robots"/);
  assert.match(body, /adsbygoogle/);
  assert.match(body, /<link rel="canonical" href="https:\/\/livetrafikk\.no\/bergen\/linje\/bybanen-1">/);
  assert.match(body, /<div class="prose line-text">/);
  assert.match(body, /href="\/bergen\/guider\/bybanen-i-bergen">Bybanen i Bergen</);
});

test('linjesider: riktig region, aldri på tvers', async () => {
  assert.equal((await get('/bergen/linje/t-bane-5')).status, 404);
  assert.equal((await get('/linje/t-bane-5')).status, 200);
  assert.equal((await get('/linje/bybanen-1')).status, 404); // Bergen-linje på Oslo-stien
  assert.equal((await get('/bergen/linje/finnes-ikke')).status, 404);
  const oslo = await get('/linje/t-bane-5');
  assert.doesNotMatch(oslo.body, /name="robots"/);
  assert.match(oslo.body, /adsbygoogle/);
});

test('Oslo-linje kaller Oslos kjøretøy', async () => {
  await get('/linje/buss-20');
  assert.equal(calls.vehicles.at(-1), 'oslo');
});

test('slug som finnes i begge regioner gir hver sin side', async () => {
  const b = await get('/bergen/linje/buss-20');
  const o = await get('/linje/buss-20');
  assert.equal(b.status, 200);
  assert.equal(o.status, 200);
  assert.notEqual(b.body, o.body);
});

test('regionale guider og holdeplasser (stub), 404 på tvers av regioner', async () => {
  const g = await get('/bergen/guider/bybanen');
  assert.equal(g.status, 200);
  assert.match(g.body, /Bybanen i Bergen/);
  assert.equal((await get('/guider/bybanen')).status, 404);
  const s = await get('/bergen/holdeplass/byparken');
  assert.equal(s.status, 200);
  assert.match(s.body, /Byparken/);
  assert.equal((await get('/holdeplass/byparken')).status, 404);
  assert.equal((await get('/bergen/holdeplass/majorstuen')).status, 404);
});

test('skjult region: ingen ruter', async () => {
  const hidden = express();
  registerPageRoutes(hidden, { visible: visibleRegions([]), indexPath, sendNotFound: (res) => res.status(404).end(), getLineStops: async () => null, getMergedVehicles: async () => [], stopService: {} });
  const s = hidden.listen(0);
  const r = await fetch(`http://127.0.0.1:${s.address().port}/bergen/linje/bybanen-1`);
  assert.equal(r.status, 404);
  s.close();
});

test('isMapPath: Oslo alltid, regionstier bare for synlige regioner', () => {
  assert.ok(isMapPath('/') && isMapPath('/index.html'));
  assert.ok(isMapPath('/bergen', visible) && isMapPath('/bergen/', visible));
  assert.ok(!isMapPath('/bergen'));
  assert.ok(!isMapPath('/bergen/linje/buss-3', visible));
  assert.ok(!isMapPath('/linje/buss-3', visible));
});

test('regionMapHtml bytter tittel, beskrivelse, og/twitter og canonical', () => {
  const html = regionMapHtml(readFileSync(indexPath, 'utf8'), bergen);
  assert.equal([...html.matchAll(/Bergen og Vestland/g)].length >= 6, true);
  assert.doesNotMatch(html, /i Oslo i sanntid/);
  assert.match(html, /<meta property="og:url" content="https:\/\/livetrafikk\.no\/bergen">/);
});

test('sitemap: Bergen-linjer bare når indexed, regionkart, holdeplasser og guider', () => {
  const lines = [
    ...REGION_LINES.oslo,
    { ...getLineBySlug('buss-3', 'bergen'), indexed: false },
    { ...getLineBySlug('bybanen-1', 'bergen'), indexed: true },
  ];
  const xml = buildSitemap({ lines, guides: [stubGuide], stops: [stubStop], regions: visible });
  assert.ok(xml.includes('<loc>https://livetrafikk.no/bergen</loc>'));
  assert.ok(xml.includes('<loc>https://livetrafikk.no/bergen/linje/bybanen-1</loc>'));
  assert.ok(!xml.includes('/bergen/linje/buss-3<'));
  assert.ok(xml.includes('<loc>https://livetrafikk.no/bergen/guider/bybanen</loc>'));
  assert.ok(xml.includes('<loc>https://livetrafikk.no/bergen/holdeplass/byparken</loc>'));
  assert.ok(xml.includes('<loc>https://livetrafikk.no/linje/t-bane-5</loc>'));
  // Ekte utvalgte Bergen-stopp, slik server.js bygger sitemap for synlige regioner
  const real = buildSitemap({ lines: REGION_LINES.oslo, guides: [], stops: visible.flatMap((r) => featuredStopsFor(r.id)), regions: visible });
  for (const s of featuredStopsFor('bergen')) assert.ok(real.includes(`<loc>https://livetrafikk.no/bergen/holdeplass/${s.slug}</loc>`), s.slug);
  assert.ok(!real.includes('<loc>https://livetrafikk.no/holdeplass/byparken</loc>'));
  const noRegions = buildSitemap({ lines: REGION_LINES.oslo, guides: [] });
  assert.ok(!noRegions.includes('/bergen'));
});

test('stopp: getStopBySlug per region, region-felt, katalogfil mangler gir tom liste', () => {
  assert.equal(getStopBySlug('majorstuen').region, 'oslo');
  assert.equal(getStopBySlug('majorstuen', 'bergen'), undefined);
  assert.deepEqual(loadStops('finnes-ikke'), []);
  assert.ok(featuredStopsFor('bergen').every((s) => s.region === 'bergen' && s.featured));
  assert.equal(getStopBySlug('byparken', 'bergen')?.id, 'NSR:StopPlace:30859');
});

test('stoppside og stoppoversikt for Bergen: region-sti, ingen Ruter-sone', () => {
  const html = renderStopPage(stubStop, { lines: [], zones: ['1'], quayCount: 1 }, null);
  assert.match(html, /<link rel="canonical" href="https:\/\/livetrafikk\.no\/bergen\/holdeplass\/byparken">/);
  assert.match(html, /<a href="\/bergen">Bergen<\/a>/);
  assert.doesNotMatch(html, /Ruters sone/);
  const idx = renderStopIndex([], [{ region: bergen, stops: [stubStop] }]);
  assert.match(idx, /href="\/bergen\/holdeplass\/byparken"/);
  assert.match(idx, /Bergen og Vestland/);
  assert.doesNotMatch(renderStopIndex([], [{ region: bergen, stops: [] }]), /Bergen/);
});

test('guideoversikt viser regionseksjon bare når regionen har innhold', () => {
  const none = renderGuideIndex([], REGION_LINES.oslo, [{ region: bergen, guides: [], lines: REGION_LINES.bergen.map((l) => ({ ...l, indexed: false })) }]);
  assert.doesNotMatch(none, /\/bergen\//); // ingen indekserte Bergen-linjer
  const withGuide = renderGuideIndex([], REGION_LINES.oslo, [{ region: bergen, guides: [stubGuide], lines: [{ ...getLineBySlug('bybanen-1', 'bergen'), indexed: true }] }]);
  assert.match(withGuide, /href="\/bergen\/guider\/bybanen"/);
  assert.match(withGuide, /href="\/bergen\/linje\/bybanen-1"/);
  assert.match(withGuide, /Bergen og Vestland/);
  const page = renderGuidePage(stubGuide, '<p>x</p>', [stubGuide, { ...stubGuide, slug: 'b2', title: 'B2' }]);
  assert.match(page, /href="\/bergen\/guider\/b2"/);
  assert.match(page, /rel="canonical" href="https:\/\/livetrafikk\.no\/bergen\/guider\/bybanen"/);
});

test('linjeside for Bergen: brødsmuler, region-lenker og kartlenke', () => {
  const line = { ...getLineBySlug('bybanen-1', 'bergen'), indexed: true };
  const html = renderLinePage(line, { stops: ['Byparken', 'B', 'Lagunen'], from: 'Byparken', to: 'Lagunen', fetchedAt: null }, 2, '<p>tekst</p>');
  assert.match(html, /<a href="\/bergen">Bergen<\/a>/);
  assert.match(html, /href="\/bergen\?lat=60\.3925&amp;lng=5\.324&amp;z=12"/);
  assert.match(html, /href="\/bergen\/linje\/bybanen-2"/); // andre linjer: bare de med egen tekst
  const bus = renderLinePage(getLineBySlug('buss-3', 'bergen'), null, null, '<p>tekst</p>');
  assert.match(bus, /href="\/bergen\/linje\/buss-4"/);
  assert.doesNotMatch(bus, /\/bergen\/linje\/buss-23"/);
  assert.match(html, /rel="canonical" href="https:\/\/livetrafikk\.no\/bergen\/linje\/bybanen-1"/);
  assert.match(html, /"name":"Bergen"/);
  assert.doesNotMatch(html, /t-banen-i-oslo|trikken-i-oslo/);
  assert.match(html, /adsbygoogle/); // indeksert side med tekst
});

test('getLineStops for Bergen: ref brukes direkte, SKY-linjer slås opp via authorities, cache per region', async () => {
  const queries = [];
  const fetchFn = async (_url, opts) => {
    const q = JSON.parse(opts.body).query;
    queries.push(q);
    if (q.includes('authorities')) return { ok: true, json: async () => ({ data: { lines: [{ id: 'SKY:Line:1', publicCode: '1' }, { id: 'SKY:Line:bestilling', publicCode: '3', transportMode: 'bus' }, { id: 'SKY:Line:tram3', publicCode: '3', transportMode: 'tram' }] } }) };
    return { ok: true, json: async () => ({ data: { line: { name: 'Bybanen', journeyPatterns: [{ quays: [{ name: 'Byparken' }, { name: 'M' }, { name: 'Lagunen' }], serviceJourneys: [{ id: 'a', transportMode: 'tram' }] }] } } }) };
  };
  const b1 = await getLineStops(getLineBySlug('bybanen-1', 'bergen'), fetchFn);
  assert.equal(b1.from, 'Byparken');
  assert.ok(queries[0].includes('SKY:Authority:SKY'));
  assert.ok(queries.some((q) => q.includes('"SKY:Line:1"')));
  // Flybussen har ref: ingen oppslag
  const before = queries.length;
  await getLineStops(getLineBySlug('flybuss-fb50', 'bergen'), fetchFn);
  assert.equal(queries.length, before + 1);
  assert.ok(queries.at(-1).includes('NWY:Line:487168df'));
  // Oslo-linje med samme slug-nøkkel kolliderer ikke i cachen
  const oslo = await getLineStops({ ...getLineBySlug('buss-20'), slug: 'bybanen-1' }, async () => ({ ok: true, json: async () => ({ data: { lines: [] } }) }));
  assert.equal(oslo, null);
});

test('countVehiclesForLine: Bergen-linje teller bare egen operatør og modus', () => {
  const line = getLineBySlug('buss-3', 'bergen');
  const v = (ref, mode) => ({ mode, line: { publicCode: '3', lineRef: ref } });
  assert.equal(countVehiclesForLine([v('SKY:Line:3', 'bus'), v('RUT:Line:3', 'bus'), v('SKY:Line:3', 'tram')], line), 1);
  const boat = REGION_LINES.bergen.find((l) => l.mode === 'water');
  assert.equal(countVehiclesForLine([{ mode: 'water', line: { publicCode: boat.code, lineRef: `${boat.authority}:Line:x` } }], boat), 1);
});

test('regionkart: ingen hreflang, canonical /bergen', () => {
  const html = regionMapHtml(readFileSync(indexPath, 'utf8'), bergen);
  assert.doesNotMatch(html, /hreflang/);
  assert.match(html, /<link rel="canonical" href="https:\/\/livetrafikk\.no\/bergen">/);
});

test('regionMapHtml mot bygd dist/index.html: alle bytter treffer (hoppes over uten dist)', { skip: !existsSync(new URL('../dist/index.html', import.meta.url)) }, (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const html = regionMapHtml(readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8'), { ...bergen, id: 'dist-test' });
  assert.equal(warn.mock.calls.length, 0);
  assert.doesNotMatch(html, /hreflang|i Oslo i sanntid/);
});

test('regionMapHtml advarer når et mønster ikke treffer', (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  regionMapHtml('<html></html>', { ...bergen, id: 'warn-test' });
  regionMapHtml('<html></html>', { ...bergen, id: 'warn-test' });
  assert.equal(warn.mock.calls.length, 1);
  assert.match(warn.mock.calls[0].arguments[0], /traff ikke/);
});

// ID-cachen for Bergen er delt med testen over, som leverer de to linjene med kode 3
test('getLineStops: to JP-linjer med samme kode, modus avgjør', async () => {
  const queries = [];
  const fetchFn = async (_u, opts) => {
    const q = JSON.parse(opts.body).query;
    queries.push(q);
    if (q.includes('authorities')) return { ok: true, json: async () => ({ data: { lines: [
      { id: 'SKY:Line:bestilling', publicCode: '3', transportMode: 'bus' },
      { id: 'SKY:Line:tram3', publicCode: '3', transportMode: 'tram' },
    ] } }) };
    return { ok: true, json: async () => ({ data: { line: { name: 'x', journeyPatterns: [{ quays: [{ name: 'A' }, { name: 'B' }, { name: 'C' }], serviceJourneys: [] }] } } }) };
  };
  const line = { slug: 'dup-test-tram', code: '3', authority: 'SKY', mode: 'tram', title: 'x', regionId: 'bergen' };
  await getLineStops(line, fetchFn);
  assert.ok(queries.at(-1).includes('SKY:Line:tram3'));
  await getLineStops({ ...line, slug: 'dup-test-bus', mode: 'bus' }, fetchFn);
  assert.ok(queries.at(-1).includes('SKY:Line:bestilling'));
});

test('tom kjøretøyliste i ikke-Oslo-region: ingen telling og kort cache', async () => {
  const r = await fetch(`${base}/bergen/linje/bybanen-1`);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.doesNotMatch(await r.text(), /Ute akkurat nå/);
});
