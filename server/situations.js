/**
 * Avvik (situations) fra Entur Vehicles GraphQL for hele landet. Én felles henting hvert 2. minutt,
 * indeksert med situations-model.js. Beholder forrige vellykkede resultat ved feil, men høyst staleMaxMs.
 */

import { fetchWithRetry } from './fetch-with-retry.js';
import { CLIENT_NAME } from './entur-client.js';
import { normalizeSituation, isRelevant, buildSituationIndex } from './situations-model.js';

const GRAPHQL_URL = 'https://api.entur.io/realtime/v2/vehicles/graphql';
const QUERY = `{ situations { situationNumber severity reportType progress planned validityPeriods { startTime endTime } summary { value language } description { value language } advice { value language } infoLinks { uri } affects { stopPoints { id name } affectedLines { line { lineRef publicCode } } } } }`;

export function createSituationService({
  fetchFn = fetchWithRetry,
  now = Date.now,
  refreshMs = 120_000,
  staleMaxMs = 15 * 60_000,
} = {}) {
  let index = null;
  let fetchedAt = 0;
  let version = 0;
  let timer = null;
  let failing = false;
  let inFlight = null;

  async function fetchRaw() {
    const res = await fetchFn(
      GRAPHQL_URL,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'ET-Client-Name': CLIENT_NAME },
        body: JSON.stringify({ query: QUERY }),
      },
      { timeout: 15000, retries: 1 },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const list = json?.data?.situations;
    if (!Array.isArray(list)) throw new Error(json?.errors?.[0]?.message || 'ugyldig svar');
    return list;
  }

  async function refresh() {
    try {
      const list = await fetchRaw();
      const t = now();
      const situations = list.map(normalizeSituation).filter((s) => s && isRelevant(s, t));
      index = buildSituationIndex(situations);
      fetchedAt = t;
      version += 1;
      if (failing) console.log('[RuterLive] Avvik: henting fungerer igjen');
      failing = false;
    } catch (err) {
      if (!failing) console.warn('[RuterLive] Avvik: henting feilet:', err.message);
      failing = true;
    }
  }

  const refreshNow = () => (inFlight ??= refresh().finally(() => { inFlight = null; }));

  return {
    start() {
      if (timer) return;
      refreshNow();
      timer = setInterval(refreshNow, refreshMs);
      timer.unref?.();
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
    refreshNow,
    getIndex() {
      if (!index || now() - fetchedAt > staleMaxMs) return null;
      return index;
    },
    getVersion: () => version,
    getUpdatedAt: () => (index ? fetchedAt : null),
  };
}

let shared = null;
export function getSituationService() {
  return (shared ??= createSituationService());
}
