import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, renderPage } from '../server/pages/layout.js';
import { readFileSync } from 'node:fs';

test('escapeHtml escaper spesialtegn', () => {
  assert.equal(escapeHtml('A & B <"x">'), 'A &amp; B &lt;&quot;x&quot;&gt;');
  assert.equal(escapeHtml(null), '');
});

test('renderPage har annonsescript, canonical, description og body', () => {
  const html = renderPage({ title: 'T', description: 'D', path: '/om', body: '<p>x</p>' });
  assert.ok(html.includes('adsbygoogle.js?client=ca-pub-1298230222793785'));
  assert.ok(html.includes('<link rel="canonical" href="https://livetrafikk.no/om">'));
  assert.ok(html.includes('<meta name="description" content="D">'));
  assert.ok(html.includes('<p>x</p>'));
});

test('renderPage uten annonser og med noindex', () => {
  const html = renderPage({ title: 'T', description: 'D', path: '/om', body: '', ads: false, noindex: true });
  assert.ok(!html.includes('adsbygoogle'));
  assert.ok(html.includes('<meta name="robots" content="noindex">'));
});

test('renderPage escaper title og description', () => {
  const html = renderPage({ title: 'A & B', description: 'si "hei"', path: '/x', body: '' });
  assert.ok(html.includes('<title>A &amp; B</title>'));
  assert.ok(html.includes('<meta name="description" content="si &quot;hei&quot;">'));
});

test('content.css har balanserte klammer', () => {
  const css = readFileSync(new URL('../public/content.css', import.meta.url), 'utf8');
  assert.equal(css.split('{').length, css.split('}').length);
});
