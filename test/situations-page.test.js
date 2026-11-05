// /avvik: grupper per område, escaping, lenker, tom/utilgjengelig, annonser, tekst, sitemap og meny.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderSituationsPage, formatValidityPeriod } from '../server/pages/situations-page.js';
import { createSituationLinks } from '../server/situation-links.js';
import { buildSituationIndex } from '../server/situations-model.js';
import { buildSitemap } from '../server/pages/sitemap.js';
import { renderPage } from '../server/pages/layout.js';
import { REGIONS } from '../shared/regions.js';

const NOW = Date.parse('2026-11-05T12:00:00Z');

const sit = (over) => ({
  id: 'RUT:SituationNumber:1',
  codespace: 'RUT',
  severity: 'normal',
  planned: false,
  validity: [],
  summary: 'Oppsummering',
  description: '',
  advice: '',
  links: [],
  lines: [],
  stops: [],
  ...over,
});

const SITUATIONS = [
  sit({ id: 'SKY:1', codespace: 'SKY', summary: 'Bybanen stopper', lines: [{ ref: 'SKY:Line:1', code: '1' }] }),
  sit({ id: 'RUT:1', codespace: 'RUT', summary: 'Omkjøring', description: 'Farlig <script>alert(1)</script>', lines: [{ ref: 'RUT:Line:31', code: '31' }, { ref: 'RUT:Line:9999', code: '9999' }] }),
  sit({ id: 'NSB:1', codespace: 'NSB', summary: 'Buss for tog', stops: [{ id: 'NSR:StopPlace:337', name: 'Oslo S' }] }),
  sit({ id: 'XYZ:1', codespace: 'XYZ', summary: 'Ukjent område', lines: [{ ref: 'XYZ:Line:5', code: '5' }] }),
  sit({ id: 'NSB:2', codespace: 'NSB', summary: 'Færre vogner' }), // uten mål: listes ikke
];
const index = buildSituationIndex(SITUATIONS);

const lineLink = (ref) => ({ 'RUT:Line:31': '/linje/buss-31', 'SKY:Line:1': '/bergen/linje/bybanen-1' })[ref] ?? null;
const stopLink = (id) => (id === 'NSR:StopPlace:337' ? '/holdeplass/oslo-s' : null);
const TEXT = '<p>Fast tekst om avvik.</p>';
const render = (over = {}) => renderSituationsPage({ index, text: TEXT, now: NOW, lineLink, stopLink, ...over });

test('grupper i SITUATION_AREAS-rekkefølge, tomme områder vises ikke, hopplenker til hvert synlig område', () => {
  const html = render();
  const order = ['avvik-rail', 'avvik-rut', 'avvik-sky', 'avvik-other'].map((id) => html.indexOf(`id="${id}"`));
  for (const i of order) assert.ok(i > 0);
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  for (const id of ['avvik-rail', 'avvik-rut', 'avvik-sky', 'avvik-other']) assert.ok(html.includes(`href="#${id}"`), id);
  assert.ok(!html.includes('id="avvik-atb"'));
  assert.ok(!html.includes('href="#avvik-atb"'));
  assert.ok(!html.includes('Færre vogner'), 'avvik uten linjer og holdeplasser listes ikke');
  assert.ok(html.includes('XYZ'), 'ukjent kodeområde vises med koden');
});

test('operatørtekst escapes', () => {
  const html = render();
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});

test('lenker bare til linjer og holdeplasser som finnes; ukjent linje er merke uten lenke', () => {
  const html = render();
  assert.ok(html.includes('href="/linje/buss-31"'));
  assert.ok(html.includes('href="/bergen/linje/bybanen-1"'));
  assert.ok(html.includes('href="/holdeplass/oslo-s"'));
  assert.match(html, /<span class="line-badge[^"]*"[^>]*>9999<\/span>/);
  assert.ok(!html.includes('9999</a>'));
});

test('index null gir teksten og melding om at avvik ikke er tilgjengelige', () => {
  const html = render({ index: null });
  assert.ok(html.includes(TEXT));
  assert.ok(html.includes('Avvik er ikke tilgjengelige akkurat nå.'));
  assert.ok(!html.includes('id="avvik-rut"'));
});

test('ingen listbare avvik gir egen melding', () => {
  const html = render({ index: buildSituationIndex([]) });
  assert.ok(html.includes('Ingen avvik akkurat nå.'));
});

