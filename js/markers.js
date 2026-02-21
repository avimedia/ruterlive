import L from 'leaflet';
import { getMap } from './map.js';

const MODE_TO_CLASS = {
  bus: 'bus',
  flybuss: 'flybuss',
  metro: 'metro',
  tram: 'tram',
  water: 'water',
  rail: 'rail',
  ferry: 'water', // API returns FERRY for båt
};

function normalizeMode(vehicle) {
  const m = (typeof vehicle === 'object' ? vehicle?.mode : vehicle)?.toLowerCase();
  const base = MODE_TO_CLASS[m] || m || 'bus';
  // Flybuss: linjer FB1, FB2, FB3 etc. (fra NBU/FLI i GraphQL)
  if (base === 'bus' && vehicle?.line?.publicCode?.toUpperCase?.().startsWith('FB')) {
    return 'flybuss';
  }
  return base;
}

const vehicleMarkers = new Map();
let lastVehicles = [];
let lastVisibleModes = new Set();

function createIcon(mode) {
  const cls = normalizeMode(mode);
  return L.divIcon({
    className: 'vehicle-marker ' + cls,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

export function updateMarkers(vehicles, visibleModes) {
  const map = getMap();
  if (!map) return;

  lastVehicles = vehicles;
  lastVisibleModes = new Set(visibleModes);

  const vehicleIds = new Set(vehicles.map((v) => v.vehicleId));

  // Remove markers for vehicles no longer in data
  for (const [id, marker] of vehicleMarkers) {
    if (!vehicleIds.has(id)) {
      map.removeLayer(marker);
      vehicleMarkers.delete(id);
    }
  }

  // Add or update markers
  for (const v of vehicles) {
    const mode = normalizeMode(v);
    if (!visibleModes.has(mode)) continue;

    const lat = v.location?.latitude;
    const lon = v.location?.longitude;
    if (lat == null || lon == null) continue;

    const lineCode = v.line?.publicCode || '?';
    const dest = v.destinationName || '';
    const title = `${lineCode} → ${dest}`.trim();

    let marker = vehicleMarkers.get(v.vehicleId);
    if (marker) {
      marker.setLatLng([lat, lon]);
      marker.setIcon(createIcon(mode));
      marker.getTooltip()?.setContent(title);
    } else {
      marker = L.marker([lat, lon], {
        icon: createIcon(mode),
      })
        .bindTooltip(title, {
          permanent: false,
          direction: 'top',
          offset: [0, -8],
        })
        .addTo(map);
      vehicleMarkers.set(v.vehicleId, marker);
    }
  }
}

export function applyFilter(visibleModes) {
  const map = getMap();
  if (!map) return;

  lastVisibleModes = new Set(visibleModes);

  for (const v of lastVehicles) {
    const mode = normalizeMode(v);
    const marker = vehicleMarkers.get(v.vehicleId);
    if (!marker) continue;

    if (visibleModes.has(mode)) {
      if (!map.hasLayer(marker)) {
        marker.addTo(map);
      }
      marker.setIcon(createIcon(mode));
    } else {
      if (map.hasLayer(marker)) {
        map.removeLayer(marker);
      }
    }
  }
}

function countByMode(vehicles, filterMode) {
  return vehicles.filter((v) => normalizeMode(v) === filterMode).length;
}

export function getVehicleCounts(vehicles) {
  return {
    bus: countByMode(vehicles, 'bus'),
    flybuss: countByMode(vehicles, 'flybuss'),
    metro: countByMode(vehicles, 'metro'),
    tram: countByMode(vehicles, 'tram'),
    water: countByMode(vehicles, 'water'),
    rail: countByMode(vehicles, 'rail'),
    total: vehicles.length,
  };
}
