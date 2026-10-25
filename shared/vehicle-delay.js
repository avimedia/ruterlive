/**
 * Forsinkelse fra SIRI ET: forventet minus planlagt tid ved neste stopp.
 * Rene funksjoner, delt av server (et-parse, vehicles-payload) og klient (et-api, markers).
 */

/**
 * Forsinkelse i hele sekunder for ett kall (ms-tider). Ankomst brukes når både forventet og planlagt
 * ankomst finnes, ellers avgang. 0 når tidene mangler. Negativ = foran ruten.
 */
export function callDelaySeconds(expArrMs, aimedArrMs, expDepMs, aimedDepMs) {
  if (Number.isFinite(expArrMs) && Number.isFinite(aimedArrMs)) return Math.round((expArrMs - aimedArrMs) / 1000);
  if (Number.isFinite(expDepMs) && Number.isFinite(aimedDepMs)) return Math.round((expDepMs - aimedDepMs) / 1000);
  return 0;
}

/** Forsinkelse slik den sendes i /api/vehicles-live: avrundet til 30 s, null under ett minutt (utelates). */
export function roundDelay(seconds) {
  if (!Number.isFinite(seconds) || seconds < 60) return null;
  return Math.round(seconds / 30) * 30;
}

/** Fra denne grensen (sekunder) vises forsinkelsen på kartet. */
export const DELAY_SHOWN_S = 120;
/** Fra denne grensen er ringen rød i stedet for oransje. */
export const DELAY_MAJOR_S = 300;

/** Over denne grensen (sekunder) regnes forsinkelsen som feil i dataene og vises ikke. */
export const DELAY_MAX_S = 180 * 60;

/** Forsinkelsen som skal vises (sekunder), eller 0: under grensen, negativ eller urimelig stor. */
export function shownDelay(seconds) {
  if (!Number.isFinite(seconds) || seconds < DELAY_SHOWN_S || seconds > DELAY_MAX_S) return 0;
  return seconds;
}

/** «+N min» (2–59 min), «over 1 t» fra en time, eller '' når forsinkelsen ikke skal vises. */
export function delayLabel(seconds) {
  const s = shownDelay(seconds);
  if (!s) return '';
  const min = Math.round(s / 60);
  return min >= 60 ? 'over 1 t' : `+${min} min`;
}
