import { runWhenVisible } from './visibility.js';
import { initMap, getMap } from './map.js';
import { initTheme } from './theme.js';
import { initStopSearch } from './search.js';
import { connectVehicles } from './api.js';
import { fetchEstimatedVehicles } from './et-api.js';
import { createFeedPolicy, shouldFallBackToLegacy } from './feed-policy.js';
import { fetchLineRouteFromJp } from './jp-line-lookup.js';
import { decodeVehiclePath } from '../shared/vehicle-path.js';
import { matchRouteForVehicle } from '../shared/route-match.js';
import { updateMarkers, applyFilter, getVehicleCounts, refreshMarkerIcons, onMarkerTick, getMarkerLatLng } from './markers.js';
import { initLayers, getVisibleModes, updateVehicleCount, setRetryHandler } from './layers.js';
import { updateRouteLines, updateSelectedVehicleSplit } from './routes.js';
import {
  initShareLink,
  initLoadingIndicator,
  initTipToast,
  initKeyboardNav,
  initPwa,
  applyUrlParams,
  getLoadingIndicator,
} from './ux.js';

let graphqlVehicles = [];
let etVehicles = [];
let routeShapes = [];
let etLoaded = false;
let selectedVehicleForRoute = null;
let liveFeedActive = false; // /api/vehicles-live virker

const jpLineResults = new Map(); // "line|dest" -> { from, to, via }

function getJpLineKey(lineCode, dest) {
  return `${(lineCode || '').toUpperCase()}|${(dest || '').toLowerCase().slice(0, 40)}`;
}

function enrichVehicleWithRouteShape(vehicle, shapes) {
  if (vehicle.from != null && vehicle.to != null) return vehicle;
  const line = vehicle.line?.publicCode || '';
  const mode = (vehicle.mode || '').toLowerCase();

  const jpKey = getJpLineKey(line, vehicle.destinationName);
  const jpResult = jpLineResults.get(jpKey);
  if (jpResult) {
    return { ...vehicle, from: jpResult.from, to: jpResult.to, via: jpResult.via ?? vehicle.via };
  }

  const match = matchRouteForVehicle(vehicle, shapes);
  if (match) {
    return { ...vehicle, from: vehicle.from ?? match.from, to: vehicle.to ?? match.to, via: vehicle.via ?? match.via };
  }

  // Ny feed: serveren har allerede slått opp fra/til fra rutekartene; ingen JP-søk fra nettleseren
  if (liveFeedActive) return vehicle;
  const isRail = mode === 'rail' || mode === 'flytog';
  const isExternalLine = line?.toUpperCase().startsWith('FB');
  const needsJpLookup =
    vehicle.destinationName &&
    !jpLineResults.has(jpKey) &&
    (isExternalLine || (isRail && (!vehicle.from || !vehicle.to)));
  if (needsJpLookup) {
    jpLineResults.set(jpKey, null); // pågår/feilet: ikke nytt søk ved hver oppdatering
    const lat = vehicle.location?.latitude;
    const lon = vehicle.location?.longitude;
    fetchLineRouteFromJp(line, vehicle.destinationName, { lat, lon }).then((result) => {
      if (result) {
        jpLineResults.set(jpKey, result);
        mergeAndUpdate();
      }
    });
  }
  return vehicle;
}

/** Kjøretøyet med posisjonen markøren faktisk vises på (beveger seg mellom pollingene). */
function withShownLocation(v) {
  const ll = v && getMarkerLatLng(v.vehicleId);
  return ll ? { ...v, location: { latitude: ll.lat, longitude: ll.lng } } : v;
}

let lastSplitLatLng = null;
function followSelectedVehicle() {
  if (!selectedVehicleForRoute) return;
  const ll = getMarkerLatLng(selectedVehicleForRoute.vehicleId);
  if (!ll || (lastSplitLatLng && lastSplitLatLng.lat === ll.lat && lastSplitLatLng.lng === ll.lng)) return;
  lastSplitLatLng = { lat: ll.lat, lng: ll.lng };
  updateSelectedVehicleSplit({ location: { latitude: ll.lat, longitude: ll.lng } });
}
onMarkerTick(followSelectedVehicle);

