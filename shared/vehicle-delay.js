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

/** «+N min» for visning, eller '' når forsinkelsen er under grensen. */
export function delayLabel(seconds) {
  if (!Number.isFinite(seconds) || seconds < DELAY_SHOWN_S) return '';
  return `+${Math.round(seconds / 60)} min`;
}
