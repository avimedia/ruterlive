/**
 * Katalog over holdeplasser (/holdeplass/:slug).
 * Data i server/stop-catalog.json, bygget med scripts/build-stop-catalog.mjs.
 * Bare stopp med `featured: true` (store knutepunkter med egen tekst i content/holdeplass/)
 * får side, lenker og plass i sitemap. Resten ligger i katalogen til senere.
 */

import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

/** Lager URL-slug: små bokstaver, æ→ae, ø→o, å→a, alt annet enn a–z/0–9 blir bindestrek. */
export function slugify(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/æ/g, 'ae')
    .replace(/[øö]/g, 'o')
    .replace(/[åä]/g, 'a')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Fjerner « stasjon» og T-banens « T» på slutten av navnet («Linderud T» → «Linderud»). */
export function stripStopSuffix(name) {
  return String(name ?? '').replace(/\s+(stasjon|st\.)$/i, '').replace(/\s+T$/, '');
}

/** Normaliserer stoppnavn for sammenligning (linjesidenes stopplister mot katalogen). */
export function normalizeStopName(name) {
  return slugify(stripStopSuffix(name));
}

function loadCatalog() {
  try {
    return JSON.parse(readFileSync(new URL('./stop-catalog.json', import.meta.url), 'utf8'));
  } catch (e) {
    console.warn('[RuterLive] Mangler server/stop-catalog.json:', e.message);
    return [];
  }
}

/** Hele katalogen, også stopp uten egen side. */
export const STOPS = loadCatalog();

/** Stoppene som har egen side. */
export const FEATURED_STOPS = STOPS.filter((s) => s.featured);

const bySlug = new Map(FEATURED_STOPS.map((s) => [s.slug, s]));
const byName = new Map();
for (const s of FEATURED_STOPS) {
  const key = normalizeStopName(s.name);
  if (!byName.has(key)) byName.set(key, s);
}

/** Stopp med egen side, ellers undefined (også for stopp som bare ligger i katalogen). */
export function getStopBySlug(slug) {
  return bySlug.get(slug);
}

/** Stopp med egen side og samme (normaliserte) navn, ellers undefined. */
export function findStopByName(name) {
  return byName.get(normalizeStopName(name));
}

const textCache = new Map();

/** Håndskrevet tekst fra content/holdeplass/<slug>.html (cachet). Bare stopp med egen side godtas. */
export async function getStopText(slug) {
  if (!bySlug.has(slug)) return undefined;
  if (!textCache.has(slug)) {
    textCache.set(slug, await readFile(new URL(`../content/holdeplass/${slug}.html`, import.meta.url), 'utf8'));
  }
  return textCache.get(slug);
}

/** Avstand i meter (haversine). */
export function distanceM(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** De `n` nærmeste stoppene med egen side innen `maxDistance` meter, med avstand i meter. */
export function nearestStops(stop, n = 3, { stops = FEATURED_STOPS, maxDistance = Infinity } = {}) {
  return stops
    .filter((s) => s.slug !== stop.slug)
    .map((s) => ({ stop: s, distance: distanceM(stop, s) }))
    .filter((x) => x.distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, n);
}
