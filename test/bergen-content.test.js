// Bergen-innhold: linjetekster og guider (content/bergen/), lenker, ordgrenser, indeksering og sitemap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { REGION_LINES, getLineBySlug, getLineText } from '../server/line-catalog.js';
import { GUIDES, loadGuideBody } from '../server/guide-catalog.js';
import { featuredStopsFor } from '../server/stop-catalog.js';
import { buildSitemap } from '../server/pages/sitemap.js';
import { renderLinePage } from '../server/pages/line-page.js';
import { renderGuidePage } from '../server/pages/guide-page.js';
import { renderGuideIndex } from '../server/pages/guide-index.js';
import { visibleRegions } from '../shared/regions.js';

const BANNED = [
  /velkommen til/i, /her finner du/i, /i denne guiden/i, /det er viktig å merke seg/i, /i en travel hverdag/i,
  /alt i alt/i, /kort fortalt/i, /oppsummering/i, /konklusjon/i,
  /har ikke sanntid/i, // råtner; skriv heller at avgangene vises med rutetid
  /\bkroner\b|\bkr\.?\s*\d|billett/i, // priser og billettregler er ikke sjekket mot Entur
];
const REQUIRED = ['bybanen-1', 'bybanen-2', 'flybuss-fb50', 'flybuss-fb51'];
const dirUrl = new URL('../content/bergen/linje/', import.meta.url);
const slugs = readdirSync(dirUrl).filter((f) => f.endsWith('.html')).map((f) => f.replace(/\.html$/, ''));
const bergenGuides = GUIDES.filter((g) => g.region === 'bergen');
const countWords = (html) => html.replace(/<[^>]*>/g, ' ').split(/\s+/).filter(Boolean).length;
const hrefs = (html) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);

// Lenker fra Bergen-tekster: bare indekserte Bergen-linjer, Bergen-guider og utvalgte Bergen-holdeplasser
const allowed = new Set([
  ...REGION_LINES.bergen.filter((l) => l.indexed).map((l) => `/bergen/linje/${l.slug}`),
  ...bergenGuides.map((g) => `/bergen/guider/${g.slug}`),
  ...featuredStopsFor('bergen').map((s) => `/bergen/holdeplass/${s.slug}`),
]);

test('Bergen-linjetekster: 20–30 filer, alle i katalogen, Bybanen og flybussene med', () => {
  assert.ok(slugs.length >= 20 && slugs.length <= 30, `${slugs.length} tekster`);
  for (const s of slugs) assert.ok(getLineBySlug(s, 'bergen'), `${s} finnes ikke i Bergen-katalogen`);
  for (const s of REQUIRED) assert.ok(slugs.includes(s), `mangler ${s}`);
});

for (const slug of slugs) {
  test(`Bergen-linjetekst ${slug}: 150–250 ord, ingen forbudte fraser, gyldige lenker`, async () => {
    const html = readFileSync(new URL(`${slug}.html`, dirUrl), 'utf8');
    const words = countWords(html);
    assert.ok(words >= 150 && words <= 250, `${words} ord`);
    for (const re of BANNED) assert.doesNotMatch(html, re);
    assert.doesNotMatch(html, /<script|<h1|<html|<body/i);
    for (const href of hrefs(html)) assert.ok(allowed.has(href), `ugyldig lenke ${href}`);
    assert.ok(!hrefs(html).includes(`/bergen/linje/${slug}`), 'lenker til seg selv');
    assert.equal(await getLineText(slug, 'bergen'), html);
    assert.equal(getLineBySlug(slug, 'bergen').indexed, true);
  });
}

for (const guide of bergenGuides) {
  test(`Bergen-guide ${guide.slug}: 600–1200 ord, ingen forbudte fraser, lenker bare til indekserte sider`, async () => {
    const body = await loadGuideBody(guide.slug, 'bergen');
    const words = countWords(body);
    assert.ok(words >= 600 && words <= 1200, `${words} ord`);
    for (const re of BANNED) assert.doesNotMatch(body, re);
    const links = hrefs(body);
    assert.ok(links.length >= 5, 'for få interne lenker');
    for (const href of links) assert.ok(allowed.has(href), `ugyldig lenke ${href}`);
    assert.ok(!links.includes(`/bergen/guider/${guide.slug}`), 'lenker til seg selv');
  });
}

