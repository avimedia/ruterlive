/**
 * Katalog over holdeplasser (/holdeplass/:slug).
 * Data i server/stop-catalog.json, bygget med scripts/build-stop-catalog.mjs.
 * Bare stopp med `featured: true` (store knutepunkter med egen tekst i content/holdeplass/)
 * får side, lenker og plass i sitemap. Resten ligger i katalogen til senere.
 */

import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { REGIONS } from '../shared/regions.js';

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

/**
 * Slug for en holdeplass: navnet uten « stasjon»/« T». Blir det likt en region-id («Bergen stasjon» → «bergen»),
 * brukes hele navnet («bergen-stasjon»), så /bergen/holdeplass/bergen ikke oppstår.
 */
export function stopSlug(name) {
  const base = slugify(stripStopSuffix(name));
  return Object.hasOwn(REGIONS, base) ? slugify(name) : base;
}

/** Normaliserer stoppnavn for sammenligning (linjesidenes stopplister mot katalogen). */
export function normalizeStopName(name) {
  return slugify(stripStopSuffix(name));
}

/**
 * Katalogen for en region (server/stop-catalog.json for Oslo, server/stop-catalog-<region>.json ellers).
 * Hver oppføring får `region`. Mangler filen, gis en tom liste (Oslo logger i tillegg en advarsel).
 */
export function loadStops(regionId = 'oslo') {
  const file = regionId === 'oslo' ? 'stop-catalog.json' : `stop-catalog-${regionId}.json`;
  try {
    return JSON.parse(readFileSync(new URL(`./${file}`, import.meta.url), 'utf8')).map((s) => ({ region: regionId, ...s }));
  } catch (e) {
    if (regionId === 'oslo') console.warn(`[RuterLive] Mangler server/${file}:`, e.message);
    return [];
  }
}

/** Hele Oslo-katalogen, også stopp uten egen side. */
export const STOPS = loadStops('oslo');

/** Oslo-stoppene som har egen side. */
export const FEATURED_STOPS = STOPS.filter((s) => s.featured);

const CATALOGS = { oslo: STOPS, bergen: loadStops('bergen') };

/** Hele katalogen for regionen (tom for ukjente regioner). */
export function stopsFor(regionId = 'oslo') {
  return Object.hasOwn(CATALOGS, regionId) ? CATALOGS[regionId] : [];
}

const FEATURED = Object.fromEntries(Object.entries(CATALOGS).map(([id, list]) => [id, list.filter((s) => s.featured)]));

/** Stoppene med egen side i regionen. */
export function featuredStopsFor(regionId = 'oslo') {
  return Object.hasOwn(FEATURED, regionId) ? FEATURED[regionId] : [];
}

const bySlugByRegion = Object.fromEntries(Object.entries(FEATURED).map(([id, list]) => [id, new Map(list.map((s) => [s.slug, s]))]));
const byNameByRegion = Object.fromEntries(Object.entries(FEATURED).map(([id, list]) => {
  const m = new Map();
  for (const s of list) {
    const key = normalizeStopName(s.name);
    if (!m.has(key)) m.set(key, s);
  }
  return [id, m];
}));
const byName = byNameByRegion.oslo;

/** Stopp med egen side i regionen, ellers undefined (også for stopp som bare ligger i katalogen). */
export function getStopBySlug(slug, regionId = 'oslo') {
  return bySlugByRegion[Object.hasOwn(bySlugByRegion, regionId) ? regionId : '']?.get(slug);
}

const byId = new Map(FEATURED_STOPS.map((s) => [s.id, s]));
const NEAR_M = 800;

/**
 * Stopp med egen side for tavla: samme stoppested-ID, ellers samme navn og under 800 m unna
 * (tavla kjenner ofte bare under-stoppestedet, katalogen har hovedstoppestedet).
 * @param {{ stopPlaceId?: string, name?: string }} place
 * @param {{ lat?: number|null, lon?: number|null }[]} quays
 */
export function findStopForPlace(place, quays = []) {
  const direct = byId.get(place?.stopPlaceId);
  if (direct) return direct;
  const s = place?.name ? byName.get(normalizeStopName(place.name)) : undefined;
  if (!s) return undefined;
  return quays.some((q) => Number.isFinite(q?.lat) && Number.isFinite(q?.lon) && distanceM(q, s) < NEAR_M) ? s : undefined;
}

/** Stopp med egen side og samme (normaliserte) navn, ellers undefined. */
export function findStopByName(name, regionId = 'oslo') {
  return byNameByRegion[Object.hasOwn(byNameByRegion, regionId) ? regionId : '']?.get(normalizeStopName(name));
}

const textCache = new Map();

/**
 * Håndskrevet tekst fra content/holdeplass/<slug>.html (Oslo) eller content/<region>/holdeplass/<slug>.html (cachet).
 * Bare stopp med egen side godtas.
 */
export async function getStopText(slug, regionId = 'oslo') {
  if (!getStopBySlug(slug, regionId)) return undefined;
  const key = `${regionId}:${slug}`;
  if (!textCache.has(key)) {
    const dir = regionId === 'oslo' ? 'holdeplass' : `${regionId}/holdeplass`;
    textCache.set(key, await readFile(new URL(`../content/${dir}/${slug}.html`, import.meta.url), 'utf8'));
  }
  return textCache.get(key);
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
