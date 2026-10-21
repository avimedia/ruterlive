// Rene hjelpefunksjoner for datahenting og GPS-glidning (testbare uten DOM).

const LIVE_RETRY_EVERY = 3; // etter feil: prøv ny feed igjen hver 3. poll

/** Bestemmer om /api/vehicles-live skal prøves ved denne pollen. */
export function createFeedPolicy(retryEvery = LIVE_RETRY_EVERY) {
  let failures = 0;
  let skipped = 0;
  return {
    shouldTryLive() {
      if (failures === 0) return true;
      if (skipped + 1 >= retryEvery) {
        skipped = 0;
        return true;
      }
      skipped++;
      return false;
    },
    recordSuccess() {
      failures = 0;
      skipped = 0;
    },
    recordFailure() {
      failures++;
      skipped = 0;
    },
    get failures() {
      return failures;
    },
  };
}

/** 5xx beholder gamle data; andre feil (404, ikke-JSON, manglende versjon) gir fallback til gammel feed. */
export function shouldFallBackToLegacy(err) {
  const s = err?.status;
  return !(typeof s === 'number' && s >= 500);
}

export const GPS_GLIDE_MIN_MS = 8000;
export const GPS_GLIDE_MAX_MS = 20000;
export const GPS_GLIDE_DEFAULT_MS = 10000;

/**
 * Glidetid for GPS-kjøretøy: halvparten av observert intervall mellom posisjonsendringer,
 * begrenset til 8–20 s. Gir jevn bevegelse uten å ligge 25+ s etter.
 */
export function gpsGlideMs(intervalMs) {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return GPS_GLIDE_DEFAULT_MS;
  return Math.min(GPS_GLIDE_MAX_MS, Math.max(GPS_GLIDE_MIN_MS, intervalMs * 0.5));
}
