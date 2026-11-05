/**
 * Regioner som er skjult for publikum, men kan forhåndsvises lokalt via REGIONS_PREVIEW (kommaseparert id-liste).
 */
import { visibleRegions } from '../shared/regions.js';

/** "bergen, oslo" → ['bergen', 'oslo']. Tom eller manglende verdi gir []. */
export function parsePreview(str) {
  if (typeof str !== 'string') return [];
  return str.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/** Synlige regioner for serveren (offentlige + forhåndsvisning). */
export function serverVisibleRegions(env = process.env) {
  return visibleRegions(parsePreview(env.REGIONS_PREVIEW));
}
