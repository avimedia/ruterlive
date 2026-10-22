/**
 * Katalog over holdeplasser med egne sider (/holdeplass/:slug).
 * Data i server/stop-catalog.json, bygget med scripts/build-stop-catalog.mjs.
 */

import { readFileSync } from 'node:fs';

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

export const STOPS = loadCatalog();

const bySlug = new Map(STOPS.map((s) => [s.slug, s]));
const byName = new Map();
for (const s of STOPS) {
  const key = normalizeStopName(s.name);
  if (!byName.has(key)) byName.set(key, s);
}

export function getStopBySlug(slug) {
  return bySlug.get(slug);
}

/** Katalogstopp med samme (normaliserte) navn, ellers undefined. */
export function findStopByName(name) {
  return byName.get(normalizeStopName(name));
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

/** De `n` nærmeste katalogstoppene, med avstand i meter. */
export function nearestStops(stop, n = 3, stops = STOPS) {
  return stops
    .filter((s) => s.slug !== stop.slug)
    .map((s) => ({ stop: s, distance: distanceM(stop, s) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, n);
}
