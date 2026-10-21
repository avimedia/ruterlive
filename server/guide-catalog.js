/**
 * Katalog over guidene (/guider/:slug). Tekstene ligger som HTML-fragmenter i content/guider/.
 */

import { readFile } from 'node:fs/promises';

const PUBLISHED = '2026-10-20';

export const GUIDES = [
  {
    slug: 'sanntidsposisjoner',
    title: 'Slik fungerer sanntidsposisjonene',
    description: 'Hvor prikkene på kartet kommer fra, og hvorfor noen er ekte GPS mens andre er beregnet ut fra avgangstider.',
  },
  {
    slug: 't-banen-i-oslo',
    title: 'T-banen i Oslo',
    description: 'De fem T-banelinjene, fellestunnelen under sentrum og hvor linjene skiller lag.',
  },
  {
    slug: 'trikken-i-oslo',
    title: 'Trikken i Oslo',
    description: 'Trikkelinjene 12, 13, 15, 17, 18 og 19, som går i tre par med felles traseer.',
  },
  {
    slug: 'flytoget-eller-flybussen',
    title: 'Flytoget eller flybussen',
    description: 'Hvor Flytoget og flybussene til Oslo lufthavn går, og hvilke stopp de har.',
  },
  {
    slug: 'lokaltog-og-regiontog',
    title: 'Lokaltog og regiontog rundt Oslo',
    description: 'Vys lokaltog, regiontog og regionekspress rundt Oslo, og hvordan linjenumrene henger sammen.',
  },
  {
    slug: 'slik-bruker-du-kartet',
    title: 'Slik bruker du kartet',
    description: 'En gjennomgang av lagvelgeren, søk, holdeplasser, avgangstavler og de andre funksjonene på kartet.',
  },
].map((g) => ({ published: PUBLISHED, updated: PUBLISHED, ...g }));

export function getGuideBySlug(slug) {
  return GUIDES.find((g) => g.slug === slug);
}

const bodyCache = new Map();

/** Leser content/guider/<slug>.html og cacher i minnet. Kun kjente slugs godtas. */
export async function loadGuideBody(slug) {
  if (!getGuideBySlug(slug)) throw new Error(`Ukjent guide: ${slug}`);
  if (!bodyCache.has(slug)) {
    bodyCache.set(slug, await readFile(new URL(`../content/guider/${slug}.html`, import.meta.url), 'utf8'));
  }
  return bodyCache.get(slug);
}

/** Leser content/om.html (cachet). */
export async function loadAboutBody() {
  if (!bodyCache.has('om')) {
    bodyCache.set('om', await readFile(new URL('../content/om.html', import.meta.url), 'utf8'));
  }
  return bodyCache.get('om');
}
