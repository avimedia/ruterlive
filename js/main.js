import { initMap, getMap } from './map.js';
import { connectVehicles } from './api.js';
import { fetchEstimatedVehicles } from './et-api.js';
import { fetchLineRouteFromJp } from './jp-line-lookup.js';
import { updateMarkers, applyFilter, getVehicleCounts, refreshMarkerIcons } from './markers.js';
import { initLayers, getVisibleModes, updateVehicleCount } from './layers.js';
import { updateRouteLines } from './routes.js';

let graphqlVehicles = [];
let etVehicles = [];
let routeShapes = [];
let etLoaded = false;
let selectedVehicleForRoute = null;

const jpLineResults = new Map(); // "line|dest" -> { from, to, via }

function getJpLineKey(lineCode, dest) {
  return `${(lineCode || '').toUpperCase()}|${(dest || '').toLowerCase().slice(0, 40)}`;
}

function enrichVehicleWithRouteShape(vehicle, shapes) {
  if (vehicle.from != null && vehicle.to != null) return vehicle;
  const line = vehicle.line?.publicCode || '';
  const dest = (vehicle.destinationName || '').toLowerCase();
  const mode = (vehicle.mode || '').toLowerCase();

  const jpKey = getJpLineKey(line, vehicle.destinationName);
  const jpResult = jpLineResults.get(jpKey);
  if (jpResult) {
    return { ...vehicle, from: jpResult.from, to: jpResult.to, via: jpResult.via ?? vehicle.via };
  }

  if (shapes?.length) {
    const match =
      shapes.find((s) => {
        const sLine = (s.line || '').toString();
        const sTo = (s.to || '').toLowerCase();
        const sMode = (s.mode || '').toLowerCase();
        return sLine === line && (sMode === mode || !sMode) && (dest.includes(sTo) || sTo.includes(dest) || dest === '');
      }) ||
      shapes.find((s) => (s.line || '').toString() === line && ((s.mode || '').toLowerCase() === mode || !s.mode));
    if (match) {
      return { ...vehicle, from: vehicle.from ?? match.from, to: vehicle.to ?? match.to, via: vehicle.via ?? match.via };
    }
  }

  const isExternalLine = line?.toUpperCase().startsWith('FB'); // Flybuss m.m. utenfor RUT ET
  const needsJpLookup = isExternalLine && vehicle.destinationName && !jpLineResults.has(jpKey);
  if (needsJpLookup) {
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

function mergeAndUpdate() {
  const merged = [];
  const etByid = new Map(etVehicles.map((v) => [v.vehicleId, v]));
  for (const v of graphqlVehicles) {
    const et = etByid.get(v.vehicleId);
    const enhanced = et
      ? { ...v, from: v.from ?? et.from, to: v.to ?? et.to, via: v.via ?? et.via }
      : enrichVehicleWithRouteShape(v, routeShapes);
    merged.push(enhanced);
  }
  const seenIds = new Set(graphqlVehicles.map((v) => v.vehicleId));
  for (const v of etVehicles) {
    if (!seenIds.has(v.vehicleId)) {
      seenIds.add(v.vehicleId);
      merged.push(enrichVehicleWithRouteShape(v, routeShapes));
    }
  }
  const visibleModes = getVisibleModes();
  updateMarkers(merged, visibleModes, {
    onVehicleSelect: (v) => {
      selectedVehicleForRoute = v;
      updateRouteLines(routeShapes, visibleModes, v);
    },
    onVehicleDeselect: () => {
      selectedVehicleForRoute = null;
      updateRouteLines(routeShapes, visibleModes, null);
    },
    getSelectedVehicleId: () => selectedVehicleForRoute?.vehicleId,
  });
  updateVehicleCount(getVehicleCounts(merged), null, !etLoaded);
  updateRouteLines(routeShapes, visibleModes, selectedVehicleForRoute);
}

initMap();
const map = getMap();
if (map) {
  map.on('click', () => {
    if (selectedVehicleForRoute) {
      selectedVehicleForRoute = null;
      updateRouteLines(routeShapes, getVisibleModes(), null);
    }
  });
  map.on('zoomend', () => {
    updateRouteLines(routeShapes, getVisibleModes(), selectedVehicleForRoute);
    refreshMarkerIcons();
  });
}

initLayers((visibleModes) => {
  applyFilter(visibleModes);
  updateRouteLines(routeShapes, visibleModes, selectedVehicleForRoute);
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

function applyInitialData(data) {
  const vehicles = Array.isArray(data?.vehicles) ? data.vehicles : [];
  const shapes = Array.isArray(data?.routeShapes) ? data.routeShapes : [];
  graphqlVehicles = vehicles;
  etVehicles = [];
  routeShapes = mergeRouteShapes(shapes, routeShapes);
  etLoaded = true;
  mergeAndUpdate();
}

async function fetchInitialData(attempt = 0) {
  try {
    const res = await fetch('/api/initial-data');
    if ((res.status === 502 || res.status === 503) && attempt < RETRY_DELAYS.length) {
      await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
      return fetchInitialData(attempt + 1);
    }
    if (res.ok) {
      const data = await res.json();
      applyInitialData(data);
      return true;
    }
  } catch (err) {
    if (import.meta.env.DEV) console.warn('[RuterLive] initial-data:', err.message);
  }
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
fetchInitialData().then((ok) => {
  if (ok) {
    setInterval(() => fetchInitialData(), POLL_MS);
  } else {
    loadRouteShapes();
    connectVehicles(null, (vehicles) => {
      if (Array.isArray(vehicles)) {
        graphqlVehicles = vehicles;
        mergeAndUpdate();
      }
    }, (error) => {
      const merged = graphqlVehicles.length
        ? [...graphqlVehicles, ...etVehicles.filter((v) => !graphqlVehicles.some((g) => g.vehicleId === v.vehicleId))]
        : etVehicles;
      updateVehicleCount(getVehicleCounts(merged), error, !etLoaded);
    });
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
    pollEt();
    setInterval(pollEt, POLL_MS);
  }
});
