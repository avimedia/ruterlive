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

/** Zoom-nivå før holdeplasser vises som små sirkler. */
const ZOOM_STOPS_VISIBLE = 13;

/** T-bane, jernbane og trikk vises alltid. Buss, båt og flybuss kun ved klikk på kjøretøy. */
const ALWAYS_SHOWN_MODES = new Set(['metro', 'rail', 'flytog', 'tram']);
const VEHICLE_CLICK_MODES = new Set(['bus', 'water', 'flybuss']);

function vehicleMode(vehicle) {
  const m = (vehicle?.mode || '').toLowerCase();
  if (m === 'rail' && /^F\d*$|^FX$/.test((vehicle?.line?.publicCode || ''))) return 'flytog';
  if (m === 'bus' && (vehicle?.line?.publicCode || '').toUpperCase().startsWith('FB')) return 'flybuss';
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

function shapeMatchesVehicle(shape, vehicle) {
  if (!vehicle) return false;
  if (normalizeLine(shape.line) !== normalizeLine(vehicle.line?.publicCode)) return false;
  const mode = vehicleMode(vehicle);
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
  const shapesKey = shapes?.length ? `${shapes.length}-${shapes.slice(0, 5).map((s) => s.line + s.from).join('|')}` : '0';
  const modesKey = [...(visibleModes || [])].sort().join(',');
  const stopsVisibleKey = map.getZoom() >= ZOOM_STOPS_VISIBLE ? '1' : '0';
  if (shapesKey === lastRenderedShapesKey && modesKey === lastRenderedModesKey && selectedKey === lastSelectedVehicleKey && stopsVisibleKey === lastRenderedStopsKey) {
    return;
  }
  lastRenderedShapesKey = shapesKey;
  lastRenderedModesKey = modesKey;
  lastSelectedVehicleKey = selectedKey;
  lastRenderedStopsKey = stopsVisibleKey;

  map.routeLayerGroup.clearLayers();
  routeLayers = [];
  selectedPolyline = null;

  if (import.meta.env.DEV) {
    console.debug('[RuterLive] updateRouteLines:', { routesVisible, shapesCount: shapes?.length ?? 0, selectedVehicle: !!selectedVehicle });
  }

  if (!routesVisible || !shapes?.length) return;

  const shapesToShow = [];
  let vehicleClickFallbacks = [];
  const selectedMatches = [];
  for (const shape of shapes) {
    const mode = shape.mode?.toLowerCase();
    if (!visibleModes.has(mode)) continue;
    if (ALWAYS_SHOWN_MODES.has(mode)) {
      shapesToShow.push(shape);
      if (selectedVehicle && shapeMatchesVehicle(shape, selectedVehicle)) selectedMatches.push(shape);
    } else if (VEHICLE_CLICK_MODES.has(mode) && selectedVehicle) {
      if (shapeMatchesVehicle(shape, selectedVehicle)) {
        shapesToShow.push(shape);
        selectedMatches.push(shape);
      } else if (
        normalizeLine(shape.line) === normalizeLine(selectedVehicle.line?.publicCode) &&
        (shape.mode || '').toLowerCase() === vehicleMode(selectedVehicle)
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

  if (map.getZoom() >= ZOOM_STOPS_VISIBLE) {
    addStopMarkers(map, shapesToShow);
  }
}

function addStopMarkers(map, shapes) {
  const seen = new Set();
  const pointKey = (lat, lon) => `${lat.toFixed(5)},${lon.toFixed(5)}`;
  const stopSources = [];
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
  for (const { lat, lon, quayId, name, color } of stopSources) {
    const key = pointKey(lat, lon);
    if (seen.has(key)) continue;
    seen.add(key);
    const circle = L.circleMarker([lat, lon], {
      radius: quayId ? 7 : 4,
      fillColor: color,
      color: 'rgba(255,255,255,0.8)',
      weight: 1,
      fillOpacity: 0.7,
      interactive: !!quayId,
      zIndexOffset: quayId ? 500 : 0,
    });
    if (quayId) {
      const tooltipText = (name || 'Holdeplass').trim() ? `${(name || 'Holdeplass').trim()} · Klikk for avganger` : 'Klikk for avganger';
      circle.bindTooltip(tooltipText, { permanent: false, direction: 'top', offset: [0, -6], opacity: 0.95 });
      circle.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        showDepartureBoard(map, quayId, circle);
      });
      circle.bringToFront();
    }
    circle.addTo(map.routeLayerGroup);
  }
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

async function showDepartureBoard(map, quayId, anchor) {
  const popup = L.popup({ className: 'departure-board-popup', maxWidth: 320 }).setLatLng(anchor.getLatLng());
  popup.setContent('<div class="departure-loading">Henter avganger…</div>');
  popup.openOn(map);

  try {
    const res = await fetch(`/api/departures?quayId=${encodeURIComponent(quayId)}`);
    const data = await res.json();
    const name = data?.name || 'Holdeplass';
    const calls = (data?.estimatedCalls ?? [])
      .map((c) => {
        const time = c.expectedDepartureTime || c.aimedDepartureTime || '';
        return { ...c, depTime: time ? new Date(time).getTime() : 0 };
      })
      .filter((c) => c.depTime > 0)
      .sort((a, b) => a.depTime - b.depTime)
      .slice(0, 12);

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
      if (dest.length > 28) dest = dest.slice(0, 26) + '…';
      const isDelayed =
        c.realtime &&
        c.expectedDepartureTime &&
        c.aimedDepartureTime &&
        new Date(c.expectedDepartureTime).getTime() > new Date(c.aimedDepartureTime).getTime() + 60000;
      const delayBadge = isDelayed ? ' <span class="departure-delayed">forsinket</span>' : '';
      const realtime = c.realtime && !isDelayed ? ' <span class="departure-realtime">sanntid</span>' : '';
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
    popup.setContent(`<div class="departure-error">Kunne ikke hente avganger. ${escapeHtml(String(err.message))}</div>`);
  }
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function addRoutePolyline(map, shape, drawn, isHighlighted) {
  const key = `${shape.mode}|${shape.line}|${shape.from}|${shape.to}`;
  if (drawn.has(key)) return;
  drawn.add(key);

  const mode = shape.mode?.toLowerCase();
  const latlngs = shape.points.map((p) => [Number(p[0]), Number(p[1])]);
  const color = getShapeColor(mode, shape.line + (shape.from || ''));
  const polyline = L.polyline(latlngs, {
    color: isHighlighted ? '#fff' : color,
    weight: isHighlighted ? 5 : 3,
    opacity: isHighlighted ? 1 : 0.9,
    className: 'route-line',
  });
  polyline._ruterOriginalColor = color;

  const line = shape.line || '?';
  const from = shape.from || '—';
  const to = shape.to || '—';
  const tooltipText = `Linje ${line}: ${from} → ${to}`;

  polyline.bindTooltip(tooltipText, { permanent: false, direction: 'top', opacity: 0.95 });
  polyline.on('click', (e) => {
    L.DomEvent.stopPropagation(e);
    if (selectedPolyline && selectedPolyline !== polyline) {
      selectedPolyline.setStyle({
        weight: 3,
        opacity: 0.9,
        color: selectedPolyline._ruterOriginalColor,
      });
    }
    selectedPolyline = polyline;
    polyline.setStyle({ weight: 5, opacity: 1, color: '#fff' });
    polyline.bringToFront();
  });
  polyline.addTo(map.routeLayerGroup);
  routeLayers.push(polyline);
  if (isHighlighted) polyline.bringToFront();
}


export function setRoutesVisible(visible) {
  routesVisible = visible;
}

export function isRoutesVisible() {
  return routesVisible;
}

export function clearRouteSelection() {
  if (selectedPolyline) {
    selectedPolyline.setStyle({
      weight: 3,
      opacity: 0.9,
      color: selectedPolyline._ruterOriginalColor,
    });
    selectedPolyline = null;
  }
}
