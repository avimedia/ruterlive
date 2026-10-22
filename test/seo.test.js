import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { jsonLd, renderPage } from '../server/pages/layout.js';
import { getLineBySlug } from '../server/line-catalog.js';
import { lineTitle, renderLinePage } from '../server/pages/line-page.js';
import { renderGuidePage } from '../server/pages/guide-page.js';
import { GUIDES } from '../server/guide-catalog.js';
import { renderNotFound } from '../server/pages/not-found.js';
import { cacheControlFor } from '../server/static-assets.js';

const OG = 'https://livetrafikk.no/og-image.png';
const meta = (html, re) => html.match(re)?.[1];
const title = (html) => meta(html, /<title>([^<]*)<\/title>/);
const desc = (html) => meta(html, /<meta name="description" content="([^"]*)"/);
const ldBlocks = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));

const stops = { stops: ['Vestli', 'B', 'Sognsvann'], from: 'Vestli', to: 'Sognsvann' };

test('kartsiden: tittel, beskrivelse, canonical, og/twitter og JSON-LD', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const t = title(html);
  assert.ok(t.length <= 70 && /Sanntidskart/.test(t) && /Oslo/.test(t));
  assert.ok(desc(html).length >= 100 && desc(html).length <= 170);
  assert.match(html, /<link rel="canonical" href="https:\/\/livetrafikk\.no\/">/);
  assert.ok(html.includes(`<meta property="og:image" content="${OG}">`));
  assert.ok(html.includes(`<meta name="twitter:image" content="${OG}">`));
  assert.ok(html.includes('content="summary_large_image"'));
  assert.ok(html.includes('content="nb_NO"'));
  assert.doesNotMatch(html, /realtid/i);
  assert.ok(html.includes('<noscript>') && html.includes('href="/guider"') && html.includes('href="/om"'));
  const [graph] = ldBlocks(html);
  const types = graph['@graph'].map((n) => n['@type']);
  assert.deepEqual(types.sort(), ['Organization', 'WebSite']);
});

test('jsonLd escaper </script', () => {
  const out = jsonLd({ a: '</script><script>alert(1)</script>' });
  assert.ok(!out.slice(1, -9).includes('</script'));
  assert.equal(JSON.parse(out.replace(/^<script[^>]*>|<\/script>$/g, '')).a, '</script><script>alert(1)</script>');
});

test('linjesider: tittel med endepunkter, beskrivelse, breadcrumb, Les mer, og:image', () => {
  const line = getLineBySlug('t-bane-5');
  const html = renderLinePage(line, stops, 2);
  assert.equal(title(html), 'T-bane linje 5 Vestli–Sognsvann: stopp og sanntid | livetrafikk.no');
  assert.ok(title(html).length <= 70);
  assert.match(desc(html), /Vestli og Sognsvann/);
  assert.ok(html.includes('href="/guider/t-banen-i-oslo"'));
  assert.ok(html.includes('href="/guider/sanntidsposisjoner"'));
  assert.ok(html.includes(`og:image" content="${OG}"`));
  const [bc] = ldBlocks(html);
  assert.equal(bc['@type'], 'BreadcrumbList');
  assert.deepEqual(bc.itemListElement.map((i) => i.name), ['Hjem', 'Guider og linjer', 'T-bane linje 5']);
});

test('lineTitle faller tilbake uten endepunkter og for lange titler', () => {
  assert.equal(lineTitle(getLineBySlug('t-bane-1'), null), 'T-bane linje 1: stopp, kart og sanntid | livetrafikk.no');
  const long = lineTitle(getLineBySlug('tog-r12'), { from: 'Drammen stasjon', to: 'Lillestrøm stasjon' });
  assert.ok(long.length <= 68 && long.endsWith('| livetrafikk.no'));
});

test('guidesider: Article og BreadcrumbList er gyldig JSON', () => {
  const g = GUIDES[1];
  const html = renderGuidePage(g, '<p>x</p>');
  const blocks = ldBlocks(html);
  const article = blocks.find((b) => b['@type'] === 'Article');
  assert.equal(article.headline, g.title);
  assert.equal(article.datePublished, g.published);
  assert.equal(article.dateModified, g.updated);
  assert.equal(article.inLanguage, 'nb');
  assert.equal(article.author.name, 'livetrafikk.no');
  const bc = blocks.find((b) => b['@type'] === 'BreadcrumbList');
  assert.deepEqual(bc.itemListElement.map((i) => i.name), ['Hjem', 'Guider', g.title]);
  assert.ok(html.includes(`og:image" content="${OG}"`));
});

test('JSON-LD i renderPage escaper tittel med </script', () => {
  const html = renderPage({ title: 't', description: 'd', path: '/x', body: '', jsonLd: [{ n: '</script>' }] });
  assert.equal(ldBlocks(html)[0].n, '</script>');
});

test('404: noindex, ingen canonical, ingen JSON-LD, men og:image', () => {
  const html = renderNotFound();
  assert.ok(html.includes('<meta name="robots" content="noindex">'));
  assert.ok(!html.includes('rel="canonical"'));
  assert.ok(!html.includes('ld+json'));
  assert.ok(html.includes(`og:image" content="${OG}"`));
});

test('og-image.png får 1 dags cache', () => {
  assert.equal(cacheControlFor('/og-image.png'), 'public, max-age=86400');
});
