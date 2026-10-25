import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { LINES, BUS_CODES, getLineBySlug } from '../server/line-catalog.js';
import { countVehiclesForLine } from '../server/live-vehicles.js';
import { GUIDES } from '../server/guide-catalog.js';
import { FEATURED_STOPS } from '../server/stop-catalog.js';
import { buildSitemap } from '../server/pages/sitemap.js';
import { renderGuideIndex } from '../server/pages/guide-index.js';
import { renderLinePage } from '../server/pages/line-page.js';

const BUS = LINES.filter((l) => l.mode === 'bus');
const FYLL = ['det er viktig å merke seg', 'i en travel hverdag', 'alt i alt', 'kort fortalt', 'oppsummert', 'til syvende og sist'];
const wordCount = (html) => html.replace(/<[^>]*>/g, ' ').split(/\s+/).filter(Boolean).length;
const fragment = (slug) => readFileSync(new URL(`../content/linje/${slug}.html`, import.meta.url), 'utf8');

test('busslinjene ligger i katalogen med Ruter som operatør og unike slugs', () => {
  assert.equal(BUS.length, BUS_CODES.length);
  assert.ok(BUS.length >= 15);
  for (const l of BUS) {
    assert.equal(l.authority, 'RUT');
    assert.equal(l.slug, `buss-${l.code.toLowerCase()}`);
    assert.equal(l.title, `Buss ${l.code}`);
    assert.ok(l.intro.length > 0, l.slug);
  }
  assert.equal(new Set(LINES.map((l) => l.slug)).size, LINES.length);
  assert.equal(getLineBySlug('buss-31').code, '31');
});

test('countVehiclesForLine: linje-ID må tilhøre linjens operatør', () => {
  const l22 = { slug: 'buss-22', code: '22', authority: 'RUT', mode: 'bus', aliases: [] };
  const vehicles = [
    { mode: 'bus', line: { publicCode: '22', lineRef: 'RUT:Line:22' } },
    { mode: 'BUS', line: { publicCode: '22', lineRef: 'BRA:Line:22' } },
    { mode: 'bus', line: { publicCode: '22', ref: 'RUT:Line:22' } },
    { mode: 'bus', line: { publicCode: '22', ref: 'BRA:Line:22' } },
    { mode: 'bus', line: { publicCode: '22' } }, // uten ID: kode + modus
    { mode: 'tram', line: { publicCode: '22', lineRef: 'RUT:Line:22' } },
    { mode: 'bus', line: { publicCode: '23', lineRef: 'RUT:Line:23' } },
  ];
  assert.equal(countVehiclesForLine(vehicles, l22), 3);
  assert.equal(countVehiclesForLine(vehicles, { ...l22, authority: 'BRA' }), 3);
});

test('countVehiclesForLine: tog med VYG-ID telles fortsatt', () => {
  const r13 = getLineBySlug('tog-r13');
  const vehicles = [
    { mode: 'RAIL', line: { publicCode: 'R13', lineRef: 'VYG:Line:R13' } },
    { mode: 'BUS', line: { publicCode: 'R13', lineRef: 'VYG:Line:R13' } }, // buss for tog: annen modus
  ];
  assert.equal(countVehiclesForLine(vehicles, r13), 1);
});

const stopSlugs = new Set(FEATURED_STOPS.map((s) => s.slug));
const guideSlugs = new Set(GUIDES.map((g) => g.slug));
const lineSlugs = new Set(LINES.map((l) => l.slug));

for (const line of BUS) {
  test(`${line.slug}: tekst på 150–250 ord, uten fyllfraser, og lenker som finnes`, () => {
    const path = new URL(`../content/linje/${line.slug}.html`, import.meta.url);
    assert.ok(existsSync(path), `mangler content/linje/${line.slug}.html`);
    const html = fragment(line.slug);
    const words = wordCount(html);
    assert.ok(words >= 150 && words <= 250, `${words} ord`);
    for (const f of FYLL) assert.ok(!html.toLowerCase().includes(f), f);
    assert.ok(html.includes('href="/guider/sanntidsposisjoner"'), 'lenke til sanntidsguiden');
    assert.match(html, /GPS/);
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(hrefs.length > 0);
    for (const href of hrefs) {
      const m = /^\/(linje|holdeplass|guider)\/([a-z0-9-]+)$/.exec(href);
      assert.ok(m, `ukjent lenke ${href}`);
      const set = { linje: lineSlugs, holdeplass: stopSlugs, guider: guideSlugs }[m[1]];
      assert.ok(set.has(m[2]), `lenke uten side: ${href}`);
      assert.notEqual(href, `/linje/${line.slug}`, 'lenker til seg selv');
    }
  });
}

test('sitemap og /guider har busslinjene', () => {
  const xml = buildSitemap({ lines: LINES, guides: GUIDES });
  for (const l of BUS) assert.ok(xml.includes(`<loc>https://livetrafikk.no/linje/${l.slug}</loc>`), l.slug);
  const index = renderGuideIndex(GUIDES, LINES);
  assert.match(index, /data-mode="bus">\s*<h3>Buss<\/h3>/);
  for (const l of BUS) assert.ok(index.includes(`href="/linje/${l.slug}"`), l.slug);
});

test('renderLinePage for buss: etikett, guide, kartlenke og andre busslinjer', () => {
  const line = getLineBySlug('buss-20');
  const html = renderLinePage(line, { stops: ['Skøyen stasjon', 'Majorstuen', 'Galgeberg'], from: 'Skøyen stasjon', to: 'Galgeberg' }, 7);
  assert.match(html, /<body data-mode="bus">/);
  assert.ok(html.includes('<a href="/guider">Linjer</a> / Buss'));
  assert.ok(html.includes('href="/guider/slik-bruker-du-kartet"'));
  assert.ok(html.includes('Se linjen på kartet'));
  assert.ok(html.includes('href="/?lat=59.925&amp;lng=10.75&amp;z=11"'));
  assert.ok(html.includes('<strong>7</strong> kjøretøy'));
  assert.match(html, /<title>Buss 20 Skøyen stasjon–Galgeberg[^<]* \| livetrafikk\.no<\/title>/);
  const others = html.split('<h2>Andre linjer</h2>')[1].split('</ul>')[0];
  assert.ok(others.includes('href="/linje/buss-31"'));
  assert.ok(!others.includes('href="/linje/buss-20"'));
  assert.ok(!others.includes('data-mode="metro"'));
});