test('Bergen-guider: region-sti, canonical, AdSense og bare Bergen-guider under Les også', async () => {
  const g = bergenGuides[0];
  const html = renderGuidePage(g, await loadGuideBody(g.slug, 'bergen'), GUIDES);
  assert.match(html, new RegExp(`rel="canonical" href="https://livetrafikk\\.no/bergen/guider/${g.slug}"`));
  assert.match(html, /adsbygoogle/);
  assert.doesNotMatch(html, /name="robots"/);
  assert.match(html, /livetrafikk\.no · publisert/);
  for (const o of bergenGuides.filter((x) => x !== g)) assert.ok(html.includes(`href="/bergen/guider/${o.slug}"`), o.slug);
  assert.doesNotMatch(html, /href="\/guider\/t-banen-i-oslo"/);
});

test('linjesider for Bergen med tekst: indeksert, AdSense, guide etter modus', async () => {
  const cases = { 'bybanen-1': 'bybanen-i-bergen', 'flybuss-fb50': 'til-og-fra-flesland', 'baat-490': 'bat-og-ferje-skyss', 'buss-3': null };
  for (const [slug, guide] of Object.entries(cases)) {
    const line = getLineBySlug(slug, 'bergen');
    const html = renderLinePage(line, { stops: ['A', 'B', 'C'], from: 'A', to: 'C', fetchedAt: null }, null, await getLineText(slug, 'bergen'));
    assert.doesNotMatch(html, /name="robots"/, slug);
    assert.match(html, /adsbygoogle/, slug);
    if (guide) assert.ok(html.includes(`href="/bergen/guider/${guide}"`), slug);
    assert.doesNotMatch(html, /href="\/guider\/(t-banen|trikken|flytoget|lokaltog)/, slug);
  }
});

test('guideoversikten lister alle Bergen-linjer med tekst, også båtene', () => {
  const bergen = visibleRegions(['bergen']).find((r) => r.id === 'bergen');
  const html = renderGuideIndex([], [], [{ region: bergen, guides: bergenGuides, lines: REGION_LINES.bergen }]);
  for (const s of slugs) assert.ok(html.includes(`href="/bergen/linje/${s}"`), s);
  assert.match(html, /<h3>Båt<\/h3>/);
  assert.ok(!html.includes('href="/bergen/linje/buss-23"'));
});

test('sitemap med Bergen synlig: alle linjer med tekst og guidene, ingen linjer uten tekst', () => {
  const visible = visibleRegions(['bergen']);
  const xml = buildSitemap({
    lines: visible.flatMap((r) => REGION_LINES[r.id] ?? []),
    guides: GUIDES.filter((g) => visible.some((r) => r.id === g.region)),
    stops: visible.flatMap((r) => featuredStopsFor(r.id)),
    regions: visible,
  });
  for (const s of slugs) assert.ok(xml.includes(`<loc>https://livetrafikk.no/bergen/linje/${s}</loc>`), s);
  for (const g of bergenGuides) assert.ok(xml.includes(`<loc>https://livetrafikk.no/bergen/guider/${g.slug}</loc>`), g.slug);
  assert.ok(!xml.includes('/bergen/linje/buss-23<'));
  const bergenLines = (xml.match(/\/bergen\/linje\//g) || []).length;
  assert.equal(bergenLines, slugs.length);
  // Skjult Bergen: ingen Bergen-sider i sitemap
  const hidden = visibleRegions([]);
  const xmlHidden = buildSitemap({
    lines: hidden.flatMap((r) => REGION_LINES[r.id] ?? []),
    guides: GUIDES.filter((g) => hidden.some((r) => r.id === g.region)),
    regions: hidden,
  });
  assert.doesNotMatch(xmlHidden, /\/bergen/);
});
