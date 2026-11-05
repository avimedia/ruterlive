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

/** Regionen posisjonen ligger i hvis den er en annen synlig region enn den nåværende, ellers null. */
export function regionForPosition(lat, lon, current, visible = VISIBLE) {
  const target = regionAt(lat, lon, visible);
  return target && target.id !== current.id ? target : null;
}

/** Posisjonen i en delt lenke (?lat=&lng=), eller null når den mangler eller er ugyldig. */
function linkPosition(search) {
  const params = new URLSearchParams(search ?? '');
  if (!params.has('lat') || !params.has('lng')) return null;
  const lat = Number(params.get('lat'));
  const lon = Number(params.get('lng'));
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

/** Lenke til et bestemt sted eller en linje (holdeplass-/linjesider, delte lenker): ikke flytt etter lagret valg eller posisjon. */
export function hasLinkParams(search) {
  return linkPosition(search) !== null || new URLSearchParams(search ?? '').has('linje');
}

/**
 * Hvilken sti kartet skal flyttes til ved oppstart, eller null (bli der du er).
 * Ren funksjon: Permissions API og posisjon hentes av kalleren.
 * Lenke med ?lat&lng: regionen for posisjonen (lagret valg ignoreres). Bare ?linje=: bli der du er.
 * Ellers vinner regionssti; så lagret valg; så posisjon bare når tillatelsen alt er gitt.
 */
export function chooseStartRegion({ pathname, stored, permission, position, search = '', visible = VISIBLE }) {
  const here = regionFromPath(pathname, visible);
  const linked = linkPosition(search);
  if (linked) {
    const target = regionAt(linked.lat, linked.lon, visible);
    return target && target.id !== here.region.id ? regionPath(target) : null;
  }
  if (hasLinkParams(search)) return null;
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