function mergeAndUpdate() {
  const merged = [];
  const etByid = new Map(etVehicles.map((v) => [v.vehicleId, v]));
  for (const v of graphqlVehicles) {
    const et = etByid.get(v.vehicleId);
    const enhanced = et
      ? { ...v, from: v.from ?? et.from, to: v.to ?? et.to, nextStop: v.nextStop ?? et.nextStop, via: v.via ?? et.via }
      : enrichVehicleWithRouteShape(v, routeShapes);
    merged.push(enhanced);
  }
  const seenIds = new Set(graphqlVehicles.map((v) => v.vehicleId));
  for (const v of etVehicles) {
    if (!seenIds.has(v.vehicleId)) {
      seenIds.add(v.vehicleId);
      merged.push({ ...enrichVehicleWithRouteShape(v, routeShapes), nextStop: v.nextStop });
    }
  }
  const visibleModes = getVisibleModes();
  updateMarkers(merged, visibleModes, {
    onVehicleSelect: (v) => {
      selectedVehicleForRoute = v;
      lastSplitLatLng = null;
      updateRouteLines(routeShapes, getVisibleModes(), withShownLocation(v));
    },
    onVehicleDeselect: () => {
      selectedVehicleForRoute = null;
      updateRouteLines(routeShapes, getVisibleModes(), null);
    },
    getSelectedVehicleId: () => selectedVehicleForRoute?.vehicleId,
  });
  updateVehicleCount(getVehicleCounts(merged), null, !etLoaded);
  updateRouteLines(routeShapes, visibleModes, withShownLocation(selectedVehicleForRoute));
  if (selectedVehicleForRoute) {
    const fresh = merged.find((v) => v.vehicleId === selectedVehicleForRoute.vehicleId);
    if (fresh) {
      selectedVehicleForRoute = fresh;
      lastSplitLatLng = null;
      followSelectedVehicle();
    }
  }
}

initMap();
initTheme();
initStopSearch();
initShareLink();
initLoadingIndicator();
initTipToast();
initKeyboardNav();
initPwa();
applyUrlParams();
const map = getMap();
if (map) {
  map.on('click', () => {
    if (selectedVehicleForRoute) {
      selectedVehicleForRoute = null;
      updateRouteLines(routeShapes, getVisibleModes(), null);
    }
  });
  map.on('zoomend', () => {
    updateRouteLines(routeShapes, getVisibleModes(), withShownLocation(selectedVehicleForRoute));
    refreshMarkerIcons();
  });
  map.on('moveend', () => {
    updateRouteLines(routeShapes, getVisibleModes(), withShownLocation(selectedVehicleForRoute));
  });
}

initLayers((visibleModes) => {
  applyFilter(visibleModes);
  updateRouteLines(routeShapes, visibleModes, withShownLocation(selectedVehicleForRoute));
});

updateVehicleCount(null, null, true);

const POLL_MS = 30000;
const RETRY_DELAYS = [2000, 4000, 8000, 12000];

function shapeKey(s) {
  return `${(s.mode || '').toLowerCase()}|${(s.line || '').toString()}|${(s.from || '')}|${(s.to || '')}`;
}

function mergeRouteShapes(newShapes, existingShapes) {
  const byKey = new Map();
  for (const s of existingShapes ?? []) byKey.set(shapeKey(s), s);
  for (const s of newShapes ?? []) {
    const k = shapeKey(s);
    const existing = byKey.get(k);
    const ptsNew = s.points?.length ?? 0;
    const ptsOld = existing?.points?.length ?? 0;
    if (!existing || ptsNew >= ptsOld) byKey.set(k, s);
  }
  return [...byKey.values()];
}

const hasRailShapes = (shapes) =>
  shapes.some((s) => (s.mode || '').toLowerCase() === 'rail' || (s.mode || '').toLowerCase() === 'flytog');

function addShapes(more) {
  if (Array.isArray(more) && more.length > 0) {
    routeShapes = mergeRouteShapes(more, routeShapes);
    mergeAndUpdate();
  }
}

let staticShapesRequested = false;
/**
 * Jernbane/flybuss kan mangle ved kald serverstart. Én gang per sidevisning:
 * ny feed henter bare /api/rail-shapes når jernbane mangler (route-shapes-all har resten),
 * gammel feed henter statiske rutekart og prøver jernbane på nytt.
 */
