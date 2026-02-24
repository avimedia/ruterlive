import L from 'leaflet';
import { getMap } from './map.js';

const MODE_COLORS = {
  bus: '#e63946',
  flybuss: '#ff6b35',
  metro: '#2a9d8f',
  tram: '#e9c46a',
  water: '#457b9d',
  rail: '#9b59b6',
  flytog: '#e056fd',
};

const SHADE_STEPS = 5; // Antall toner per transporttype

function hexToRgb(hex) {
  const m = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [128, 128, 128];
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('');
}

function getShapeColor(mode, lineOrFrom) {
  const base = MODE_COLORS[mode] || '#888';
  const [r, g, b] = hexToRgb(base);
  const hash = (lineOrFrom || '').split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0);
  const step = Math.abs(hash % SHADE_STEPS);
  const factor = 0.7 + (step / (SHADE_STEPS - 1)) * 0.6;
  return rgbToHex(r * factor, g * factor, b * factor);
}

let routeLayers = [];
let selectedPolyline = null;
let routesVisible = true;
let lastRenderedShapesKey = '';
let lastRenderedModesKey = '';
let lastSelectedVehicleKey = '';
let lastRenderedStopsKey = '';
let lastRenderedBboxKey = '';
let bboxFetchId = 0;

/** Zoom-nivå før holdeplasser vises (med navn). */
const ZOOM_STOPS_VISIBLE = 15;

function shapeModeForFilter(shape) {
  const m = (shape.mode || '').toLowerCase();
  if (m === 'coach') return 'flybuss';
  return m || 'bus';
}

/** T-bane, trikk, regiontog og flytoget vises alltid. Buss, flybuss og båt kun ved valgt kjøretøy. */
const ALWAYS_SHOWN_MODES = new Set(['metro', 'tram', 'rail', 'flytog']);
const VEHICLE_CLICK_MODES = new Set(['bus', 'water', 'flybuss']);

function vehicleMode(vehicle) {
  const m = (vehicle?.mode || '').toLowerCase();
  if (m === 'rail' && /^F\d*$|^FX$/.test((vehicle?.line?.publicCode || ''))) return 'flytog';
  if ((m === 'bus' || m === 'coach') && (vehicle?.line?.publicCode || '').toUpperCase().startsWith('FB'))
    return 'flybuss';
  return m || 'bus';
}

function normalizeLine(s) {
  return (s || '').toString().replace(/^0+/, '') || '0';
}

function destMatchesNorm(dest, toName) {
  if (!dest) return true;
  const d = dest.replace(/\s+/g, ' ').trim();
  const t = (toName || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!t) return true;
  if (d.includes('gardermoen') || d.includes('lufthavn') || d.includes('osl'))
    return t.includes('lufthavn') || t.includes('gardermoen') || t.includes('osl');
  if (d.includes('oslo') && !d.includes('lufthavn'))
    return t.includes('oslo') && !t.includes('lufthavn');
  return d.includes(t) || t.includes(d);
}

function lineMatchesForMode(shapeLine, vehicleLine, mode) {
  const s = normalizeLine(shapeLine || '');
  const v = normalizeLine(vehicleLine || '');
  if (s === v) return true;
  if (mode === 'flybuss' && (s === 'FB' || s === '') && /^FB\d*$/i.test(v)) return true;
  return false;
}

function shapeMatchesVehicle(shape, vehicle) {
  if (!vehicle) return false;
  const mode = vehicleMode(vehicle);
  if (!lineMatchesForMode(shape.line, vehicle.line?.publicCode, mode)) return false;
  const sMode = (shape.mode || '').toLowerCase();
  if (sMode !== mode) return false;
  const dest = (vehicle.destinationName || '').toLowerCase();
  const sTo = shape.to || '';
  if (dest && sTo && !destMatchesNorm(dest, sTo)) return false;
  return true;
}

