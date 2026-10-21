/**
 * Henter og parser GTFS stops.txt fra Entur for å bygge quay → koordinater.
 * Brukes som fallback når Journey Planner ikke har quay-koordinater tilgjengelig.
 * Nedlasting maks 1x per 24t (Entur rate limit).
 */

import AdmZip from 'adm-zip';
import { fetchWithRetry } from './fetch-with-retry.js';

const GTFS_URL =
  'https://storage.googleapis.com/marduk-production/outbound/gtfs/rb_norway-aggregated-gtfs-basic.zip';
const CACHE_TTL_MS = 23 * 60 * 60 * 1000; // 23t – litt under 24t
const DOWNLOAD_TIMEOUT_MS = 120000; // 2 min for ~95MB

let gtfsQuayCache = null;
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
export async function loadGtfsStops() {
  if (gtfsQuayCache && Date.now() - lastLoadTime < CACHE_TTL_MS) {
    return gtfsQuayCache;
  }

  try {
    const res = await fetchWithRetry(
      GTFS_URL,
      { method: 'GET' },
      { timeout: DOWNLOAD_TIMEOUT_MS, retries: 2 }
    );
    if (!res.ok) throw new Error(`GTFS ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const zip = new AdmZip(buf);
    const entry = zip.getEntry('stops.txt');
    if (!entry) throw new Error('stops.txt mangler i GTFS');
    const content = entry.getData().toString('utf8');
    gtfsQuayCache = parseStopsTxt(content);
    lastLoadTime = Date.now();
    console.log(`[RuterLive] GTFS stops: ${gtfsQuayCache.size} quays`);
    return gtfsQuayCache;
  } catch (err) {
    console.warn('[RuterLive] GTFS stops load:', err.message);
    if (gtfsQuayCache) return gtfsQuayCache;
    return null;
  }
}

/**
 * Sørger for at GTFS er lastet. Bruk før rutekart-bygging.
 */
export async function ensureGtfsStopsLoaded() {
  return loadGtfsStops();
}

/**
 * Returnerer GTFS quay-cache. Formatert for quay-coords: Map<id, [lat,lon]>.
 * @returns {Map<string, [number, number]>|null}
 */
export function getGtfsQuayCache() {
  if (!gtfsQuayCache) return null;
  const legacy = new Map();
  for (const [id, v] of gtfsQuayCache) {
    legacy.set(id, [v.lat, v.lon]);
  }
  return legacy;
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
