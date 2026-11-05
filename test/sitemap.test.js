import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSitemap, isMapPath } from '../server/pages/sitemap.js';
import { renderNotFound } from '../server/pages/not-found.js';
import { GUIDES } from '../server/guide-catalog.js';
import { LINES } from '../server/line-catalog.js';

test('buildSitemap inneholder faste sider, linjer og guider', () => {
  const guides = GUIDES.filter((g) => g.region === 'oslo');
  const xml = buildSitemap({ lines: LINES, guides });
  for (const p of ['/', '/guider', '/om', '/personvern.html']) {
    assert.ok(xml.includes(`<loc>https://livetrafikk.no${p}</loc>`), p);
  }
  for (const l of LINES) assert.ok(xml.includes(`<loc>https://livetrafikk.no/linje/${l.slug}</loc>`));
  for (const g of guides) {
    assert.ok(xml.includes(`<loc>https://livetrafikk.no/guider/${g.slug}</loc>`));
    assert.ok(xml.includes(`<lastmod>${g.updated}</lastmod>`));
  }
  assert.equal((xml.match(/<lastmod>/g) || []).length, guides.length);
  assert.equal((xml.match(/<url>/g) || []).length, 5 + LINES.length + guides.length);
});

test('buildSitemap escaper slug', () => {
  const xml = buildSitemap({ lines: [{ slug: 'a&b' }], guides: [] });
  assert.ok(xml.includes('/linje/a&amp;b</loc>'));
});

test('isMapPath', () => {
  assert.equal(isMapPath('/'), true);
  assert.equal(isMapPath('/index.html'), true);
  assert.equal(isMapPath('/foo'), false);
  assert.equal(isMapPath('/linje/x'), false);
});

test('renderNotFound er noindex, uten annonser, med lenker', () => {
  const html = renderNotFound();
  assert.ok(html.includes('noindex'));
  assert.ok(!html.includes('adsbygoogle'));
  assert.ok(html.includes('href="/"'));
  assert.ok(html.includes('href="/guider"'));
});
