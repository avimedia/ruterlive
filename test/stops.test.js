import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { STOPS, FEATURED_STOPS, slugify, getStopBySlug, findStopByName, nearestStops, getStopText } from '../server/stop-catalog.js';
import { createStopService, LruCache, parseStopInfo } from '../server/stop-service.js';
import { renderStopPage, renderStopIndex, buildIntro, schemaType, catalogLineFor } from '../server/pages/stop-page.js';
import { renderLinePage } from '../server/pages/line-page.js';
import { getLineBySlug, LINES } from '../server/line-catalog.js';
import { buildSitemap } from '../server/pages/sitemap.js';
import { GUIDES } from '../server/guide-catalog.js';
import { renderGuideIndex } from '../server/pages/guide-index.js';

test('slugify', () => {
  assert.equal(slugify('Ullevål stadion'), 'ulleval-stadion');
  assert.equal(slugify('Økern'), 'okern');
  assert.equal(slugify('Ellingsrudåsen'), 'ellingsrudasen');
  assert.equal(slugify('Bærum'), 'baerum');
  assert.equal(slugify('Oslo S'), 'oslo-s');
  assert.equal(slugify('Gaustadalléen'), 'gaustadalleen');
  assert.equal(slugify('  Carl Berners plass! '), 'carl-berners-plass');
});

test('katalogen er gyldig og unik', () => {
  assert.ok(STOPS.length >= 90, `bare ${STOPS.length} stopp`);
  const slugs = new Set();
  const ids = new Set();
  for (const s of STOPS) {
    assert.match(s.slug, /^[a-z0-9]+(-[a-z0-9]+)*$/, s.slug);
    assert.match(s.id, /^NSR:StopPlace:\d+$/, s.id);
    assert.ok(s.name, s.slug);
    assert.ok(s.lat > 59 && s.lat < 61 && s.lon > 9.5 && s.lon < 12, s.slug);
    assert.ok(s.modes.length > 0 && s.modes.every((m) => ['metro', 'tram', 'rail', 'bus', 'water'].includes(m)), s.slug);
    assert.ok(!slugs.has(s.slug), `dobbel slug ${s.slug}`);
    assert.ok(!ids.has(s.id), `dobbel id ${s.id}`);
    slugs.add(s.slug);
    ids.add(s.id);
  }
  // Ikke-utvalgte stopp ligger fortsatt i katalogen
  for (const slug of ['vestli', 'kolsas', 'linderud']) assert.ok(STOPS.some((s) => s.slug === slug), slug);
});

test('bare utvalgte knutepunkter får side', () => {
  assert.ok(FEATURED_STOPS.length >= 28 && FEATURED_STOPS.length <= 36, `${FEATURED_STOPS.length} utvalgte`);
  assert.ok(FEATURED_STOPS.length < STOPS.length);
  for (const slug of ['oslo-s', 'nationaltheatret', 'majorstuen', 'jernbanetorget', 'skoyen', 'lillestrom', 'oslo-lufthavn']) {
    assert.ok(getStopBySlug(slug), slug);
  }
  for (const slug of ['vestli', 'kolsas', 'linderud', 'finnes-ikke']) assert.equal(getStopBySlug(slug), undefined, slug);
});

test('findStopByName og nearestStops gjelder bare utvalgte stopp', () => {
  assert.equal(findStopByName('Majorstuen')?.slug, 'majorstuen');
  assert.equal(findStopByName('Skøyen')?.slug, 'skoyen');
  assert.equal(findStopByName('Lysaker stasjon')?.slug, 'lysaker');
  assert.equal(findStopByName('Finnes ikke'), undefined);
  assert.equal(findStopByName('Linderud T'), undefined);
  assert.equal(findStopByName('Vestli'), undefined);
  const near = nearestStops(getStopBySlug('majorstuen'), 3);
  assert.equal(near.length, 3);
  assert.ok(near.every((n) => n.stop.slug !== 'majorstuen' && n.stop.featured));
  assert.ok(near[0].distance <= near[1].distance && near[1].distance <= near[2].distance);
  assert.deepEqual(nearestStops(getStopBySlug('lillestrom'), 3, { maxDistance: 3000 }), []);
});

