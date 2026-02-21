import L from 'leaflet';
import { getMap } from './map.js';

const MODE_TO_CLASS = {
  bus: 'bus',
  flybuss: 'flybuss',
  metro: 'metro',
  tram: 'tram',
  water: 'water',
  rail: 'rail',
  flytog: 'flytog',
  ferry: 'water',
};

function normalizeMode(vehicle) {
  const m = (typeof vehicle === 'object' ? vehicle?.mode : vehicle)?.toLowerCase();
  let base = MODE_TO_CLASS[m] || m || 'bus';
  if (base === 'bus' && vehicle?.line?.publicCode?.toUpperCase?.().startsWith('FB')) return 'flybuss';
  // Flytoget: F1, F2, FX (Gardermoen-ekspressen)
  if (base === 'rail') {
    const code = (vehicle?.line?.publicCode || '').toUpperCase();
    const dest = (vehicle?.destinationName || '').toLowerCase();
    if (/^F\d*$|^FX$/.test(code) || dest.includes('lufthavn') || dest.includes('gardermoen')) return 'flytog';
  }
  return base;
}

const vehicleMarkers = new Map();
const markerAnimations = new Map(); // vehicleId -> { rafId }
let lastVehicles = [];
let lastVisibleModes = new Set();

const ANIM_DURATION_MS = 8000; // Glatt bevegelse mellom oppdateringer
const ANIM_SKIP_THRESHOLD_KM = 2; // Ved sprang > 2 km: sett posisjon direkte (unngår «flyvende» flybuss m.m.)

