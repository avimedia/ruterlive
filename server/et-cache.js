/**
 * Server-side cache av ET (Estimated Timetable), én instans per region.
 * Reduserer kall mot Entur og unngår 429 rate limit.
 * Alle brukere får samme cache – 1 kall til Entur per oppdatering, ikke per bruker.
 * XML-en (~25 MB for Oslo) parses bit for bit mens den lastes ned; bare de parsede turene beholdes.
 */

import { fetchWithRetry } from './fetch-with-retry.js';
import { createEtStreamParser } from './et-parse.js';
import { CLIENT_NAME } from './entur-client.js';
import { WAITING_WINDOW_MS } from '../shared/et-journeys.js';

const REFRESH_MS = 90000; // 90 sek – færre kall mot Entur
const BACKOFF_AFTER_429_MS = 300000; // 5 min venting ved 429
const FAILURE_BACKOFF_MS = 60000; // 1 min venting etter andre feil når vi ikke har turer
const MORE_DATA_TAG = '<MoreData>true</MoreData>';
// Ingen nye biter så lenge: nedlastingen avbrytes, så en stoppet body ikke holder den delte køen
// (undici venter ellers opptil 300 s, og den andre regionens oppdatering står i kø imens)
const BODY_IDLE_MS = 20000;
const DEFAULT_MAX_SIZE = 3000; // overstyres per region med etMaxSize
// Turer som ikke er i gang lagres når de starter innen visningsvinduet (10 min) + 30 min margin for
// cachens alder: én 429 gir ~7,5 min (5 min pause + neste 90 s-tikk + henting), flere 429 eller
// tidsavbrudd på rad mer. Med 30 min forsvinner ingen tur som kan vises før neste vellykkede henting.
const STALE_MARGIN_MS = 30 * 60 * 1000;
const RELEVANT_WITHIN_MS = WAITING_WINDOW_MS + STALE_MARGIN_MS;
const ENDED_GRACE_MS = 2 * 60 * 1000; // turer som sluttet for mer enn 2 min siden lagres ikke

const BODY_TOTAL_MS = 120000; // hele body innen 2 min, selv om biter kommer dryppende

/**
 * Leser body bit for bit; avviser og avbryter hvis det går mer enn idleMs mellom bitene
 * eller mer enn totalMs til sammen.
 */
async function readBody(body, idleMs, onChunk, totalMs = BODY_TOTAL_MS) {
  const reader = body.getReader();
  const deadline = Date.now() + totalMs;
  let timer;
  try {
    for (;;) {
      const left = deadline - Date.now();
      const idle = left > idleMs;
      const wait = Math.max(0, idle ? idleMs : left);
      const stalled = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(idle
          ? `ET-body stoppet (ingen data på ${idleMs / 1000} s)`
          : `ET-body for treg (over ${totalMs / 1000} s)`)), wait);
      });
      const { done, value } = await Promise.race([reader.read(), stalled]);
      clearTimeout(timer);
      if (done) return;
      onChunk(value);
    }
  } catch (err) {
    clearTimeout(timer);
    reader.cancel().catch(() => {});
    throw err;
  }
}

