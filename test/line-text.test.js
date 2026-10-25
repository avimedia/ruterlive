import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { LINES, getLineBySlug, getLineText } from '../server/line-catalog.js';
import { GUIDES } from '../server/guide-catalog.js';
import { FEATURED_STOPS } from '../server/stop-catalog.js';
import { renderLinePage } from '../server/pages/line-page.js';

const BANNED = [/det er viktig å merke seg/i, /i en travel hverdag/i, /alt i alt/i, /kort fortalt/i];

const countWords = (html) => html.replace(/<[^>]*>/g, ' ').split(/\s+/).filter(Boolean).length;

test('hver linje har håndskrevet tekst på 150–250 ord uten fyllfraser', async () => {
  for (const line of LINES) {
    const file = new URL(`../content/linje/${line.slug}.html`, import.meta.url);
    assert.ok(existsSync(file), `mangler content/linje/${line.slug}.html`);
    const html = readFileSync(file, 'utf8');
    const words = countWords(html);
    assert.ok(words >= 150 && words <= 250, `${line.slug}: ${words} ord`);
    for (const re of BANNED) assert.doesNotMatch(html, re, line.slug);
    assert.doesNotMatch(html, /<script|<h1|<html|<body/i, line.slug);
    assert.equal(await getLineText(line.slug), html);
  }
  const slugs = new Set(LINES.map((l) => l.slug));
  for (const f of readdirSync(new URL('../content/linje/', import.meta.url))) {
    assert.ok(slugs.has(f.replace(/\.html$/, '')), `${f} hører ikke til en linje i katalogen`);
  }
});

test('interne lenker i linjetekstene peker på linjer, guider og utvalgte holdeplasser som finnes', () => {
  const known = new Set([
    ...LINES.map((l) => `/linje/${l.slug}`),
    ...GUIDES.map((g) => `/guider/${g.slug}`),
    ...FEATURED_STOPS.map((s) => `/holdeplass/${s.slug}`),
  ]);
  for (const line of LINES) {
    const html = readFileSync(new URL(`../content/linje/${line.slug}.html`, import.meta.url), 'utf8');
    const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    for (const href of hrefs) {
      assert.ok(known.has(href), `${line.slug}: ukjent lenke ${href}`);
    }
    assert.ok(!hrefs.includes(`/linje/${line.slug}`), `${line.slug} lenker til seg selv`);
  }
});

test('getLineText avviser ukjente slugs og stier ut av mappen', async () => {
  for (const slug of ['vestli', '../om', '../guider/t-banen-i-oslo', 't-bane-1/../t-bane-2', 'T-BANE-1', '', undefined, null]) {
    assert.equal(await getLineText(slug), undefined, String(slug));
  }
});

test('renderLinePage plasserer teksten etter hero og før stopplisten', async () => {
  const line = getLineBySlug('t-bane-5');
  const text = await getLineText(line.slug);
  const html = renderLinePage(line, { stops: ['A', 'B', 'C'], from: 'A', to: 'C' }, 2, text);
  const heroEnd = html.indexOf('class="line-actions"');
  const textAt = html.indexOf('<div class="prose line-text">');
  const stopsAt = html.indexOf('<h2>Stopp</h2>');
  assert.ok(heroEnd > 0 && textAt > heroEnd && stopsAt > textAt, `${heroEnd} ${textAt} ${stopsAt}`);
  assert.ok(html.includes(text.trim()));
  // Uten tekst: ingen tom boks
  assert.ok(!renderLinePage(line, null, 0).includes('line-text'));
});
