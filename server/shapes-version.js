/**
 * Stabil versjon av rutekart-payloaden (/api/route-shapes-all).
 * ET-avledede rutekart bygges på nytt ved hver ET-oppdatering (hvert 90. s) og varierer med hvilke
 * turer som er i trafikk. Uten demping får alle klienter en ny ~450 kB-nedlasting hvert par minutt.
 */

const keyOf = (s) => `${(s.mode || '').toLowerCase()}|${s.line ?? ''}|${s.from || ''}|${s.to || ''}`;

/** Sortert kopi etter nøkkel (mode|line|from|to): samme sett i annen rekkefølge gir samme JSON. */
export function sortShapes(shapes) {
  const withKey = (shapes ?? []).map((s) => [keyOf(s), s]);
  withKey.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return withKey.map(([, s]) => s);
}

/**
 * Holder på en verdi og bytter den ut høyst hvert `minIntervalMs`. Første ikke-tomme verdi tas
 * med en gang (kald start), deretter beholdes forrige til intervallet har gått.
 * Returnerer samme referanse så lenge verdien ikke er byttet, så memoEntry kan gjenbruke svaret.
 */
export function createThrottledSnapshot(minIntervalMs, { now = Date.now, isEmpty = (v) => !v?.length } = {}) {
  let value = null;
  let takenAt = 0;
  return (next) => {
    if (next === value) return value;
    const t = now();
    if (value === null || (isEmpty(value) && !isEmpty(next)) || t - takenAt >= minIntervalMs) {
      value = next;
      takenAt = t;
    }
    return value;
  };
}
