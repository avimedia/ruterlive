/**
 * Server-side cache av ET (Estimated Timetable). Reduserer kall mot Entur og unngår 429 rate limit.
 * Alle brukere får samme cache – 1 kall til Entur per oppdatering, ikke per bruker.
 * XML-en (~25 MB) parses bit for bit mens den lastes ned; bare de parsede turene beholdes.
 */

import { fetchWithRetry } from './fetch-with-retry.js';
import { createEtStreamParser } from './et-parse.js';

const ET_URL = 'https://api.entur.io/realtime/v1/rest/et?datasetId=RUT&maxSize=3000';
const CLIENT_NAME = 'ruterlive-web';
const REFRESH_MS = 90000; // 90 sek – færre kall mot Entur
const BACKOFF_AFTER_429_MS = 300000; // 5 min venting ved 429

/** Frosne turer fra siste vellykkede henting, eller null før første. */
let journeys = null;
let version = 0; // Øker for hver ny ET fra Entur
let lastFetch = 0;
let last429At = 0;
let lastWarnAt = 0;
let refreshPromise = null;

async function doRefresh() {
  const res = await fetchWithRetry(
    ET_URL,
    { headers: { 'ET-Client-Name': CLIENT_NAME } },
    { timeout: 60000, retries: 1 }
  );
  if (!res.ok) {
    try { await res.body?.cancel?.(); } catch { /* ignorer */ }
    if (res.status === 429) {
      last429At = Date.now();
      throw new Error('429 Rate limit – prøv igjen om litt');
    }
    throw new Error(`ET ${res.status}`);
  }
  const parser = createEtStreamParser();
  const decoder = new TextDecoder();
  if (res.body) {
    for await (const chunk of res.body) parser.push(decoder.decode(chunk, { stream: true }));
  }
  parser.push(decoder.decode());
  const parsed = parser.end();
  for (const j of parsed) Object.freeze(j);
  journeys = parsed;
  version++;
  lastFetch = Date.now();
}

/** Én henting om gangen. Avviser bare når vi ikke har noen tidligere turer. */
function refresh() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      await doRefresh();
    } catch (err) {
      if (!journeys) throw err;
      if (Date.now() - lastWarnAt > BACKOFF_AFTER_429_MS) {
        lastWarnAt = Date.now();
        console.warn('[RuterLive] ET refresh failed, using cache:', err.message);
      }
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

export function getEtAge() {
  return lastFetch ? Date.now() - lastFetch : null;
}

/** Versjon av ET-dataene; øker ved hver ny henting. 0 før første. */
export function getEtVersion() {
  return version;
}

/**
 * Parsede ET-turer (se parseEtJourneys), delt av alle tjenester.
 * Ved utløpt cache: returnerer forrige turer umiddelbart og revaliderer i bakgrunnen.
 * Turene er frosset: kopier ({ ...j, mode }) før endring.
 */
export async function getEtJourneys() {
  if (journeys && Date.now() - lastFetch <= REFRESH_MS) return journeys;
  if (journeys) {
    refreshInBackground();
    return journeys;
  }
  await refresh();
  return journeys;
}

// Feil i bakgrunnshenting (429, timeout) logges; uhåndtert rejection ville drept prosessen.
function refreshInBackground() {
  if (last429At && Date.now() - last429At < BACKOFF_AFTER_429_MS) return; // Vent etter 429
  refresh().catch((e) => console.warn('[RuterLive] ET-henting:', e.message));
}

export function startEtCachePoll() {
  refreshInBackground();
  setInterval(refreshInBackground, REFRESH_MS);
}
