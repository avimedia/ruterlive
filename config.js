/**
 * Sentrale innstillinger – let å finne og justere.
 * Endre her for å påvirke både server og klient.
 */

/** Maks km mellom nabostopp før rute forkastes som feil. Lokal trafikk (T-bane, trikk): 25. Buss/ekspress: 50. */
export const MAX_ROUTE_SPAN_KM = 25;
export const MAX_ROUTE_SPAN_KM_BUS = 50;

/** Flytoget har linjekodene FLY1 og FLY2 i Entur. F1, F4, F6 o.l. er Vy/SJ-tog. */
export function isFlytogLineCode(code) {
  return /^FLY\d+$/i.test((code || '').toString().trim());
}
