/**
 * Engelske sider (/en, /en/:slug) for turister. Tekstene ligger som HTML-fragmenter i content/en/.
 * `nb` er den norske motparten (hreflang, x-default); null når det ikke finnes en 1:1-side.
 * `nbLink` er målet for «Norsk»-lenken når `nb` mangler.
 */

import { readFile } from 'node:fs/promises';

const PUBLISHED = '2026-10-22';

export const EN_PAGES = [
  {
    slug: '',
    file: 'oslo-live-transit-map',
    path: '/en',
    nb: '/',
    title: 'Oslo live transit map',
    description: 'A live map of buses, metro, trams, boats, trains and airport transport in Oslo, with data from Entur. How to read it and use it.',
  },
  {
    slug: 'airport-train-or-bus',
    file: 'airport-train-or-bus',
    path: '/en/airport-train-or-bus',
    nb: '/guider/flytoget-eller-flybussen',
    title: 'Airport train or bus',
    description: 'Flytoget, the airport buses FB1, FB3 and FB5, and the Vy regional trains between Oslo and Oslo Airport Gardermoen: where each line goes and stops.',
  },
  {
    slug: 'getting-around-oslo',
    file: 'getting-around-oslo',
    path: '/en/getting-around-oslo',
    nb: null,
    nbLink: '/guider',
    title: 'Getting around Oslo',
    description: 'The metro, trams, buses, boats and trains in Oslo, how the lines are numbered, and where to buy tickets.',
  },
].map((p) => ({ published: PUBLISHED, updated: PUBLISHED, ...p }));

/** '' gir forsiden /en. */
export function getEnPageBySlug(slug) {
  return EN_PAGES.find((p) => p.slug === slug);
}

/** Engelsk motpart til en norsk sti, eller undefined. */
export function getEnAlternateFor(nbPath) {
  return EN_PAGES.find((p) => p.nb && p.nb === nbPath);
}

/** hreflang-lenker for et par norsk/engelsk side. */
export function alternatesFor(nbPath, enPath) {
  return [
    { hreflang: 'nb', href: nbPath },
    { hreflang: 'en', href: enPath },
    { hreflang: 'x-default', href: nbPath },
  ];
}

const bodyCache = new Map();

/** Leser content/en/<file>.html og cacher i minnet. Kun kjente sider godtas. */
export async function loadEnBody(slug) {
  const page = getEnPageBySlug(slug);
  if (!page) throw new Error(`Ukjent engelsk side: ${slug}`);
  if (!bodyCache.has(page.file)) {
    bodyCache.set(page.file, await readFile(new URL(`../content/en/${page.file}.html`, import.meta.url), 'utf8'));
  }
  return bodyCache.get(page.file);
}