function requestStaticShapes(shapes, live) {
  if (staticShapesRequested) return;
  staticShapesRequested = true;
  const fetchJson = (url) => fetch(url).then((r) => (r.ok ? r.json() : [])).catch(() => []);
  const railMissing = !hasRailShapes(shapes);
  if (live) {
    if (!railMissing) return;
    [2000, 8000, 25000].forEach((delay) => {
      setTimeout(runWhenVisible(() => {
        if (!hasRailShapes(routeShapes)) fetchJson('/api/rail-shapes').then(addShapes);
      }), delay);
    });
    return;
  }
  const tryStaticNetworkShapes = () => fetchJson('/api/static-network-shapes').then(addShapes);
  tryStaticNetworkShapes();
  const retryStatic = runWhenVisible(tryStaticNetworkShapes);
  setTimeout(retryStatic, 8000);
  setTimeout(retryStatic, 25000);
  if (!railMissing) return;
  [2000, 8000, 25000].forEach((delay) => {
    setTimeout(runWhenVisible(() => {
      if (hasRailShapes(routeShapes)) return;
      Promise.all([fetchJson('/api/rail-shapes'), fetchJson('/api/route-shapes')]).then(([rail, route]) => {
        addShapes(Array.isArray(rail) && rail.length > 0 ? rail : route);
      });
    }), delay);
  });
}

function applyInitialData(data, { live = false } = {}) {
  const vehicles = Array.isArray(data?.vehicles) ? data.vehicles : [];
  const shapes = Array.isArray(data?.routeShapes) ? data.routeShapes : [];
  liveFeedActive = live;
  graphqlVehicles = vehicles;
  etVehicles = [];
  routeShapes = mergeRouteShapes(shapes, routeShapes);
  etLoaded = true;
  mergeAndUpdate();
  requestStaticShapes(shapes, live);
}

let loadedShapesVersion = null;
const feedPolicy = createFeedPolicy();

async function fetchShapesFor(version) {
  const res = await fetch(`/api/route-shapes-all?v=${encodeURIComponent(version)}`);
  if (!res.ok) throw new Error(`route-shapes-all ${res.status}`);
  const shapes = await res.json();
  return Array.isArray(shapes) ? shapes : [];
}

/** Kompakte path-er (sekunder relativt til t0) → ms-path-er som markers.js bruker. */
function decodeLivePaths(data) {
  const vehicles = Array.isArray(data?.vehicles) ? data.vehicles : [];
  const t0 = data?.t0;
  if (!Number.isFinite(t0)) return vehicles;
  for (const v of vehicles) {
    if (Array.isArray(v.path)) v.path = decodeVehiclePath(v.path, t0);
  }
  return vehicles;
}

/** Ny feed: bare kjøretøy hvert 30. s, rutekart hentes først og deretter bare ved ny versjon. */
async function fetchVehiclesLive() {
  const res = await fetch('/api/vehicles-live');
  if (!res.ok) throw Object.assign(new Error(`vehicles-live ${res.status}`), { status: res.status });
  const data = await res.json();
  const vehicles = decodeLivePaths(data);
  const version = data?.shapesVersion;
  if (!version) throw new Error('vehicles-live uten shapesVersion');
  if (loadedShapesVersion === null) {
    const shapes = await fetchShapesFor(version);
    loadedShapesVersion = version;
    applyInitialData({ vehicles, routeShapes: shapes }, { live: true });
    return;
  }
  if (version !== loadedShapesVersion) {
    try {
      const shapes = await fetchShapesFor(version);
      routeShapes = mergeRouteShapes(shapes, routeShapes);
      loadedShapesVersion = version;
    } catch (_) { /* prøver igjen ved neste poll */ }
  }
  liveFeedActive = true;
  graphqlVehicles = vehicles;
  mergeAndUpdate();
}

