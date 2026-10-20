import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getLineBySlug } from '../server/line-catalog.js';
import { renderLinePage } from '../server/pages/line-page.js';

const stops = { stops: ['A & B', 'C'], from: 'A & B', to: 'C' };

test('renderLinePage for T-bane: stoppliste, antall og kartlenke', () => {
  const html = renderLinePage(getLineBySlug('t-bane-5'), stops, 3);
  assert.match(html, /<ol/);
  assert.ok(html.includes('A &amp; B'));
  assert.ok(html.includes('3'));
  assert.ok(html.includes('href="/?lat=59.925&amp;lng=10.75&amp;z=12"'));
  assert.ok(html.includes('adsbygoogle'));
});

test('renderLinePage for tog bruker z=10', () => {
  const html = renderLinePage(getLineBySlug('tog-r12'), stops, 1);
  assert.ok(html.includes('href="/?lat=59.925&amp;lng=10.75&amp;z=10"'));
});

test('renderLinePage uten stopp gir reservetekst og intro', () => {
  const line = getLineBySlug('trikk-17');
  const html = renderLinePage(line, null, 0);
  assert.ok(html.includes('Stoppliste lastes, prøv igjen om litt'));
  assert.ok(html.includes(line.title));
  assert.doesNotMatch(html, /<ol/);
});

test('flybuss uten kjøretøy utelater telling', () => {
  const html = renderLinePage(getLineBySlug('flybuss-fb1'), stops, 0);
  assert.ok(!html.includes('Ute akkurat nå'));
});