test('utløpte avvik vises ikke', () => {
  const old = sit({ id: 'RUT:9', summary: 'Gammelt', lines: [{ ref: 'RUT:Line:1', code: '1' }], validity: [{ start: NOW - 7200_000, end: NOW - 60_000 }] });
  const html = render({ index: buildSituationIndex([old]) });
  assert.ok(!html.includes('Gammelt'));
});

test('siden har AdSense, ingen noindex og canonical /avvik', () => {
  const html = render();
  assert.ok(html.includes('pagead2.googlesyndication.com'));
  assert.ok(!html.includes('noindex'));
  assert.ok(html.includes('<link rel="canonical" href="https://livetrafikk.no/avvik">'));
});

test('gyldighet: norsk dato i Europe/Oslo, åpen slutt «inntil videre»', () => {
  const start = Date.parse('2026-11-05T07:00:00Z');
  assert.equal(formatValidityPeriod({ start, end: Date.parse('2026-11-20T15:00:00Z') }, NOW), 'Gjelder fra 5. nov. kl. 08.00 til 20. nov.');
  assert.equal(formatValidityPeriod({ start, end: null }, NOW), 'Gjelder fra 5. nov. kl. 08.00 inntil videre');
  assert.equal(formatValidityPeriod({ start, end: Date.parse('2026-11-05T19:00:00Z') }, NOW), 'Gjelder fra 5. nov. kl. 08.00 til kl. 20.00');
  assert.equal(formatValidityPeriod({ start: null, end: Date.parse('2026-11-20T15:00:00Z') }, NOW), 'Gjelder til 20. nov.');
  assert.equal(formatValidityPeriod({ start: Date.parse('2027-01-02T07:00:00Z'), end: null }, NOW), 'Gjelder fra 2. jan. 2027 kl. 08.00 inntil videre');
});

test('sitemap inneholder /avvik', () => {
  const xml = buildSitemap({ lines: [], guides: [] });
  assert.ok(xml.includes('<loc>https://livetrafikk.no/avvik</loc>'));
});

test('sidemeny og bunntekst lenker til /avvik, og kartets meny har lenken', () => {
  const html = renderPage({ title: 't', description: 'd', path: '/om', body: '' });
  const nav = html.slice(html.indexOf('<nav'), html.indexOf('</nav>'));
  const footer = html.slice(html.indexOf('<footer'), html.indexOf('</footer>'));
  assert.ok(nav.includes('href="/avvik"'));
  assert.ok(footer.includes('href="/avvik"'));
  const map = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const menu = map.slice(map.indexOf('id="map-menu"'), map.indexOf('</div>', map.indexOf('id="map-menu"')));
  assert.ok(menu.includes('href="/avvik"'));
});

test('content/avvik.html: 300–500 ord, ingen forbudte fraser', () => {
  const html = readFileSync(new URL('../content/avvik.html', import.meta.url), 'utf8');
  const words = html.replace(/<[^>]*>/g, ' ').split(/\s+/).filter(Boolean).length;
  assert.ok(words >= 300 && words <= 500, `${words} ord`);
  const BANNED = [
    /velkommen/i, /her finner du/i, /på denne siden/i, /det er viktig å merke seg/i, /i en travel hverdag/i,
    /alt i alt/i, /kort fortalt/i, /oppsummering/i, /konklusjon/i, /\bkroner\b|billett/i,
  ];
  for (const re of BANNED) assert.doesNotMatch(html, re);
  assert.doesNotMatch(html, /<script|<h1|<html|<body/i);
});

// ---------- Lenkeoppslag ----------

const oslo = REGIONS.oslo;
const bergen = REGIONS.bergen;
const LINES = {
  oslo: [
    { slug: 'buss-31', code: '31', authority: 'RUT', mode: 'bus', indexed: true, regionId: 'oslo', aliases: [] },
    { slug: 'buss-999', code: '999', authority: 'RUT', mode: 'bus', indexed: false, regionId: 'oslo', aliases: [] },
    { slug: 'tog-re11', code: 'RE11', authority: 'VYG', mode: 'rail', indexed: true, regionId: 'oslo', aliases: ['RX11'] },
  ],
  bergen: [
    { slug: 'flybuss-fb50', code: 'FB50', authority: 'NWY', ref: 'NWY:Line:FB50_x', mode: 'flybuss', indexed: true, regionId: 'bergen', aliases: [] },
  ],
};
const STOPS = {
  oslo: [{ region: 'oslo', slug: 'oslo-s', id: 'NSR:StopPlace:337', name: 'Oslo S', lat: 59.911, lon: 10.753 }],
  bergen: [],
};

