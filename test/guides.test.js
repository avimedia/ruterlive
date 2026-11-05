import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GUIDES, getGuideBySlug, loadGuideBody } from '../server/guide-catalog.js';
import { renderGuidePage } from '../server/pages/guide-page.js';
import { renderGuideIndex, renderAboutPage } from '../server/pages/guide-index.js';
import { LINES } from '../server/line-catalog.js';

const FORBUDT = ['I en verden', 'Det er viktig å merke seg', 'Oppsummering', 'Konklusjon', 'Alt i alt', 'Kort fortalt'];

test('GUIDES har seks Oslo-guider og tre Bergen-guider med påkrevde felt', () => {
  assert.equal(GUIDES.filter((g) => g.region === 'oslo').length, 6);
  assert.equal(GUIDES.filter((g) => g.region === 'bergen').length, 3);
  for (const g of GUIDES) {
    assert.ok(g.slug && g.title && g.description);
    assert.match(g.published, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(g.updated, /^\d{4}-\d{2}-\d{2}$/);
  }
  assert.equal(getGuideBySlug('finnes-ikke'), undefined);
});

for (const guide of GUIDES) {
  test(`guide ${guide.region}/${guide.slug}: 600–1200 ord og ingen fyllfraser`, async () => {
    const body = await loadGuideBody(guide.slug, guide.region);
    const words = body.replace(/<[^>]*>/g, ' ').split(/\s+/).filter(Boolean).length;
    assert.ok(words >= 600 && words <= 1200, `${words} ord`);
    for (const frase of FORBUDT) assert.ok(!body.includes(frase), frase);
  });
}

test('renderGuidePage har h1, byline, annonsescript og Les også', async () => {
  const g = GUIDES[0];
  const html = renderGuidePage(g, await loadGuideBody(g.slug));
  assert.match(html, new RegExp(`<h1>${g.title}</h1>`));
  assert.match(html, /livetrafikk\.no · publisert/);
  assert.match(html, /adsbygoogle\.js/);
  assert.match(html, /Les også/);
  assert.ok(!html.includes(`href="/guider/${g.slug}"`));
});

test('renderGuideIndex lenker til alle guider og linjer', () => {
  const osloGuides = GUIDES.filter((g) => g.region === 'oslo');
  const html = renderGuideIndex(osloGuides, LINES);
  for (const g of osloGuides) assert.ok(html.includes(`/guider/${g.slug}`));
  for (const l of LINES) assert.ok(html.includes(`/linje/${l.slug}`));
  assert.ok(html.includes('<h2>Linjer</h2>'));
  for (const h of ['T-bane', 'Trikk', 'Flytoget', 'Flybuss']) assert.ok(html.includes(`<h3>${h}</h3>`), h);
  // Tog gruppert etter region, uten tom «Tog»-gruppe
  for (const h of ['Østlandet', 'Fjerntog', 'Vestlandet', 'Sørlandet', 'Trøndelag og Nordland']) assert.ok(html.includes(`<h3>Tog: ${h}</h3>`), h);
  assert.ok(!html.includes('<h3>Tog</h3>'));
  assert.ok(html.indexOf('/linje/tog-r31') < html.indexOf('/linje/tog-f4') && html.indexOf('/linje/tog-f7') < html.indexOf('/linje/tog-l4'));
  assert.match(html, /<a class="line-badge" data-mode="tram" href="\/linje\/trikk-17" aria-label="Trikk linje 17">17<\/a>/);
});

test('renderAboutPage', async () => {
  const html = renderAboutPage('<p>Hei</p>');
  assert.match(html, /<h1>Om livetrafikk\.no<\/h1>/);
  assert.match(html, /<p>Hei<\/p>/);
  const d = html.match(/<meta name="description" content="([^"]*)"/)[1];
  assert.match(d, /Bergen/);
  assert.match(d, /avvik/i);
  assert.ok(d.length <= 155);
});

test('om-siden nevner Bergen og /avvik og beholder lisensdelen', () => {
  const om = readFileSync(new URL('../content/om.html', import.meta.url), 'utf8');
  assert.match(om, /Bergen/);
  assert.match(om, /href="\/avvik"/);
  assert.match(om, /<h2 id="lisenser">Lisenser<\/h2>/);
  assert.match(om, /NLOD/);
});
