import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { EN_PAGES, getEnPageBySlug, getEnAlternateFor, loadEnBody } from '../server/en-catalog.js';
import { renderEnPage } from '../server/pages/en-page.js';
import { renderGuidePage } from '../server/pages/guide-page.js';
import { renderGuideIndex } from '../server/pages/guide-index.js';
import { getGuideBySlug, loadGuideBody, GUIDES } from '../server/guide-catalog.js';
import { LINES } from '../server/line-catalog.js';
import { buildSitemap } from '../server/pages/sitemap.js';
import { renderPage } from '../server/pages/layout.js';
import { registerEnRoutes } from '../server/en-routes.js';

const BANNED = [
  "In today's", 'fast-paced', "It's worth noting", 'It is worth noting', 'In conclusion', 'To sum up', 'In summary',
  'Whether you', 'look no further', 'seamless', 'hidden gem', 'bustling', 'vibrant', 'best way', 'the perfect',
];

const wordCount = (html) => html.replace(/<[^>]*>/g, ' ').split(/\s+/).filter(Boolean).length;

test('EN_PAGES har påkrevde felt og unike stier', () => {
  assert.equal(EN_PAGES.length, 3);
  for (const p of EN_PAGES) {
    assert.ok(p.title && p.description && p.path.startsWith('/en'));
    assert.match(p.published, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(p.updated, /^\d{4}-\d{2}-\d{2}$/);
  }
  assert.equal(new Set(EN_PAGES.map((p) => p.path)).size, 3);
  assert.equal(getEnPageBySlug('').path, '/en');
  assert.equal(getEnPageBySlug('finnes-ikke'), undefined);
});

for (const page of EN_PAGES) {
  test(`${page.path}: 500–1000 ord og ingen fyllfraser`, async () => {
    const body = await loadEnBody(page.slug);
    const words = wordCount(body);
    assert.ok(words >= 500 && words <= 1000, `${words} ord`);
    for (const phrase of BANNED) assert.ok(!body.toLowerCase().includes(phrase.toLowerCase()), phrase);
  });
}

test('renderPage: lang og hreflang', () => {
  const nb = renderPage({ title: 'T', description: 'D', path: '/om', body: '' });
  assert.match(nb, /<html lang="nb">/);
  assert.ok(nb.includes('>Kart</a>'));
  assert.ok(!nb.includes('hreflang'));
  const en = renderPage({
    title: 'T', description: 'D', path: '/en', body: '', lang: 'en',
    alternates: [{ hreflang: 'nb', href: '/' }, { hreflang: 'en', href: '/en' }, { hreflang: 'x-default', href: '/' }],
  });
  assert.match(en, /<html lang="en">/);
  assert.ok(en.includes('>Map</a>') && en.includes('>Guides</a>') && en.includes('>About</a>'));
  assert.ok(en.includes('<link rel="alternate" hreflang="nb" href="https://livetrafikk.no/">'));
  assert.ok(en.includes('<link rel="alternate" hreflang="en" href="https://livetrafikk.no/en">'));
  assert.ok(en.includes('<link rel="alternate" hreflang="x-default" href="https://livetrafikk.no/">'));
});

test('renderEnPage: engelsk, annonser, byline, Norsk-lenke og hreflang', async () => {
  const page = getEnPageBySlug('airport-train-or-bus');
  const html = renderEnPage(page, await loadEnBody(page.slug));
  assert.match(html, /<html lang="en">/);
  assert.match(html, /adsbygoogle\.js/);
  assert.match(html, /livetrafikk\.no · published \d{4}-\d{2}-\d{2}/);
  assert.ok(html.includes('href="/guider/flytoget-eller-flybussen" hreflang="nb" lang="nb">Norsk</a>'));
  assert.ok(html.includes('hreflang="nb" href="https://livetrafikk.no/guider/flytoget-eller-flybussen"'));
  assert.ok(html.includes('hreflang="en" href="https://livetrafikk.no/en/airport-train-or-bus"'));
  assert.ok(html.includes('hreflang="x-default" href="https://livetrafikk.no/guider/flytoget-eller-flybussen"'));
  assert.match(html, /More in English/);

  const around = getEnPageBySlug('getting-around-oslo');
  const aroundHtml = renderEnPage(around, await loadEnBody(around.slug));
  assert.ok(!aroundHtml.includes('rel="alternate"'), 'ingen 1:1 norsk motpart');
  assert.ok(aroundHtml.includes('href="/guider" hreflang="nb" lang="nb">Norsk</a>'));
});

test('norsk guide og /guider lenker til engelsk', async () => {
  const guide = getGuideBySlug('flytoget-eller-flybussen');
  const html = renderGuidePage(guide, await loadGuideBody(guide.slug));
  assert.match(html, /<html lang="nb">/);
  assert.ok(html.includes('href="/en/airport-train-or-bus" hreflang="en" lang="en">English</a>'));
  assert.ok(html.includes('<link rel="alternate" hreflang="en" href="https://livetrafikk.no/en/airport-train-or-bus">'));
  assert.ok(html.includes('<link rel="alternate" hreflang="nb" href="https://livetrafikk.no/guider/flytoget-eller-flybussen">'));

  const other = getGuideBySlug('trikken-i-oslo');
  assert.ok(!renderGuidePage(other, '').includes('hreflang'));
  assert.equal(getEnAlternateFor('/guider'), undefined);

  assert.ok(renderGuideIndex(GUIDES, LINES).includes('href="/en" hreflang="en" lang="en">English</a>'));
});

test('sitemap har de engelske sidene', () => {
  const xml = buildSitemap({ lines: [], guides: [], enPages: EN_PAGES });
  for (const p of EN_PAGES) assert.ok(xml.includes(`<loc>https://livetrafikk.no${p.path}</loc>`), p.path);
});

test('ruter: 200 for engelske sider, 404 for ukjent', async () => {
  const app = express();
  registerEnRoutes(app, { sendNotFound: (res) => res.status(404).send('404') });
  const server = app.listen(0);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const p of EN_PAGES) {
      const res = await fetch(base + p.path);
      assert.equal(res.status, 200, p.path);
      assert.match(await res.text(), /<html lang="en">/);
    }
    assert.equal((await fetch(`${base}/en/finnes-ikke`)).status, 404);
  } finally {
    server.close();
  }
});