const BANNED = [/det er viktig å merke seg/i, /i en travel hverdag/i, /alt i alt/i, /kort fortalt/i];

test('hver utvalgt holdeplass har håndskrevet tekst på 120–250 ord', async () => {
  for (const s of FEATURED_STOPS) {
    const file = new URL(`../content/holdeplass/${s.slug}.html`, import.meta.url);
    assert.ok(existsSync(file), `mangler content/holdeplass/${s.slug}.html`);
    const html = readFileSync(file, 'utf8');
    const words = html.replace(/<[^>]*>/g, ' ').split(/\s+/).filter(Boolean).length;
    assert.ok(words >= 120 && words <= 250, `${s.slug}: ${words} ord`);
    for (const re of BANNED) assert.doesNotMatch(html, re, s.slug);
    assert.doesNotMatch(html, /<script|<h1/i, s.slug);
    assert.equal(await getStopText(s.slug), html);
  }
  // Ingen tekster for stopp uten side
  const featured = new Set(FEATURED_STOPS.map((s) => s.slug));
  for (const f of readdirSync(new URL('../content/holdeplass/', import.meta.url))) {
    assert.ok(featured.has(f.replace(/\.html$/, '')), `${f} hører ikke til et utvalgt stopp`);
  }
  assert.equal(await getStopText('vestli'), undefined);
  assert.equal(await getStopText('../om'), undefined);
});

const stop = { slug: 'majorstuen', id: 'NSR:StopPlace:58381', name: 'Majorstuen', lat: 59.92963, lon: 10.71494, modes: ['metro', 'tram', 'bus'] };
const info = {
  lines: [
    { id: 'RUT:Line:5', publicCode: '5', transportMode: 'metro' },
    { id: 'RUT:Line:1', publicCode: '1', transportMode: 'metro' },
    { id: 'RUT:Line:12', publicCode: '12', transportMode: 'tram' },
    { id: 'RUT:Line:20', publicCode: '20', transportMode: 'bus' },
  ],
  zones: ['1'],
  quayCount: 6,
};
const NOW = Date.parse('2026-10-22T10:00:00Z');
const departures = {
  fetchedAt: '2026-10-22T10:00:00Z',
  departures: [
    { aimed: '2026-10-22T10:02:00Z', expected: '2026-10-22T10:05:00Z', realtime: true, cancelled: false, platform: '1', destination: 'Vestli <x>', line: { id: 'RUT:Line:5', publicCode: '5', transportMode: 'metro' } },
    { aimed: '2026-10-22T10:03:00Z', expected: '2026-10-22T10:03:00Z', realtime: false, cancelled: false, platform: '', destination: 'Galgeberg', line: { id: 'RUT:Line:20', publicCode: '20', transportMode: 'bus' } },
    { aimed: '2026-10-22T10:04:00Z', expected: '2026-10-22T10:04:00Z', realtime: true, cancelled: true, platform: '', destination: 'Ljabru', line: { id: 'RUT:Line:19', publicCode: '19', transportMode: 'tram' } },
    { aimed: '2026-10-22T09:50:00Z', expected: '2026-10-22T09:50:00Z', realtime: true, cancelled: false, platform: '', destination: 'Gått', line: { id: 'RUT:Line:1', publicCode: '1', transportMode: 'metro' } },
  ],
};

