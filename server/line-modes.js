/**
 * Transportmodus per linje fra Entur Journey Planner, delt av et-vehicles-service og shape-service.
 * Modulnivå-cache med lang levetid: alle ukjente linjer hentes én gang i bolker, og feil
 * (nettverk eller linje uten modus) huskes i 10 min så de ikke gir JP-kall hvert 15. s.
 */

import { fetchWithRetry } from './fetch-with-retry.js';
import { CLIENT_NAME } from './entur-client.js';

const JP_URL = 'https://api.entur.io/journey-planner/v3/graphql';

export const LINE_MODE_TTL_MS = 24 * 60 * 60 * 1000;
export const LINE_MODE_NEGATIVE_TTL_MS = 10 * 60 * 1000;
export const LINE_MODE_BATCH_SIZE = 50;

export function mapJpTransportMode(jpMode) {
  if (!jpMode) return null;
  const m = (typeof jpMode === 'object' ? jpMode?.name ?? jpMode?.transportMode : jpMode).toString().toLowerCase();
  if (['metro', 'bus', 'tram', 'water', 'rail'].includes(m)) return m;
  if (['ferry', 'ferje'].includes(m)) return 'water';
  return null;
}

/**
 * Ren cache: ref -> { mode, expires }. mode null = negativt svar (kort levetid).
 * @param {{ now?: () => number, ttlMs?: number, negativeTtlMs?: number }} opts
 */
export function createLineModeCache({ now = Date.now, ttlMs = LINE_MODE_TTL_MS, negativeTtlMs = LINE_MODE_NEGATIVE_TTL_MS } = {}) {
  const entries = new Map();
  const fresh = (e) => e && e.expires > now();
  return {
    /** Modus, eller undefined hvis ukjent/negativ/utløpt. */
    get(ref) {
      const e = entries.get(ref);
      return fresh(e) ? e.mode ?? undefined : undefined;
    },
    set(ref, mode) {
      entries.set(ref, { mode: mode || null, expires: now() + (mode ? ttlMs : negativeTtlMs) });
    },
    /** Refs som må hentes: ukjente eller utløpte (også negative etter 10 min). */
    missing(refs) {
      const out = [];
      const seen = new Set();
      for (const ref of refs) {
        if (!ref || seen.has(ref)) continue;
        seen.add(ref);
        if (!fresh(entries.get(ref))) out.push(ref);
      }
      return out;
    },
    get size() {
      return entries.size;
    },
  };
}

/**
 * Henter manglende linjer i bolker. `query(refs)` gir { [ref]: jpTransportMode } eller kaster.
 * Linjer uten svar og bolker som feiler caches negativt.
 */
export async function fillLineModes(refs, cache, query, batchSize = LINE_MODE_BATCH_SIZE) {
  const toFetch = cache.missing(refs);
  for (let i = 0; i < toFetch.length; i += batchSize) {
    const batch = toFetch.slice(i, i + batchSize);
    let result = null;
    try {
      result = await query(batch);
    } catch (_) {
      result = null;
    }
    for (const ref of batch) cache.set(ref, mapJpTransportMode(result?.[ref]));
  }
  return toFetch.length;
}

async function queryJp(refs) {
  const body = refs.map((id, i) => `l${i}: line(id: ${JSON.stringify(id)}) { transportMode }`).join('\n');
  const res = await fetchWithRetry(
    JP_URL,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'ET-Client-Name': CLIENT_NAME },
      body: JSON.stringify({ query: `query { ${body} }` }),
    },
    { timeout: 15000, retries: 1 }
  );
  const data = (await res.json())?.data;
  if (!data) throw new Error('JP linjemodus: tomt svar');
  const out = {};
  refs.forEach((ref, i) => {
    out[ref] = data[`l${i}`]?.transportMode ?? null;
  });
  return out;
}

const sharedCache = createLineModeCache();
let inFlight = null;

/** Sørger for at alle refs er slått opp (deler pågående henting). */
export async function ensureLineModes(refs) {
  while (inFlight) await inFlight.catch(() => {});
  if (sharedCache.missing(refs).length === 0) return;
  inFlight = fillLineModes(refs, sharedCache, queryJp).finally(() => {
    inFlight = null;
  });
  await inFlight;
}

export function getLineMode(ref) {
  return sharedCache.get(ref);
}
