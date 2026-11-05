/**
 * Regionen siden vises i (fra URL-stien) og hjelpere for API-kall per region.
 * Oslo legger ikke til noe i URL-ene, så Oslo-forespørslene og Cloudflare-cachen er uendret.
 */

import { regionFromPath, visibleRegions } from '../shared/regions.js';

/** Kommaseparert forhåndsvisningsliste (VITE_REGIONS_PREVIEW) til id-er. */
export function parsePreview(raw) {
  return String(raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

const PREVIEW = parsePreview(typeof import.meta.env !== 'undefined' ? import.meta.env.VITE_REGIONS_PREVIEW : '');
const VISIBLE = visibleRegions(PREVIEW);

/** Regionen for stien (standard: nåværende side). */
export function currentRegion(pathname = globalThis.location?.pathname ?? '/', visible = VISIBLE) {
  return regionFromPath(pathname, visible).region;
}

/** Legger til region=<id> bortsett fra for Oslo. */
export function withRegion(url, pathname, visible) {
  const region = currentRegion(pathname, visible);
  if (region.id === 'oslo') return url;
  return `${url}${url.includes('?') ? '&' : '?'}region=${encodeURIComponent(region.id)}`;
}

/** Lagringsnøkkel per region; Oslo beholder den gamle nøkkelen. */
export function viewKeyFor(region, baseKey) {
  return region.id === 'oslo' ? baseKey : `${baseKey}-${region.id}`;
}