/**
 * @param {object} o
 * @param {string} o.datasetId ET-datasett (f.eks. RUT, SKY)
 * @param {() => boolean} o.isActive henter i bakgrunnen bare mens regionen er aktiv
 * @param {(fn: () => Promise<any>) => Promise<any>} o.runExclusive global kø for nedlasting + parsing
 * @param {object} [o.parserOpts] valg til createEtStreamParser (Bergen: { keepUnknownMode: true, useVehicleMode: true })
 * @param {boolean} [o.waitForFirst] true: getJourneys() venter på første henting (alwaysActive-regioner)
 * @param {number} [o.bodyIdleMs] maks tid mellom to biter av body før nedlastingen avbrytes
 * @param {number} [o.bodyTotalMs] maks tid for hele body
 * @param {number} [o.startDelayMs] start(): første henting så lenge etter oppstart (0 = straks)
 * @param {number} [o.minStartDelayMs] ingen henting (heller ikke ved besøk) før så lenge etter start()
 * @param {() => void} [o.onLoad] kalles etter hver vellykkede henting (region-runtime kan da avlaste på nytt)
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
  bodyIdleMs = BODY_IDLE_MS,
  bodyTotalMs = BODY_TOTAL_MS,
  maxSize = DEFAULT_MAX_SIZE,
  onLoad = () => {},
  startDelayMs = 0,
  minStartDelayMs = 0,
}) {
  const url = `https://api.entur.io/realtime/v1/rest/et?datasetId=${datasetId}&maxSize=${maxSize}`;
  // Bare turer i gang eller som kan vises før neste henting lagres
  const parseOpts = { relevantWithinMs: RELEVANT_WITHIN_MS, endedGraceMs: ENDED_GRACE_MS, now, ...parserOpts };
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
  let startTimer = null;
  let notBefore = 0; // satt av start(): ingen henting før dette tidspunktet

  async function doRefresh() {
    const gen = generation;
    const fetchedAt = now();
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
    const headersMs = now() - fetchedAt;
    let loaded = false;
    await runExclusive(async () => {
      const startedAt = now();
      const parser = createEtStreamParser(parseOpts);
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
        await readBody(res.body, bodyIdleMs, (chunk) => push(decoder.decode(chunk, { stream: true })), bodyTotalMs);
      }
      push(decoder.decode());
      const parsed = parser.end();
      const count = parser.seen;
      for (const j of parsed) Object.freeze(j);
      if (moreData) {
        console.warn(`[RuterLive] ET ${datasetId}: MoreData=true, svaret er avkortet (maxSize=${maxSize} for lite)`);
      }
      // Entur sender ikke alltid MoreData: like mange turer som maxSize betyr trolig avkutting
      if (count >= maxSize) {
        console.warn(`[RuterLive] ET ${datasetId}: ${count} turer ≥ maxSize=${maxSize}, svaret er trolig avkortet`);
      }
      // Første henting og deretter omtrent hver halvtime (hver 20.), så loggen ikke fylles
      if (version % 20 === 0) {
        console.log(`[RuterLive] ET ${datasetId}: ${count} turer lest, ${parsed.length} beholdt, `
          + `svar ${headersMs} ms, nedlasting+parsing ${now() - startedAt} ms`);
      }
      if (gen !== generation) return; // drop() under henting: ikke behold turene
      journeys = parsed;
      version++;
      lastFetch = now();
      loaded = true;
    });
    lastFailAt = 0;
    if (loaded) onLoad();
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
    if (now() < notBefore) return; // Oppstart: vent, så regionene ikke henter ET samtidig (429)
    if (last429At && now() - last429At < BACKOFF_AFTER_429_MS) return; // Vent etter 429
    if (!journeys && lastFailAt && now() - lastFailAt < FAILURE_BACKOFF_MS) return; // Vent etter feil uten data
    refreshNow().catch((e) => console.warn(`[RuterLive] ET-henting ${datasetId}:`, e.message));
  }

  return {
    /**
     * Parsede ET-turer (se parseEtJourneys), delt av alle tjenester. Turene er frosset.
     * Utløpt cache: forrige turer returneres straks og revalideres i bakgrunnen, men bare mens regionen
     * er aktiv. Hvilende/avlastet region henter ikke (linjesider og robotene vekker den ikke), bare besøk.
     * Uten data: venter på første henting bare med waitForFirst, ellers [] og henting i bakgrunnen (aktiv).
     */
    async getJourneys() {
      if (journeys && now() - lastFetch <= refreshMs) return journeys;
      if (journeys) {
        if (isActive()) refreshInBackground();
        return journeys;
      }
      if (!waitForFirst) {
        if (isActive()) refreshInBackground();
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
    /**
     * Én henting uansett tilstand (straks, eller etter startDelayMs), deretter intervall som bare henter
     * mens regionen er aktiv. Gir et løfte som løses etter første henting (avvises aldri).
     * Første henting går gjennom refreshNow(), så et samtidig refreshNow()/getJourneys() deler den.
     */
    start() {
      if (timer || startTimer) return Promise.resolve();
      notBefore = now() + minStartDelayMs;
      // Intervallet starter ved første henting, så en forsinket region ikke henter to ganger da
      const begin = () => {
        timer = setInterval(() => { if (isActive()) refreshInBackground(); }, refreshMs);
        timer.unref?.();
        // Et besøk kan alt ha hentet turene: da ingen ekstra henting
        return (journeys ? Promise.resolve() : refreshNow()).catch((e) => {
          console.warn(`[RuterLive] ET-henting ${datasetId}:`, e.message);
        });
      };
      if (!startDelayMs) return begin();
      return new Promise((resolve) => {
        startTimer = setTimeout(() => { startTimer = null; resolve(begin()); }, startDelayMs);
        startTimer.unref?.();
      });
    },
    stop() {
      if (timer) clearInterval(timer);
      if (startTimer) clearTimeout(startTimer);
      timer = null;
      startTimer = null;
    },
  };
}
