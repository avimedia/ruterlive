/**
 * Husker siste kartutsnitt og lagvalg i localStorage.
 * Rene funksjoner (parse/serialize) er testet i test/view-memory.test.js.
 */

import { NORWAY_BOUNDS } from '../shared/regions.js';

export const VIEW_KEY = 'ruterlive-view';
export const LAYERS_KEY = 'ruterlive-layers';

export const MIN_REMEMBER_ZOOM = 9;
export const MAX_ZOOM = 19;

export function isValidView(v) {
  if (!v || typeof v !== 'object') return false;
  const { lat, lng, z } = v;
  if (![lat, lng, z].every((n) => typeof n === 'number' && Number.isFinite(n))) return false;
  if (z < MIN_REMEMBER_ZOOM || z > MAX_ZOOM) return false;
  return lat >= NORWAY_BOUNDS.minLat && lat <= NORWAY_BOUNDS.maxLat
    && lng >= NORWAY_BOUNDS.minLon && lng <= NORWAY_BOUNDS.maxLon;
}

/** Returnerer JSON-streng, eller null hvis utsnittet ikke bør huskes. */
export function serializeView(lat, lng, z) {
  const v = { lat: Number(lat.toFixed(5)), lng: Number(lng.toFixed(5)), z };
  return isValidView(v) ? JSON.stringify(v) : null;
}

/** Returnerer {lat,lng,z} eller null ved ugyldig/manglende data. */
export function parseView(raw) {
  if (typeof raw !== 'string') return null;
  try {
    const v = JSON.parse(raw);
    return isValidView(v) ? { lat: v.lat, lng: v.lng, z: v.z } : null;
  } catch {
    return null;
  }
}

/** states: { id: boolean } -> JSON-streng. */
export function serializeLayers(states) {
  const out = {};
  for (const [id, on] of Object.entries(states || {})) out[id] = !!on;
  return JSON.stringify(out);
}

/** Returnerer { id: boolean } for kjente id-er; ukjente og ikke-boolske verdier droppes. */
export function parseLayers(raw, knownIds) {
  if (typeof raw !== 'string') return {};
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const known = new Set(knownIds);
    const out = {};
    for (const [id, on] of Object.entries(v)) {
      if (known.has(id) && typeof on === 'boolean') out[id] = on;
    }
    return out;
  } catch {
    return {};
  }
}

function readStorage(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeStorage(key, value) {
  try { localStorage.setItem(key, value); } catch { /* privat modus */ }
}

/** Setter kartet til sist lagrede utsnitt (kalles bare uten lat/lng i URL). */
export function restoreView(map) {
  const v = parseView(readStorage(VIEW_KEY));
  if (v) map.setView([v.lat, v.lng], v.z, { animate: false });
}

/** Lagrer utsnittet ved moveend, utsatt 500 ms. */
export function initViewMemory(map) {
  let timer = null;
  map.on('moveend', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const c = map.getCenter();
      const s = serializeView(c.lat, c.lng, map.getZoom());
      if (s) writeStorage(VIEW_KEY, s);
    }, 500);
  });
}

function layerInputs(root) {
  return [...root.querySelectorAll('.layer-controls input[data-mode], #routes-toggle')];
}
const layerId = (el) => el.dataset.mode || 'routes';

/** Gjenoppretter avkryssingsboksene (kalles før første filtrering). */
export function restoreLayerState(root = document) {
  const inputs = layerInputs(root);
  const saved = parseLayers(readStorage(LAYERS_KEY), inputs.map(layerId));
  for (const el of inputs) {
    const id = layerId(el);
    if (id in saved) el.checked = saved[id];
  }
}

export function saveLayerState(root = document) {
  const states = {};
  for (const el of layerInputs(root)) states[layerId(el)] = el.checked;
  writeStorage(LAYERS_KEY, serializeLayers(states));
}