export function updateRouteLines(shapes, visibleModes, selectedVehicle = null) {
  const map = getMap();
  if (!map || !map.routeLayerGroup) return;

  const selectedKey = selectedVehicle ? `${selectedVehicle.vehicleId}-${selectedVehicle.line?.publicCode}` : '';
  const prevSelectedKey = lastSelectedVehicleKey;
  const shapesKey = shapes?.length ? `${shapes.length}-${shapes.slice(0, 5).map((s) => s.line + s.from).join('|')}` : '0';
  const modesKey = [...(visibleModes || [])].sort().join(',');
  const mapZoom = map.getZoom();
  const stopsVisibleKey = mapZoom >= ZOOM_STOPS_VISIBLE ? '1' : '0';
  const b = map.getBounds();
  const bboxKey = mapZoom >= ZOOM_STOPS_VISIBLE ? `${b.getSouth().toFixed(2)},${b.getNorth().toFixed(2)},${b.getWest().toFixed(2)},${b.getEast().toFixed(2)}` : '';
  if (shapesKey === lastRenderedShapesKey && modesKey === lastRenderedModesKey && selectedKey === lastSelectedVehicleKey && stopsVisibleKey === lastRenderedStopsKey && bboxKey === lastRenderedBboxKey) {
    return;
  }
  lastRenderedBboxKey = bboxKey;
  lastRenderedShapesKey = shapesKey;
  lastRenderedModesKey = modesKey;
  lastSelectedVehicleKey = selectedKey;
  lastRenderedStopsKey = stopsVisibleKey;

  map.routeLayerGroup.clearLayers();
  if (map.stopsLayerGroup) map.stopsLayerGroup.clearLayers();
  routeLayers = [];
  selectedPolyline = null;

  if (import.meta.env.DEV) {
    console.debug('[RuterLive] updateRouteLines:', { routesVisible, shapesCount: shapes?.length ?? 0, selectedVehicle: !!selectedVehicle });
  }

  if (!routesVisible || !shapes?.length) {
    // Tegn likevel bbox-holdeplasser ved høy zoom
    if (map.getZoom() >= ZOOM_STOPS_VISIBLE) {
      addStopMarkers(map, [], visibleModes);
    }
    return;
  }

  // Inkluder valgt kjøretøys modus slik at flybuss/buss/båt-ruter vises ved klikk
  const effectiveModes = new Set(visibleModes);
  if (selectedVehicle && VEHICLE_CLICK_MODES.has(vehicleMode(selectedVehicle))) {
    effectiveModes.add(vehicleMode(selectedVehicle));
  }

  const shapesToShow = [];
  let vehicleClickFallbacks = [];
  const selectedMatches = [];
  for (const shape of shapes) {
    const mode = shapeModeForFilter(shape);
    if (!effectiveModes.has(mode)) continue;
    if (ALWAYS_SHOWN_MODES.has(mode)) {
      shapesToShow.push(shape);
      if (selectedVehicle && shapeMatchesVehicle(shape, selectedVehicle)) selectedMatches.push(shape);
    } else if (VEHICLE_CLICK_MODES.has(mode) && selectedVehicle) {
      if (shapeMatchesVehicle(shape, selectedVehicle)) {
        shapesToShow.push(shape);
        selectedMatches.push(shape);
      } else if (
        lineMatchesForMode(shape.line, selectedVehicle.line?.publicCode, mode) &&
        mode === vehicleMode(selectedVehicle) &&
        destMatchesNorm((selectedVehicle.destinationName || '').toLowerCase(), shape.to)
      ) {
        vehicleClickFallbacks.push(shape);
      }
    }
  }
  if (shapesToShow.length === 0 && vehicleClickFallbacks.length > 0) {
    shapesToShow.push(vehicleClickFallbacks[0]);
    selectedMatches.push(vehicleClickFallbacks[0]);
  } else if (selectedMatches.length === 0 && vehicleClickFallbacks.length > 0) {
    selectedMatches.push(vehicleClickFallbacks[0]);
  }

  const drawn = new Set();
  for (const shape of shapesToShow) {
    if (selectedMatches.includes(shape)) continue;
    addRoutePolyline(map, shape, drawn, false);
  }
  for (const shape of selectedMatches) {
    addRoutePolyline(map, shape, drawn, true);
  }

  // Holdeplasser: ved valgt kjøretøy kun rutens stopp (zoom 12+), ellers zoom 15+ med bbox
  const showStopsForSelection = selectedMatches.length > 0 && mapZoom >= 12;
  const showStopsForAll = mapZoom >= ZOOM_STOPS_VISIBLE;
  if (showStopsForSelection || showStopsForAll) {
    const shapesForStops = showStopsForSelection
      ? selectedMatches
      : (shapes ?? []).filter((s) => effectiveModes.has(shapeModeForFilter(s)));
    const onlyRouteStops = showStopsForSelection;
    addStopMarkers(map, shapesForStops, effectiveModes, onlyRouteStops);
  }

  // Ved nyvalgt kjøretøy: fit view til ruten for fornuftig zoom (ikke ved pan/zoom)
  if (selectedMatches.length > 0 && selectedKey !== prevSelectedKey) {
    const allPts = selectedMatches.flatMap((s) => [...(s.points ?? []), ...(s.quayStops ?? [])]);
    if (allPts.length >= 2) {
      const lats = allPts.map((p) => p[0]);
      const lons = allPts.map((p) => p[1]);
      const pad = 0.015;
      map.fitBounds([
        [Math.min(...lats) - pad, Math.min(...lons) - pad],
        [Math.max(...lats) + pad, Math.max(...lons) + pad],
      ], { maxZoom: 16, duration: 0.4 });
    }
  }
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function createStopMarker(lat, lon, quayId, name, color, stopsLayer) {
  const label = (name || 'Holdeplass').trim();
  const marker = L.marker([lat, lon], {
    icon: L.divIcon({
      className: 'stop-marker',
      html: `
        <span class="stop-marker-dot" style="background:${color}"></span>
        <span class="stop-marker-label">${escapeHtml(label)}</span>
      `,
      iconSize: [140, 24],
      iconAnchor: [5, 12],
    }),
    zIndexOffset: 1000,
  });
  marker._quayId = quayId;
  const popup = L.popup({ className: 'departure-board-popup', maxWidth: 460 });
  marker.bindPopup(popup, { autoClose: true, closeOnClick: true });
  marker.on('click', (e) => L.DomEvent.stopPropagation(e));
  marker.on('popupopen', () => {
    showDepartureBoard(marker.getPopup(), quayId);
  });
  marker.bindTooltip(`${label} · Klikk for avganger`, { permanent: false, direction: 'top', offset: [0, -8] });
  marker.addTo(stopsLayer);
}

function addStopMarkers(map, shapes, visibleModes, onlyRouteStops = false) {
  const seen = new Set();
  const pointKey = (lat, lon) => `${lat.toFixed(5)},${lon.toFixed(5)}`;
  const stopSources = [];
  const defaultColor = MODE_COLORS.bus;
  for (const shape of shapes) {
    const mode = shape.mode?.toLowerCase();
    const color = getShapeColor(mode, shape.line + (shape.from || ''));
    for (const pt of shape.points ?? []) {
      const lat = pt[0];
      const lon = pt[1];
      const quayId = pt[2];
      const name = pt[3];
      stopSources.push({ lat, lon, quayId, name, color });
    }
    for (const pt of shape.quayStops ?? []) {
      const lat = pt[0];
      const lon = pt[1];
      const quayId = pt[2];
      const name = pt[3];
      stopSources.push({ lat, lon, quayId, name, color });
    }
  }

  const stopsLayer = map.stopsLayerGroup || map.routeLayerGroup;

  for (const { lat, lon, quayId, name, color } of stopSources) {
    const key = pointKey(lat, lon);
    if (seen.has(key)) continue;
    seen.add(key);

    if (quayId) {
      createStopMarker(lat, lon, quayId, name, color, stopsLayer);
      seen.add(quayId);
    } else if (name) {
      const marker = L.marker([lat, lon], {
        icon: L.divIcon({
          className: 'stop-marker stop-marker-label-only',
          html: `
            <span class="stop-marker-dot" style="background:${color}"></span>
            <span class="stop-marker-label">${escapeHtml(name)}</span>
          `,
          iconSize: [140, 24],
          iconAnchor: [5, 12],
        }),
        zIndexOffset: 500,
      });
      marker.bindTooltip(escapeHtml(name), { permanent: false, direction: 'top', offset: [0, -8] });
      marker.addTo(stopsLayer);
    } else {
      const circle = L.circleMarker([lat, lon], {
        radius: 4,
        fillColor: color,
        color: 'rgba(255,255,255,0.8)',
        weight: 1,
        fillOpacity: 0.7,
        interactive: false,
      });
      circle.addTo(map.routeLayerGroup);
    }
  }

  // Ved valgt kjøretøy: kun rutens stopp – ikke hent alle holdeplasser i kartvisning
  if (onlyRouteStops) return;

  const bounds = map.getBounds();
  const minLat = bounds.getSouth();
  const maxLat = bounds.getNorth();
  const minLon = bounds.getWest();
  const maxLon = bounds.getEast();
  const thisFetchId = ++bboxFetchId;
  fetch(
    `/api/stops-in-bbox?minLat=${minLat}&maxLat=${maxLat}&minLon=${minLon}&maxLon=${maxLon}&limit=1500`
  )
    .then((r) => r.ok ? r.json() : [])
    .then((bboxStops) => {
      if (thisFetchId !== bboxFetchId) return;
      const defaultColor = MODE_COLORS.bus;
      for (const s of bboxStops || []) {
        if (seen.has(s.id)) continue;
        const key = pointKey(s.lat, s.lon);
        if (seen.has(key)) continue;
        seen.add(s.id);
        seen.add(key);
        createStopMarker(s.lat, s.lon, s.id, s.name, defaultColor, stopsLayer);
      }
    })
    .catch(() => {});
}

const MODE_COLORS_DEP = {
  bus: '#e63946',
  coach: '#ff6b35',
  flybuss: '#ff6b35',
  metro: '#2a9d8f',
  tram: '#e9c46a',
  ferry: '#457b9d',
  water: '#457b9d',
  rail: '#9b59b6',
  flytog: '#e056fd',
};

async function showDepartureBoard(popup, quayId) {
  popup.setContent('<div class="departure-loading">Henter avganger…</div>');

  try {
    const res = await fetch(`/api/departures?quayId=${encodeURIComponent(quayId)}`);
    const data = await res.json();
    const name = data?.name || 'Holdeplass';
    const allCalls = (data?.estimatedCalls ?? [])
      .map((c) => {
        const time = c.expectedDepartureTime || c.aimedDepartureTime || '';
        return { ...c, depTime: time ? new Date(time).getTime() : 0 };
      })
      .filter((c) => c.depTime > 0)
      .sort((a, b) => a.depTime - b.depTime);

    const MAX_PER_MODE = 3;
    const byMode = new Map();
    for (const c of allCalls) {
      const mode = (c.serviceJourney?.journeyPattern?.line?.transportMode || 'bus')?.toLowerCase();
      const list = byMode.get(mode) ?? [];
      if (list.length < MAX_PER_MODE) list.push(c);
      byMode.set(mode, list);
    }
    const calls = [...byMode.values()].flat().sort((a, b) => a.depTime - b.depTime).slice(0, 10);

    const now = Date.now();
    const rows = calls.map((c) => {
      const time = c.expectedDepartureTime || c.aimedDepartureTime;
      const dep = new Date(time).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' });
      const mins = Math.round((new Date(time).getTime() - now) / 60000);
      const minsText = mins < 0 ? 'nå' : mins <= 1 ? '1 min' : `${mins} min`;
      const line = c.serviceJourney?.journeyPattern?.line?.publicCode || '?';
      const mode = (c.serviceJourney?.journeyPattern?.line?.transportMode || 'bus')?.toLowerCase();
      const lineColor = MODE_COLORS_DEP[mode] || MODE_COLORS_DEP.bus;
      let dest = (c.destinationDisplay?.frontText || '').trim();
      if (dest.length > 38) dest = dest.slice(0, 36) + '…';
      const isDelayed =
        c.realtime &&
        c.expectedDepartureTime &&
        c.aimedDepartureTime &&
        new Date(c.expectedDepartureTime).getTime() > new Date(c.aimedDepartureTime).getTime() + 60000;
      const delayBadge = isDelayed ? ' <span class="departure-delayed">Forsinket</span>' : '';
      const realtime = c.realtime && !isDelayed ? ' <span class="departure-realtime">Sanntid</span>' : '';
      return `<tr><td class="departure-line" style="color:${lineColor}">${escapeHtml(line)}</td><td class="departure-dest">${escapeHtml(dest)}</td><td class="departure-time">${dep}</td><td class="departure-mins">${minsText}</td><td class="departure-badges">${realtime}${delayBadge}</td></tr>`;
    });
    const html = `
      <div class="departure-board">
        <h4 class="departure-stop-name">${escapeHtml(name)}</h4>
        <table class="departure-table">
          <thead><tr><th>Linje</th><th>Destinasjon</th><th>Kl</th><th></th><th></th></tr></thead>
          <tbody>${rows.join('')}</tbody>
        </table>
        ${calls.length === 0 ? '<p class="departure-empty">Ingen avganger de neste timene.</p>' : ''}
      </div>`;
    popup.setContent(html);
  } catch (err) {
    popup.setContent(
      `<div class="departure-error">Kunne ikke hente avganger. ${escapeHtml(String(err.message))}</div>`
    );
  }
}

function getRouteHighlightColor() {
  return getComputedStyle(document.documentElement).getPropertyValue('--route-highlight').trim() || '#fff';
}

function addRoutePolyline(map, shape, drawn, isHighlighted) {
  const key = `${shape.mode}|${shape.line}|${shape.from}|${shape.to}`;
  if (drawn.has(key)) return;
  drawn.add(key);

  const pts = shape.points;
  if (!Array.isArray(pts) || pts.length < 2) return;
  const latlngs = pts
    .map((p) => {
      if (Array.isArray(p)) return [Number(p[0]), Number(p[1])];
      if (p && typeof p.lat === 'number' && typeof p.lon === 'number') return [p.lat, p.lon];
      return null;
    })
    .filter((x) => x && !isNaN(x[0]) && !isNaN(x[1]));
  if (latlngs.length < 2) return;

  const mode = shape.mode?.toLowerCase();
  const color = getShapeColor(mode, shape.line + (shape.from || ''));
  const highlightColor = getRouteHighlightColor();
  const isRail = mode === 'rail' || mode === 'flytog';
  const polyline = L.polyline(latlngs, {
    color: isHighlighted ? highlightColor : color,
    weight: isHighlighted ? 3 : 2,
    opacity: isHighlighted ? 1 : 0.9,
    dashArray: isRail ? '6, 6' : undefined,
    className: 'route-line',
  });
  polyline._ruterOriginalColor = color;
  polyline._ruterIsRail = isRail;

  const lineRaw = shape.line || '?';
  const line = lineRaw.replace(/-\d+$/, ''); // OSM: fjern -id fra tooltip
  const from = (shape.from || '').trim() || '—';
  const to = (shape.to || '').trim() || '—';
  const via = (shape.via || '').trim();
  const samePlace = from !== '—' && to !== '—' && from.toLowerCase() === to.toLowerCase();
  const tooltipText =
    from === '—' && to === '—'
      ? line
      : samePlace && via
        ? `Linje ${line}: ${from} – ${via}`
        : samePlace
          ? `Linje ${line}: ${from}`
          : `Linje ${line}: ${from} → ${to}`;

  polyline.bindTooltip(tooltipText, { permanent: false, direction: 'top', opacity: 0.95 });
  polyline.on('click', (e) => {
    L.DomEvent.stopPropagation(e);
    if (selectedPolyline && selectedPolyline !== polyline) {
      const prev = selectedPolyline;
      prev.setStyle({
        weight: 2,
        opacity: 0.9,
        color: prev._ruterOriginalColor,
        dashArray: prev._ruterIsRail ? '6, 6' : undefined,
      });
    }
    selectedPolyline = polyline;
    polyline.setStyle({
      weight: 3,
      opacity: 1,
      color: getRouteHighlightColor(),
      dashArray: polyline._ruterIsRail ? '6, 6' : undefined,
    });
    polyline.bringToFront();
  });
  polyline.addTo(map.routeLayerGroup);
  routeLayers.push(polyline);
  if (isHighlighted) polyline.bringToFront();
}


/** Fokuser på holdeplass fra søk – flyr til, legger til marker og åpner avgangstavle. */
export function focusStopFromSearch(quayId, lat, lon, name) {
  const map = getMap();
  if (!map || !map.searchResultLayer || !map.stopsLayerGroup) return;
  map.searchResultLayer.clearLayers();
  const color = MODE_COLORS.bus;
  createStopMarker(lat, lon, quayId, name || 'Holdeplass', color, map.searchResultLayer);
  const layers = map.searchResultLayer.getLayers();
  const marker = layers[0];
  if (marker) {
    marker.openPopup();
    map.flyTo([lat, lon], 16, { duration: 0.5 });
  }
}

/** Oppdater farge på valgt rutelinje ved temaendring. */
export function refreshRouteHighlightTheme() {
  if (!selectedPolyline) return;
  selectedPolyline.setStyle({ color: getRouteHighlightColor() });
}

export function setRoutesVisible(visible) {
  routesVisible = visible;
}

export function isRoutesVisible() {
  return routesVisible;
}

export function clearRouteSelection() {
  if (selectedPolyline) {
    const p = selectedPolyline;
    p.setStyle({
      weight: 2,
      opacity: 0.9,
      color: p._ruterOriginalColor,
      dashArray: p._ruterIsRail ? '6, 6' : undefined,
    });
    selectedPolyline = null;
  }
}
