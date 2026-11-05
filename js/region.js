/**
 * Regionen siden vises i (fra URL-stien) og hjelpere for API-kall per region.
 * Oslo legger ikke til noe i URL-ene, så Oslo-forespørslene og Cloudflare-cachen er uendret.
 */

import { regionFromPath, regionPath, regionAt, findRegion, visibleRegions } from '../shared/regions.js';

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

/** Synlige regioner i denne bygningen (Bergen bare i forhåndsvisning). */
export function clientVisibleRegions() {
  return VISIBLE;
}

const STORAGE_KEY = 'livetrafikk.region';

export function readStoredRegion() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function storeRegion(id) {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch { /* lagring er valgfritt */ }
}

/** Lagrer valget og laster siden på nytt i regionen (full innlasting). */
export function switchRegion(region) {
  storeRegion(region.id);
  globalThis.location.assign(regionPath(region));
}

/**
 * Hvilken sti kartet skal flyttes til ved oppstart, eller null (bli der du er).
 * Ren funksjon: Permissions API og posisjon hentes av kalleren.
 * Regionssti vinner alltid; ellers lagret valg; ellers posisjon bare når tillatelsen alt er gitt.
 */
export function chooseStartRegion({ pathname, stored, permission, position, visible = VISIBLE }) {
  const here = regionFromPath(pathname, visible);
  if (here.region.path) return null;
  const storedRegion = findRegion(stored);
  if (storedRegion && visible.includes(storedRegion)) {
    return storedRegion.id === here.region.id ? null : regionPath(storedRegion);
  }
  if (permission === 'granted' && position) {
    const target = regionAt(position.lat, position.lon, visible);
    if (target && target.id !== here.region.id) return regionPath(target);
  }
  return null;
}
