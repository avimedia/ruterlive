/**
 * Server-side cache av ET (Estimated Timetable), én instans per region.
 * Reduserer kall mot Entur og unngår 429 rate limit.
 * Alle brukere får samme cache – 1 kall til Entur per oppdatering, ikke per bruker.
 * XML-en (~25 MB for Oslo) parses bit for bit mens den lastes ned; bare de parsede turene beholdes.
 */

import { fetchWithRetry } from './fetch-with-retry.js';
import { createEtStreamParser } from './et-parse.js';
import { CLIENT_NAME } from './entur-client.js';
import { getRegion } from '../shared/regions.js';

const REFRESH_MS = 90000; // 90 sek – færre kall mot Entur
const BACKOFF_AFTER_429_MS = 300000; // 5 min venting ved 429
const FAILURE_BACKOFF_MS = 60000; // 1 min venting etter andre feil når vi ikke har turer
const MORE_DATA_TAG = '<MoreData>true</MoreData>';

/**
 * @param {object} o
 * @param {string} o.datasetId ET-datasett (f.eks. RUT, SKY)
 * @param {() => boolean} o.isActive henter i bakgrunnen bare mens regionen er aktiv
 * @param {(fn: () => Promise<any>) => Promise<any>} o.runExclusive global kø for nedlasting + parsing
 * @param {object} [o.parserOpts] valg til createEtStreamParser (Bergen: { keepUnknownMode: true, useVehicleMode: true })
 * @param {boolean} [o.waitForFirst] true: getJourneys() venter på første henting (alwaysActive-regioner)
 */
export function createEtCache({
  datasetId,
  isActive = () => true,
  runExclusive = (fn) => fn(),
  fetchFn = fetchWithRetry,
  now = () => Date.now(),
  refreshMs = REFRESH_MS,
  waitForFirst = false,
  parserOpts = {},
}) {
  const url = `https://api.entur.io/realtime/v1/rest/et?datasetId=${datasetId}&maxSize=3000`;
  /** Frosne turer fra siste vellykkede henting, eller null før første / etter drop(). */
  let journeys = null;
  let version = 0; // Øker for hver ny ET fra Entur
  let lastFetch = 0;
  let last429At = 0;
  let lastWarnAt = 0;
  let refreshPromise = null;
  let lastFailAt = 0;
  let generation = 0; // Øker ved drop(); pågående henting forkastes
  let timer = null;

  async function doRefresh() {
    const gen = generation;
    const res = await fetchFn(
      url,
      { headers: { 'ET-Client-Name': CLIENT_NAME } },
      { timeout: 60000, retries: 1 }
    );
    if (!res.ok) {
      try { await res.body?.cancel?.(); } catch { /* ignorer */ }
      if (res.status === 429) {
        last429At = now();
        throw new Error('429 Rate limit – prøv igjen om litt');
      }
      throw new Error(`ET ${res.status}`);
    }
    await runExclusive(async () => {
      const parser = createEtStreamParser(parserOpts);
      const decoder = new TextDecoder();
      let tail = '';
      let moreData = false;
      const push = (text) => {
        if (!moreData) {
          const s = tail + text;
          if (s.includes(MORE_DATA_TAG)) moreData = true;
          tail = s.slice(-(MORE_DATA_TAG.length - 1));
        }
        parser.push(text);
      };
      if (res.body) {
        for await (const chunk of res.body) push(decoder.decode(chunk, { stream: true }));
      }
      push(decoder.decode());
      const parsed = parser.end();
      for (const j of parsed) Object.freeze(j);
      if (moreData) {
        console.warn(`[RuterLive] ET ${datasetId}: MoreData=true, svaret er avkortet (maxSize=3000 for lite)`);
      }
      if (gen !== generation) return; // drop() under henting: ikke behold turene
      journeys = parsed;
      version++;
      lastFetch = now();
    });
    lastFailAt = 0;
  }

  /** Én henting om gangen. Avviser bare når vi ikke har noen tidligere turer. */
  function refreshNow() {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      try {
        await doRefresh();
      } catch (err) {
        lastFailAt = now();
        if (!journeys) throw err;
        if (now() - lastWarnAt > BACKOFF_AFTER_429_MS) {
          lastWarnAt = now();
          console.warn(`[RuterLive] ET ${datasetId} refresh failed, using cache:`, err.message);
        }
      } finally {
        refreshPromise = null;
      }
    })();
    return refreshPromise;
  }

  // Feil i bakgrunnshenting (429, timeout) logges; uhåndtert rejection ville drept prosessen.
  function refreshInBackground() {
    if (last429At && now() - last429At < BACKOFF_AFTER_429_MS) return; // Vent etter 429
    if (!journeys && lastFailAt && now() - lastFailAt < FAILURE_BACKOFF_MS) return; // Vent etter feil uten data
    refreshNow().catch((e) => console.warn(`[RuterLive] ET-henting ${datasetId}:`, e.message));
  }

  return {
    /**
     * Parsede ET-turer (se parseEtJourneys), delt av alle tjenester. Turene er frosset.
     * Utløpt cache: forrige turer returneres straks og revalideres i bakgrunnen (også i hvilende region).
     * Uten data: venter på første henting bare med waitForFirst, ellers [] og henting i bakgrunnen.
     */
    async getJourneys() {
      if (journeys && now() - lastFetch <= refreshMs) return journeys;
      if (journeys) {
        refreshInBackground();
        return journeys;
      }
      if (!waitForFirst) {
        refreshInBackground();
        return [];
      }
      await refreshNow();
      return journeys;
    },
    getVersion: () => version,
    getAge: () => (lastFetch ? now() - lastFetch : null),
    refreshNow,
    /** Avlast: slipp turene. Neste getJourneys() starter ny henting. */
    drop() {
      journeys = null;
      lastFetch = 0;
      generation++;
    },
    /** Én henting nå, deretter intervall som bare henter mens regionen er aktiv. */
    start() {
      refreshInBackground();
      if (timer) return;
      timer = setInterval(() => { if (isActive()) refreshInBackground(); }, refreshMs);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

// Oslo-instans (alltid aktiv) til alle brukere er flyttet til regionkjøretiden
const oslo = createEtCache({
  datasetId: getRegion('oslo').etDatasets[0],
  isActive: () => true,
  runExclusive: (fn) => fn(),
  waitForFirst: true,
});

export const getEtAge = () => oslo.getAge();
export const getEtVersion = () => oslo.getVersion();
export const getEtJourneys = () => oslo.getJourneys();
export const startEtCachePoll = () => oslo.start();
