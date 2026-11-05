/**
 * Oslo sine statiske rutekart: togkart (Entur JP fra Oslo S, OSM eller hardkodet reserve) og flybuss
 * (statiske koordinater, ukentlig oppdatert fra JP). Flyttet fra server.js så regionregisteret kan bruke dem.
 */

import { fetchRailShapesOnly, fetchFlybussShapesOnly } from './jp-route-fetcher.js';
import { fetchOsmRailTracks } from './osm-rail-fetcher.js';
import { getFlybussShapes } from './flybuss-shapes.js';
import { getFallbackRailShapes } from './rail-fallback-shapes.js';
import { ensureGtfsStopsLoaded } from './gtfs-stops-loader.js';
import { mergeShapes } from './live-vehicles.js';

let railShapesCache = [];
let flybussShapesCache = [];

export const getRailShapes = () => railShapesCache;
export const getStaticFlybussShapes = () => flybussShapesCache;

export async function loadRailShapes() {
  try {
    const enturShapes = await fetchRailShapesOnly();
    if (enturShapes.length > 0) {
      railShapesCache = enturShapes;
      console.log(`[RuterLive] Jernbanekart (Entur): ${enturShapes.length} linjer`);
      return true;
    }
  } catch (e) {
    console.warn('[RuterLive] Entur jernbane:', e.message);
  }
  try {
    const osmShapes = await fetchOsmRailTracks();
    if (osmShapes.length > 0) {
      railShapesCache = osmShapes;
      console.log(`[RuterLive] Jernbanekart (OSM): ${osmShapes.length} strekninger`);
      return true;
    }
  } catch (e) {
    console.warn('[RuterLive] OSM jernbane:', e.message);
  }
  if (railShapesCache.length === 0) {
    railShapesCache = getFallbackRailShapes();
    console.log('[RuterLive] Jernbanekart (fallback): ' + railShapesCache.length + ' linjer');
  }
  return railShapesCache.length > 0;
}

export function loadFlybussShapes() {
  flybussShapesCache = getFlybussShapes();
  console.log(`[RuterLive] Flybuss-rutenett: ${flybussShapesCache.length} linjer`);
}

export const FLYBUSS_REFRESH_MS = 7 * 24 * 60 * 60 * 1000; // Ukentlig

export async function refreshFlybussFromJp() {
  try {
    await ensureGtfsStopsLoaded();
    const jpShapes = await fetchFlybussShapesOnly();
    if (jpShapes.length > 0) {
      flybussShapesCache = mergeShapes(getFlybussShapes(), jpShapes); // JP vinner ved konflikt
      console.log(`[RuterLive] Flybuss oppdatert fra Entur JP: ${jpShapes.length} linjer`);
    }
  } catch (e) {
    console.warn('[RuterLive] Flybuss JP-oppdatering:', e.message);
  }
}