async function fetchInitialData(attempt = 0) {
  const loading = getLoadingIndicator();
  if (attempt === 0) loading?.show('Henter kjøretøy…');
  try {
    if (feedPolicy.shouldTryLive()) {
      try {
        await fetchVehiclesLive();
        feedPolicy.recordSuccess();
        loading?.hide();
        return true;
      } catch (err) {
        if (loadedShapesVersion !== null && !shouldFallBackToLegacy(err)) {
          // Allerede i gang og serverfeil: behold gamle data, prøv igjen ved neste poll
          loading?.hide();
          return false;
        }
        if ((err.status === 502 || err.status === 503) && attempt < RETRY_DELAYS.length) {
          await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
          return fetchInitialData(attempt + 1);
        }
        if (import.meta.env.DEV) console.warn('[RuterLive] vehicles-live:', err.message);
        // Gammel feed for denne pollen; ny feed prøves igjen hver 3. poll
        feedPolicy.recordFailure();
      }
    }
    const res = await fetch('/api/initial-data');
    if ((res.status === 502 || res.status === 503) && attempt < RETRY_DELAYS.length) {
      await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
      return fetchInitialData(attempt + 1);
    }
    if (res.ok) {
      const data = await res.json();
      applyInitialData(data);
      loading?.hide();
      return true;
    }
  } catch (err) {
    if (import.meta.env.DEV) console.warn('[RuterLive] initial-data:', err.message);
  }
  loading?.hide();
  return false;
}

function loadRouteShapes(attempt = 0) {
  fetch('/api/route-shapes')
    .then((r) => {
      if ((r.status === 502 || r.status === 503) && attempt < RETRY_DELAYS.length) {
        setTimeout(() => loadRouteShapes(attempt + 1), RETRY_DELAYS[attempt]);
        throw { _retryScheduled: true };
      }
      return r.ok ? r.json() : [];
    })
    .then((shapes) => {
      if (Array.isArray(shapes) && shapes.length > 0) {
        routeShapes = mergeRouteShapes(routeShapes, shapes);
      }
      etLoaded = true;
      mergeAndUpdate();
    })
    .catch((err) => {
      if (err?._retryScheduled) return;
      if (attempt < RETRY_DELAYS.length) {
        setTimeout(() => loadRouteShapes(attempt + 1), RETRY_DELAYS[attempt]);
      } else {
        etLoaded = true;
        mergeAndUpdate();
      }
    });
}
function onVehiclesSuccess(vehicles) {
  if (Array.isArray(vehicles)) {
    graphqlVehicles = vehicles;
    mergeAndUpdate();
  }
  getLoadingIndicator()?.hide();
}

function onVehiclesError(error) {
  getLoadingIndicator()?.hide();
  const merged = graphqlVehicles.length
    ? [...graphqlVehicles, ...etVehicles.filter((v) => !graphqlVehicles.some((g) => g.vehicleId === v.vehicleId))]
    : etVehicles;
  updateVehicleCount(getVehicleCounts(merged), error, !etLoaded);
}

function retryDataFetch() {
  getLoadingIndicator()?.show('Prøver igjen…');
  connectVehicles(null, onVehiclesSuccess, onVehiclesError);
}

fetchInitialData().then((ok) => {
  if (ok) {
    setInterval(runWhenVisible(() => fetchInitialData()), POLL_MS);
  } else {
    setRetryHandler(retryDataFetch);
    getLoadingIndicator()?.show('Prøver igjen…');
    loadRouteShapes();
    connectVehicles(null, onVehiclesSuccess, onVehiclesError);
    async function pollEt() {
      try {
        const result = await fetchEstimatedVehicles();
        const vehicles = result.vehicles ?? result;
        const etShapes = result.routeShapes ?? [];
        if (Array.isArray(vehicles)) etVehicles = vehicles;
        if (Array.isArray(etShapes) && etShapes.length > 0) {
          routeShapes = mergeRouteShapes(etShapes, routeShapes);
        }
        etLoaded = true;
        mergeAndUpdate();
      } catch (_) {
        etLoaded = true;
        mergeAndUpdate();
      }
    }
    // /api/et-cached er fjernet i prod: der brukes bare GPS-fallback (js/api.js)
    if (import.meta.env.DEV) {
      pollEt();
      setInterval(runWhenVisible(pollEt), POLL_MS);
    } else {
      etLoaded = true;
      mergeAndUpdate();
    }
  }
});
