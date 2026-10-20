import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GUIDES, getGuideBySlug, loadGuideBody } from '../server/guide-catalog.js';
import { renderGuidePage } from '../server/pages/guide-page.js';
import { renderGuideIndex, renderAboutPage } from '../server/pages/guide-index.js';
import { LINES } from '../server/line-catalog.js';

const FORBUDT = ['I en verden', 'Det er viktig å merke seg', 'Oppsummering', 'Konklusjon', 'Alt i alt', 'Kort fortalt'];

test('GUIDES har seks guider med påkrevde felt', () => {
  assert.equal(GUIDES.length, 6);
  for (const g of GUIDES) {
    assert.ok(g.slug && g.title && g.description);
    assert.match(g.published, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(g.updated, /^\d{4}-\d{2}-\d{2}$/);
  }
  assert.equal(getGuideBySlug('finnes-ikke'), undefined);
});

for (const guide of GUIDES) {
  test(`guide ${guide.slug}: 600–1200 ord og ingen fyllfraser`, async () => {
    const body = await loadGuideBody(guide.slug);
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
  const html = renderGuideIndex(GUIDES, LINES);
  for (const g of GUIDES) assert.ok(html.includes(`/guider/${g.slug}`));
  for (const l of LINES) assert.ok(html.includes(`/linje/${l.slug}`));
  for (const h of ['T-bane', 'Trikk', 'Tog', 'Flytoget', 'Flybuss']) assert.ok(html.includes(`<h2>${h}</h2>`), h);
});

test('renderAboutPage', async () => {
  const html = renderAboutPage('<p>Hei</p>');
  assert.match(html, /<h1>Om livetrafikk\.no<\/h1>/);
  assert.match(html, /<p>Hei<\/p>/);
});