/** Zoom-nivå før linjenummer vises på kjøretøymerkene. */
const ZOOM_LINE_VISIBLE = 14;

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function createIcon(mode, lineCode = '', showLine = false) {
  const cls = normalizeMode(mode);
  const line = (lineCode || '').toString().trim() || '?';
  const show = showLine && line;
  return L.divIcon({
    className: 'vehicle-marker ' + cls + (show ? ' vehicle-marker-with-label' : ''),
    html: show ? `<span class="vehicle-line-num">${escapeHtml(line)}</span>` : undefined,
    iconSize: show ? [28, 28] : [14, 14],
    iconAnchor: show ? [14, 14] : [7, 7],
  });
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function animateMarkerTo(marker, targetLat, targetLon, vehicleId) {
  if (markerAnimations.has(vehicleId)) {
    cancelAnimationFrame(markerAnimations.get(vehicleId));
    markerAnimations.delete(vehicleId);
  }
  const start = performance.now();
  const from = marker.getLatLng();

  function tick(now) {
    const elapsed = now - start;
    const t = Math.min(elapsed / ANIM_DURATION_MS, 1);
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // ease-in-out
    const lat = from.lat + (targetLat - from.lat) * eased;
    const lng = from.lng + (targetLon - from.lng) * eased;
    marker.setLatLng([lat, lng]);
    if (t < 1) {
      const rafId = requestAnimationFrame(tick);
      markerAnimations.set(vehicleId, rafId);
    } else {
      markerAnimations.delete(vehicleId);
    }
  }
  requestAnimationFrame(tick);
}

function shouldShowLineOnMarker() {
  const map = getMap();
  return map ? map.getZoom() >= ZOOM_LINE_VISIBLE : false;
}

export function updateMarkers(vehicles, visibleModes, opts = {}) {
  const map = getMap();
  if (!map) return;
  const { onVehicleSelect, onVehicleDeselect, getSelectedVehicleId } = opts;

  lastVehicles = vehicles;
  lastVisibleModes = new Set(visibleModes);

  const vehicleIds = new Set(vehicles.map((v) => v.vehicleId));
  const showLine = shouldShowLineOnMarker();

  // Remove markers for vehicles no longer in data
  for (const [id, marker] of vehicleMarkers) {
    if (!vehicleIds.has(id)) {
      if (markerAnimations.has(id)) {
        cancelAnimationFrame(markerAnimations.get(id));
        markerAnimations.delete(id);
      }
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
    const popupParts = [`<strong>Linje ${lineCode}</strong>`];
    if (v.from) popupParts.push(`Fra: ${v.from}`);
    if (v.to) popupParts.push(`Til: ${v.to}`);
    else if (dest) popupParts.push(`Til: ${dest}`);
    if (v.via) popupParts.push(`Via: ${v.via}`);
    const popupHtml = popupParts.join('<br>');

    let marker = vehicleMarkers.get(v.vehicleId);
    if (marker) {
      const cur = marker.getLatLng();
      const moved = Math.abs(cur.lat - lat) > 1e-6 || Math.abs(cur.lng - lon) > 1e-6;
      if (moved) {
        const distKm = haversineKm(cur.lat, cur.lng, lat, lon);
        if (distKm > ANIM_SKIP_THRESHOLD_KM) {
          if (markerAnimations.has(v.vehicleId)) {
            cancelAnimationFrame(markerAnimations.get(v.vehicleId));
            markerAnimations.delete(v.vehicleId);
          }
          marker.setLatLng([lat, lon]);
        } else {
          animateMarkerTo(marker, lat, lon, v.vehicleId);
        }
      }
      marker.setIcon(createIcon(mode, lineCode, showLine));
      marker.getTooltip()?.setContent(title);
      marker.bindPopup(popupHtml, { className: 'vehicle-popup' });
    } else {
      marker = L.marker([lat, lon], {
        icon: createIcon(mode, lineCode, showLine),
      })
        .bindTooltip(title, {
          permanent: false,
          direction: 'top',
          offset: [0, -8],
        });
      marker.bindPopup(popupHtml, { className: 'vehicle-popup' });
      marker.addTo(map);
      vehicleMarkers.set(v.vehicleId, marker);
    }
    if (onVehicleSelect) {
      marker.off('popupopen popupclose');
      marker.on('popupopen', () => onVehicleSelect(v));
      marker.on('popupclose', () => {
        if (getSelectedVehicleId?.() === v.vehicleId) onVehicleDeselect?.();
      });
    }
  }
}

export function applyFilter(visibleModes) {
  const map = getMap();
  if (!map) return;

  lastVisibleModes = new Set(visibleModes);
  const showLine = shouldShowLineOnMarker();

  for (const v of lastVehicles) {
    const mode = normalizeMode(v);
    const marker = vehicleMarkers.get(v.vehicleId);
    if (!marker) continue;

    if (visibleModes.has(mode)) {
      if (!map.hasLayer(marker)) {
        marker.addTo(map);
      }
      const lineCode = v.line?.publicCode || '?';
      marker.setIcon(createIcon(mode, lineCode, showLine));
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

/** Oppdaterer ikoner på alle kjøretøymarkører ved zoom-endring (viser/skjuler linjenummer). */
export function refreshMarkerIcons() {
  const map = getMap();
  if (!map) return;
  const showLine = shouldShowLineOnMarker();
  for (const v of lastVehicles) {
    const mode = normalizeMode(v);
    if (!lastVisibleModes.has(mode)) continue;
    const marker = vehicleMarkers.get(v.vehicleId);
    if (marker && map.hasLayer(marker)) {
      const lineCode = v.line?.publicCode || '?';
      marker.setIcon(createIcon(mode, lineCode, showLine));
    }
  }
}

export function getVehicleCounts(vehicles) {
  const rail = countByMode(vehicles, 'rail');
  const flytog = countByMode(vehicles, 'flytog');
  return {
    bus: countByMode(vehicles, 'bus'),
    flybuss: countByMode(vehicles, 'flybuss'),
    metro: countByMode(vehicles, 'metro'),
    tram: countByMode(vehicles, 'tram'),
    water: countByMode(vehicles, 'water'),
    rail,
    flytog,
    total: vehicles.length,
  };
}