test('linjeoppslag: ref, authority:Line:code, kodeområde + kode, bare indekserte og synlige', () => {
  const links = createSituationLinks({ regions: [oslo, bergen], linesFor: (id) => LINES[id], stopsFor: (id) => STOPS[id] });
  assert.equal(links.lineLink('RUT:Line:31', '31'), '/linje/buss-31');
  assert.equal(links.lineLink('RUT:Line:3031', '31'), '/linje/buss-31');
  assert.equal(links.lineLink('NWY:Line:FB50_x', 'FB50'), '/bergen/linje/flybuss-fb50');
  assert.equal(links.lineLink('VYG:Line:RX11', 'RX11'), '/linje/tog-re11');
  assert.equal(links.lineLink('RUT:Line:999', '999'), null, 'ikke indeksert');
  assert.equal(links.lineLink('SKY:Line:31', '31'), null, 'annet kodeområde');
  const osloOnly = createSituationLinks({ regions: [oslo], linesFor: (id) => LINES[id], stopsFor: (id) => STOPS[id] });
  assert.equal(osloOnly.lineLink('NWY:Line:FB50_x', 'FB50'), null, 'skjult region');
});

test('holdeplassoppslag: stoppested-ID, eller quay med samme navn i nærheten', () => {
  const coords = { 'NSR:Quay:1': { lat: 59.9112, lon: 10.7531 }, 'NSR:Quay:2': { lat: 60.39, lon: 5.33 } };
  const links = createSituationLinks({ regions: [oslo], linesFor: (id) => LINES[id], stopsFor: (id) => STOPS[id], coordsFor: (id) => coords[id] });
  assert.equal(links.stopLink('NSR:StopPlace:337', 'Oslo S'), '/holdeplass/oslo-s');
  assert.equal(links.stopLink('NSR:Quay:1', 'Oslo S'), '/holdeplass/oslo-s');
  assert.equal(links.stopLink('NSR:Quay:2', 'Oslo S'), null, 'for langt unna');
  assert.equal(links.stopLink('NSR:StopPlace:9', 'Oslo S', 'RUT'), '/holdeplass/oslo-s', 'uten koordinater, samme region');
  assert.equal(links.stopLink('NSR:StopPlace:9', 'Oslo S', 'SKY'), null, 'uten koordinater, annen region');
});

// ---------- Fiks runde 1 ----------

test('holdeplasser uten navn vises ikke i kortet', () => {
  const s = sit({ id: 'RUT:5', stops: [{ id: 'NSR:Quay:77', name: '' }, { id: 'NSR:Quay:78', name: 'Sinsen' }] });
  const html = render({ index: buildSituationIndex([s]) });
  assert.ok(!html.includes('NSR:Quay:77'));
  assert.ok(html.includes('Sinsen'));
});

test('linjeskift: escapes først, tom linje gir avsnitt, enkelt linjeskift <br>', () => {
  const s = sit({ id: 'RUT:6', lines: [{ ref: 'RUT:Line:1', code: '1' }], description: 'a <b>\nb\n\nc' });
  const html = render({ index: buildSituationIndex([s]) });
  assert.ok(html.includes('<p>a &lt;b&gt;<br>b</p><p>c</p>'));
});

test('uten gyldighetsperioder: «Gjelder inntil videre»', () => {
  const s = sit({ id: 'RUT:7', lines: [{ ref: 'RUT:Line:1', code: '1' }] });
  assert.ok(render({ index: buildSituationIndex([s]) }).includes('<li>Gjelder inntil videre</li>'));
});

test('områdelinje: antall, alvorlige og bare linjer med egen side', () => {
  const list = [
    sit({ id: 'RUT:a', severity: 'severe', lines: [{ ref: 'RUT:Line:31', code: '31' }, { ref: 'RUT:Line:9999', code: '9999' }] }),
    sit({ id: 'RUT:b', severity: 'verySevere', lines: [{ ref: 'RUT:Line:31', code: '31' }] }),
    sit({ id: 'RUT:c', lines: [{ ref: 'RUT:Line:9999', code: '9999' }] }),
  ];
  const html = render({ index: buildSituationIndex(list) });
  assert.ok(html.includes('<p class="situation-summary">3 avvik, 2 alvorlige. Linjer med egen side: <a href="/linje/buss-31">31</a>.</p>'));
  const one = render({ index: buildSituationIndex([list[2]]) });
  assert.ok(one.includes('<p class="situation-summary">1 avvik.</p>'));
});
