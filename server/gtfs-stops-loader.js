/**
 * Henter og parser GTFS stops.txt fra Entur for å bygge quay → koordinater.
 * Brukes som fallback når Journey Planner ikke har quay-koordinater tilgjengelig.
 * Nedlasting maks 1x per 24t (Entur rate limit).
 */

import { fetchWithRetry } from './fetch-with-retry.js';
import { dedupeInFlight } from './in-flight.js';
import { readZipEntry } from './zip-range.js';

const GTFS_URL =
  'https://storage.googleapis.com/marduk-production/outbound/gtfs/rb_norway-aggregated-gtfs-basic.zip';
const CACHE_TTL_MS = 23 * 60 * 60 * 1000; // 23t – litt under 24t

let gtfsQuayCache = null;
/** Map<quayId, [lat, lon]> – bygges én gang per lasting og deles av alle kallere (skal ikke muteres). */
let gtfsCoordMap = null;
let lastLoadTime = 0;

/** Stor-Oslo bbox – reduserer minne på server (Render gratisplan). */
const OSLO_BBOX = { minLat: 59.2, maxLat: 60.8, minLon: 10.0, maxLon: 11.6 };

/**
 * Parser stops.txt CSV.
 * Returnerer Map<quayId, { lat, lon, name }> for stops-in-bbox og søk.
 * Filtrerer til Stor-Oslo for å spare minne.
 * Format: stop_id,stop_name,stop_lat,stop_lon,...
 * Entur bruker stop_id = NSR:Quay:XXXXX.
 */
function parseStopsTxt(content) {
  const map = new Map();
  const lines = content.split(/\r?\n/);
  if (lines.length < 2) return map;

  const header = lines[0].toLowerCase().split(',');
  const stopIdIdx = header.indexOf('stop_id');
  const nameIdx = header.indexOf('stop_name');
  const latIdx = header.indexOf('stop_lat');
  const lonIdx = header.indexOf('stop_lon');
  if (stopIdIdx < 0 || latIdx < 0 || lonIdx < 0) return map;

  const { minLat, maxLat, minLon, maxLon } = OSLO_BBOX;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    const stopId = cols[stopIdIdx]?.trim();
    const name = (nameIdx >= 0 ? cols[nameIdx]?.trim() : '') || '';
    const lat = parseFloat(cols[latIdx]);
    const lon = parseFloat(cols[lonIdx]);
    if (!stopId || isNaN(lat) || isNaN(lon)) continue;
    if (!/^NSR:Quay:\d+$/.test(stopId)) continue;
    if (lat < minLat || lat > maxLat || lon < minLon || lon > maxLon) continue;
    map.set(stopId, { lat, lon, name });
  }
  return map;
}

/** Enkel CSV-rad-parsing (håndterer innhold i anførselstegn). */
function parseCsvLine(line) {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (c === ',' && !inQuotes) {
      result.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  result.push(cur);
  return result;
}

/**
 * Laster GTFS basic zip, ekstraherer stops.txt og bygger quay-cache.
 * @returns {Promise<Map<string, [number, number]>|null>}
 */
export async function loadGtfsStops(fetchFn = fetchWithRetry) {
  if (gtfsQuayCache && Date.now() - lastLoadTime < CACHE_TTL_MS) {
    return gtfsQuayCache;
  }
  return downloadGtfsStops(fetchFn);
}

// Én delt nedlasting om gangen, så samtidige kall ved kald start ikke laster 95 MB flere ganger.
const downloadDeduped = dedupeInFlight(async (fetchFn) => {
  try {
    const content = (await fetchStopsTxt(fetchFn)).toString('utf8');
    const stops = parseStopsTxt(content);
    const coords = new Map();
    for (const [id, v] of stops) coords.set(id, [v.lat, v.lon]);
    gtfsQuayCache = stops;
    gtfsCoordMap = coords;
    lastLoadTime = Date.now();
    console.log(`[RuterLive] GTFS stops: ${gtfsQuayCache.size} quays`);
    return gtfsQuayCache;
  } catch (err) {
    console.warn('[RuterLive] GTFS stops load:', err.message);
    if (gtfsQuayCache) return gtfsQuayCache;
    return null;
  }
}, { timeoutMs: 180000 }); // GTFS: nedlasting (2 min) + parsing

/**
 * Henter stops.txt: først bare den delen av zip-en vi trenger (HTTP Range),
 * ellers hele zip-en som før.
 * @returns {Promise<Buffer>}
 */
async function fetchStopsTxt(fetchFn) {
  // Ingen fallback til full nedlasting: 95 MB i minnet ga ~450 MB RSS og krasj på Render (512 MB).
  // Feiler Range-lesingen beholdes forrige cache, og neste kall prøver igjen.
  return readZipEntry(GTFS_URL, 'stops.txt', fetchFn);
}

function downloadGtfsStops(fetchFn) {
  // Avviser aldri: ved tidsavbrudd brukes forrige cache (eller null), som før.
  return downloadDeduped(fetchFn).catch((e) => {
    console.warn('[RuterLive] GTFS stops:', e.message);
    return gtfsQuayCache;
  });
}

/**
 * Sørger for at GTFS er lastet. Bruk før rutekart-bygging.
 */
export async function ensureGtfsStopsLoaded() {
  return loadGtfsStops();
}

/**
 * Returnerer GTFS quay-cache. Formatert for quay-coords: Map<id, [lat,lon]>.
 * Samme Map-instans hver gang (ingen kopiering) – kallere må ikke mutere den.
 * @returns {Map<string, [number, number]>|null}
 */
export function getGtfsQuayCache() {
  return gtfsCoordMap;
}

/**
 * Returnerer holdeplasser innenfor bbox.
 * @param {number} minLat
 * @param {number} maxLat
 * @param {number} minLon
 * @param {number} maxLon
 * @param {number} [limit=2000]
 * @returns {{ id: string, lat: number, lon: number, name: string }[]}
 */
export function getStopsInBbox(minLat, maxLat, minLon, maxLon, limit = 2000) {
  if (!gtfsQuayCache) return [];
  const out = [];
  for (const [id, v] of gtfsQuayCache) {
    if (v.lat >= minLat && v.lat <= maxLat && v.lon >= minLon && v.lon <= maxLon) {
      out.push({ id, lat: v.lat, lon: v.lon, name: v.name || 'Holdeplass' });
      if (out.length >= limit) break;
    }
  }
  return out;
}

/**
 * Søk etter holdeplasser etter navn.
 * @param {string} q - Søkeord (minst 2 tegn)
 * @param {number} [limit=20]
 * @returns {{ id: string, lat: number, lon: number, name: string }[]}
 */
export function searchStops(q, limit = 20) {
  if (!gtfsQuayCache || typeof q !== 'string') return [];
  const term = q.trim().toLowerCase();
  if (term.length < 2) return [];
  const out = [];
  for (const [id, v] of gtfsQuayCache) {
    if ((v.name || '').toLowerCase().includes(term)) {
      out.push({ id, lat: v.lat, lon: v.lon, name: v.name || 'Holdeplass' });
      if (out.length >= limit) break;
    }
  }
  return out;
}