test('buildIntro bruker modus, linjer, sone og stoppesteder', () => {
  const text = buildIntro(stop, info);
  assert.equal(text, 'Majorstuen er en stasjon for T-bane, trikk og buss. Her stopper T-banelinjene 1 og 5, trikkelinje 12, samt busslinje 20. Stasjonen ligger i Ruters sone 1 og har 6 stoppesteder (plattformer og holdeplasser).');
  const simple = { lines: [{ id: 'RUT:Line:5', publicCode: '5', transportMode: 'metro' }, { id: 'RUT:Line:20', publicCode: '20', transportMode: 'bus' }], zones: [], quayCount: 1 };
  assert.match(buildIntro(stop, simple), /Her stopper T-banelinje 5 og busslinje 20\.$/);
  assert.equal(buildIntro(stop, null), 'Majorstuen er en stasjon for T-bane, trikk og buss.');
  const many = { lines: Array.from({ length: 12 }, (_, i) => ({ id: `RUT:Line:${30 + i}`, publicCode: String(30 + i), transportMode: 'bus' })), zones: [], quayCount: 1 };
  assert.match(buildIntro({ ...stop, modes: ['bus'] }, many), /^Majorstuen er en holdeplass for buss\. Her stopper 12 busslinjer\./);
});

test('renderStopPage med avganger', () => {
  const html = renderStopPage(stop, info, departures, { now: NOW });
  assert.match(html, /<h1>Majorstuen<\/h1>/);
  assert.match(html, /class="mode-badge" data-mode="metro">T-bane</);
  assert.ok(html.includes('href="/?lat=59.92963&amp;lng=10.71494&amp;z=16"'));
  assert.ok(html.includes('Vestli &lt;x&gt;'));
  assert.ok(!html.includes('Gått'), 'passerte avganger vises ikke');
  assert.equal((html.match(/<tr>|<tr class/g) || []).length, 1 + 3);
  assert.ok(html.includes('href="/linje/t-bane-5"'));
  assert.ok(html.includes('href="/linje/buss-20"'), 'Ruter-buss 20 har linjeside');
  assert.ok(html.includes('+3 min'));
  assert.ok(html.includes('Rutetid'));
  assert.ok(html.includes('Innstilt'));
  assert.ok(html.includes('<th scope="col">Plf.</th>'));
  assert.ok(html.includes('"@type":"SubwayStation"'));
  assert.ok(html.includes('"url":"https://livetrafikk.no/holdeplass/majorstuen"'));
  assert.ok(html.includes('<link rel="canonical" href="https://livetrafikk.no/holdeplass/majorstuen">'));
  assert.equal((html.match(/href="\/holdeplass\//g) || []).length, 3, 'tre nærmeste');
  assert.ok(html.includes('adsbygoogle'));
  assert.ok(!html.includes('stop-text'), 'ingen tekst uten text');
});

test('renderStopPage viser håndskrevet tekst før avgangene', () => {
  const html = renderStopPage(stop, info, departures, { now: NOW, text: '<p>Håndskrevet <a href="/linje/t-bane-1">tekst</a>.</p>\n' });
  const textAt = html.indexOf('<div class="prose stop-text">');
  assert.ok(textAt > 0);
  assert.ok(html.includes('<p>Håndskrevet <a href="/linje/t-bane-1">tekst</a>.</p>'), 'escapes ikke');
  assert.ok(textAt > html.indexOf('class="lead"') && textAt < html.indexOf('<h2>Neste avganger</h2>'));
});

test('renderStopPage uten utvalgte stopp i nærheten utelater seksjonen', () => {
  const html = renderStopPage(getStopBySlug('lillestrom'), null, null, { now: NOW });
  assert.ok(!html.includes('I nærheten'));
  assert.equal((html.match(/href="\/holdeplass\//g) || []).length, 0);
});

test('renderStopPage uten avganger og uten info', () => {
  const html = renderStopPage(stop, null, null, { now: NOW });
  assert.ok(html.includes('Avganger er midlertidig utilgjengelige'));
  assert.ok(!html.includes('<table'));
  assert.ok(html.includes('<h1>Majorstuen</h1>'));
  const empty = renderStopPage(stop, info, { fetchedAt: departures.fetchedAt, departures: [] }, { now: NOW });
  assert.ok(empty.includes('Ingen avganger de neste tre timene'));
});

test('schemaType og catalogLineFor', () => {
  assert.equal(schemaType(['metro', 'rail']), 'TrainStation');
  assert.equal(schemaType(['metro', 'bus']), 'SubwayStation');
  assert.equal(schemaType(['tram', 'bus']), 'BusStation');
  assert.equal(schemaType(['water']), 'BoatTerminal');
  assert.equal(catalogLineFor({ id: 'VYG:Line:L2x', publicCode: 'L2x' })?.slug, 'tog-l2');
  assert.equal(catalogLineFor({ id: 'SJN:Line:21', publicCode: 'F6' }), undefined);
});

test('parseStopInfo slår sammen linjer og leser Ruter-sone', () => {
  const parsed = parseStopInfo({
    tariffZones: [{ id: 'RUT:TariffZone:1', name: '1' }, { id: 'BRA:TariffZone:311', name: 'Oslo' }],
    quays: [
      { lines: [{ id: 'RUT:Line:1', publicCode: '1', transportMode: 'metro' }] },
      { lines: [{ id: 'RUT:Line:1', publicCode: '1', transportMode: 'metro' }, { id: 'RUT:Line:2', publicCode: '2', transportMode: 'metro' }] },
    ],
  });
  assert.deepEqual(parsed.zones, ['1']);
  assert.equal(parsed.lines.length, 2);
  assert.equal(parsed.quayCount, 2);
});

test('renderStopIndex lister bare utvalgte stopp i grupper', () => {
  const html = renderStopIndex();
  for (const s of FEATURED_STOPS) assert.ok(html.includes(`href="/holdeplass/${s.slug}"`), s.slug);
  assert.ok(!html.includes('href="/holdeplass/vestli"'));
  assert.ok(html.includes('<h2>T-bane</h2>'));
  assert.ok(html.includes('<h2>Tog</h2>'));
});

test('linjesiden lenker bare utvalgte stopp', () => {
  const html = renderLinePage(getLineBySlug('t-bane-5'), { stops: ['Vestli', 'Ukjent stopp', 'Majorstuen', 'Sognsvann'], from: 'Vestli', to: 'Sognsvann' }, 3);
  assert.ok(html.includes('<li>Vestli</li>'));
  assert.ok(html.includes('<li><a href="/holdeplass/majorstuen">Majorstuen</a></li>'));
  assert.ok(html.includes('<li>Ukjent stopp</li>'));
  assert.ok(html.includes('<li>Sognsvann</li>'));
});

test('sitemap og /guider har bare utvalgte holdeplasser', () => {
  const xml = buildSitemap({ lines: LINES, guides: GUIDES, stops: FEATURED_STOPS });
  assert.ok(xml.includes('<loc>https://livetrafikk.no/holdeplasser</loc>'));
  for (const s of FEATURED_STOPS) assert.ok(xml.includes(`<loc>https://livetrafikk.no/holdeplass/${s.slug}</loc>`));
  assert.ok(!xml.includes('/holdeplass/vestli<'));
  assert.equal((xml.match(/<url>/g) || []).length, 4 + LINES.length + GUIDES.length + 1 + FEATURED_STOPS.length);
  assert.ok(renderGuideIndex(GUIDES, LINES).includes('href="/holdeplasser"'));
});

test('LruCache kaster eldste og fornyer ved get', () => {
  const c = new LruCache(2);
  c.set('a', 1);
  c.set('b', 2);
  c.get('a');
  c.set('c', 3);
  assert.equal(c.get('b'), undefined);
  assert.equal(c.get('a'), 1);
  assert.equal(c.size, 2);
});

function fakeFetch({ fail = false, delay = 0 } = {}) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push(JSON.parse(opts.body));
    assert.equal(opts.headers['ET-Client-Name'], 'ruterlive-web');
    if (delay) await new Promise((r) => setTimeout(r, delay));
    if (fail) return { ok: false, status: 429, json: async () => ({}) };
    const body = JSON.parse(opts.body);
    const sp = body.query.includes('estimatedCalls')
      ? { estimatedCalls: [{ realtime: true, aimedDepartureTime: '2026-10-22T10:05:00Z', expectedDepartureTime: '2026-10-22T10:06:00Z', quay: { publicCode: '1' }, destinationDisplay: { frontText: 'Vestli' }, serviceJourney: { line: { id: 'RUT:Line:5', publicCode: '5', transportMode: 'metro' } } }] }
      : { id: body.variables.id, name: 'X', tariffZones: [], quays: [] };
    return { ok: true, json: async () => ({ data: { stopPlace: sp } }) };
  };
  fn.calls = calls;
  return fn;
}

test('avganger: cache, in-flight-dedup og GraphQL-variabler', async () => {
  let t = 0;
  const fetchFn = fakeFetch({ delay: 5 });
  const svc = createStopService({ fetchFn, now: () => t });
  const results = await Promise.all(Array.from({ length: 10 }, () => svc.getDepartures(stop)));
  assert.equal(fetchFn.calls.length, 1);
  assert.ok(results.every((r) => r === results[0]));
  assert.equal(results[0].departures[0].destination, 'Vestli');
  assert.deepEqual(fetchFn.calls[0].variables, { id: stop.id, n: 12, range: 10800 });
  t = 59000;
  await svc.getDepartures(stop);
  assert.equal(fetchFn.calls.length, 1, 'fortsatt cachet');
  t = 61000;
  await svc.getDepartures(stop);
  assert.equal(fetchFn.calls.length, 2, 'utløpt etter 60 s');
  await svc.getInfo(stop);
  await svc.getInfo(stop);
  assert.equal(fetchFn.calls.length, 3, 'info hentes én gang');
});

test('avganger: feil gir null og caches kort', async () => {
  let t = 0;
  const fetchFn = fakeFetch({ fail: true });
  const svc = createStopService({ fetchFn, now: () => t });
  assert.equal(await svc.getDepartures(stop), null);
  assert.equal(await svc.getDepartures(stop), null);
  assert.equal(fetchFn.calls.length, 1);
  t = 21000;
  await svc.getDepartures(stop);
  assert.equal(fetchFn.calls.length, 2);
});

test('avganger: LRU-tak på antall holdeplasser', async () => {
  const fetchFn = fakeFetch();
  const svc = createStopService({ fetchFn, now: () => 0, maxEntries: 2 });
  const a = { id: 'NSR:StopPlace:1' };
  const b = { id: 'NSR:StopPlace:2' };
  const c = { id: 'NSR:StopPlace:3' };
  await svc.getDepartures(a);
  await svc.getDepartures(b);
  await svc.getDepartures(c);
  assert.equal(fetchFn.calls.length, 3);
  await svc.getDepartures(c);
  await svc.getDepartures(b);
  assert.equal(fetchFn.calls.length, 3);
  await svc.getDepartures(a);
  assert.equal(fetchFn.calls.length, 4, 'a ble kastet ut');
});

test('avganger: hengende kall avbrytes av tidsgrensen', async () => {
  const fetchFn = async () => new Promise(() => {});
  const svc = createStopService({ fetchFn, now: () => 0, timeoutMs: 20 });
  assert.equal(await svc.getDepartures(stop), null);
});

test('buildIntro lister ikke linjer når siden har håndskrevet tekst', () => {
  const stop = { name: 'Carl Berners plass', modes: ['metro', 'tram', 'bus'] };
  const info = { lines: [{ publicCode: '1', transportMode: 'metro' }, { publicCode: '5', transportMode: 'metro' }], zones: ['1'], quayCount: 6 };
  const intro = buildIntro(stop, info, { listLines: false });
  assert.doesNotMatch(intro, /Her stopper/);
  assert.match(intro, /sone 1/);
});
