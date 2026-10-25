import L from 'leaflet';
import { getMap } from './map.js';
import { isFlytogLineCode } from '../config.js';
import { splitRouteAt, chooseClosestShape } from './route-split.js';
import { groupStops } from './stop-groups.js';

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
/** Valgte kjøretøyruter (kjørt/gjenstående del + kant), oppdateres ved ny posisjon. */
let highlightedRoutes = [];
const DIM_OPACITY = 0.3;
const AHEAD_DASH = '2, 10';
let routesVisible = true;
let lastRenderedShapesKey = '';
let lastRenderedModesKey = '';
let lastSelectedVehicleKey = '';
let lastRenderedStopsKey = '';
let lastRenderedBboxKey = '';
let lastRenderedRoutesVisible = null;
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
  if (m === 'rail' && isFlytogLineCode(vehicle?.line?.publicCode)) return 'flytog';
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

/**
 * Hel rute for valgt buss/båt/flybuss fra serveren (/api/vehicle-route, Entur JP).
 * ET-rutene er ofte bare deler av turen, så JP-ruten foretrekkes for valgt kjøretøy.
 * Én henting per linje + retning; svaret (eller mangel på rute) huskes i minnet.
 */
const vehicleRoutes = new Map(); // nøkkel -> { shape, pending, at }
const VEHICLE_ROUTE_MAX = 100;
const VEHICLE_ROUTE_RETRY_MS = 5 * 60 * 1000;
let vehicleRouteVersion = 0;
let lastRouteArgs = null;

function cleanDest(s) {
  return (s || '').replace(/[^\p{L}\p{N} .,'()/&+-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
}

function vehicleRouteParams(vehicle) {
  const line = String(vehicle?.line?.publicCode || '');
  if (!/^[A-Za-z0-9]{1,10}$/.test(line)) return null;
  const params = { line, mode: vehicleMode(vehicle), dest: cleanDest(vehicle?.destinationName) };
  const ref = vehicle?.line?.ref || vehicle?.line?.lineRef;
  if (ref && /^[A-Z]{3}:Line:[A-Za-z0-9_.-]{1,64}$/.test(ref)) params.ref = ref;
  return params;
}

function vehicleRouteKey(params) {
  return `${params.ref || ''}|${params.mode}|${params.line}|${params.dest.toLowerCase()}`;
}

function routeResponseToShape(data) {
  if (!data || !Array.isArray(data.points) || data.points.length < 2) return null;
  return {
    mode: data.mode,
    line: data.line,
    from: data.from,
    to: data.to,
    points: data.points,
    // Holdeplasser med quay-ID (avgangstavle ved klikk); punktene er bare trasé
    quayStops: (data.stops || []).map(([lat, lon, name, quayId]) => [lat, lon, quayId, name]),
    pointsAreTrace: true,
  };
}

/** Gir { shape, pending } for kjøretøyets JP-rute (og starter henting ved behov). */
function vehicleRouteFor(vehicle) {
  const params = vehicleRouteParams(vehicle);
  if (!params) return { shape: null, pending: false };
  const key = vehicleRouteKey(params);
  const hit = vehicleRoutes.get(key);
  if (hit && (hit.pending || hit.shape || Date.now() - hit.at < VEHICLE_ROUTE_RETRY_MS)) {
    return { shape: hit.shape, pending: hit.pending };
  }
  vehicleRoutes.set(key, { shape: null, pending: true, at: Date.now() });
  fetch(`/api/vehicle-route?${new URLSearchParams(params)}`)
    .then((r) => (r.ok ? r.json() : null))
    .then(routeResponseToShape)
    .catch(() => null)
    .then((shape) => {
      vehicleRoutes.delete(key);
      vehicleRoutes.set(key, { shape, pending: false, at: Date.now() });
      while (vehicleRoutes.size > VEHICLE_ROUTE_MAX) vehicleRoutes.delete(vehicleRoutes.keys().next().value);
      if (!lastRouteArgs) return;
      const sel = lastRouteArgs[2];
      const selParams = sel ? vehicleRouteParams(sel) : null;
      // Tegn på nytt også uten rute: da vises de lokale treffene i stedet
      if (selParams && vehicleRouteKey(selParams) === key) {
        vehicleRouteVersion++;
        updateRouteLines(...lastRouteArgs);
      }
    });
  return { shape: null, pending: true };
}

export function updateRouteLines(shapes, visibleModes, selectedVehicle = null) {
  const map = getMap();
  if (!map || !map.routeLayerGroup) return;
  lastRouteArgs = [shapes, visibleModes, selectedVehicle];

  const selectedKey = selectedVehicle
    ? `${selectedVehicle.vehicleId}-${selectedVehicle.line?.publicCode}-${selectedVehicle.destinationName || ''}-${vehicleRouteVersion}`
    : '';
  const shapesKey = shapes?.length ? `${shapes.length}-${shapes.slice(0, 5).map((s) => s.line + s.from).join('|')}` : '0';
  const modesKey = [...(visibleModes || [])].sort().join(',');
  const mapZoom = map.getZoom();
  const stopsVisibleKey = mapZoom >= ZOOM_STOPS_VISIBLE ? '1' : '0';
  const b = map.getBounds();
  const bboxKey = mapZoom >= ZOOM_STOPS_VISIBLE ? `${b.getSouth().toFixed(2)},${b.getNorth().toFixed(2)},${b.getWest().toFixed(2)},${b.getEast().toFixed(2)}` : '';
  if (shapesKey === lastRenderedShapesKey && modesKey === lastRenderedModesKey && selectedKey === lastSelectedVehicleKey && stopsVisibleKey === lastRenderedStopsKey && bboxKey === lastRenderedBboxKey && routesVisible === lastRenderedRoutesVisible) {
    return;
  }
  lastRenderedBboxKey = bboxKey;
  lastRenderedRoutesVisible = routesVisible;
  lastRenderedShapesKey = shapesKey;
  lastRenderedModesKey = modesKey;
  lastSelectedVehicleKey = selectedKey;
  lastRenderedStopsKey = stopsVisibleKey;

  map.routeLayerGroup.clearLayers();
  if (map.stopsLayerGroup) map.stopsLayerGroup.clearLayers();
  routeLayers = [];
  selectedPolyline = null;
  highlightedRoutes = [];

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

  // Buss/båt/flybuss: hel rute fra JP erstatter de lokale treffene (ET-biter, statiske varianter)
  const selMode = selectedVehicle ? vehicleMode(selectedVehicle) : null;
  const isClickMode = (sh) => VEHICLE_CLICK_MODES.has(shapeModeForFilter(sh));
  let highlighted = [];
  if (selMode && VEHICLE_CLICK_MODES.has(selMode)) {
    const jp = vehicleRouteFor(selectedVehicle);
    if (jp.shape) {
      for (let i = shapesToShow.length - 1; i >= 0; i--) if (isClickMode(shapesToShow[i])) shapesToShow.splice(i, 1);
      shapesToShow.push(jp.shape);
      highlighted = [jp.shape];
    } else if (jp.pending && selectedMatches.length > 1) {
      // Mens JP-ruten hentes: bare ett lokalt treff, ingen floke av varianter
      const chosen = selectedMatches[chooseClosestShape(selectedMatches, vehicleLatLng(selectedVehicle))];
      for (let i = shapesToShow.length - 1; i >= 0; i--) {
        if (isClickMode(shapesToShow[i]) && shapesToShow[i] !== chosen) shapesToShow.splice(i, 1);
      }
      highlighted = [chosen];
    }
  }
  // Flere treff (t-bane/trikk med varianter, eller uten JP-rute): bare den nærmeste uthevet, resten dempet
  if (highlighted.length === 0 && selectedMatches.length > 0) {
    highlighted = [selectedMatches[chooseClosestShape(selectedMatches, vehicleLatLng(selectedVehicle))]];
  }

  const drawn = new Set();
  // Dempede linjer først, uthevet rute over; en dempet linje med samme nøkkel som den uthevede hoppes over
  const routeKey = (sh) => `${sh.mode}|${sh.line}|${sh.from}|${sh.to}`;
  const highlightedKeys = new Set(highlighted.map(routeKey));
  for (const shape of shapesToShow) {
    if (highlighted.includes(shape) || highlightedKeys.has(routeKey(shape))) continue;
    addRoutePolyline(map, shape, drawn, false, null, !!selectedVehicle);
  }
  for (const shape of highlighted) {
    addRoutePolyline(map, shape, drawn, true, selectedVehicle, false);
  }

  // Holdeplasser: ved valgt kjøretøy kun rutens stopp (zoom 12+), ellers zoom 15+ med bbox
  const showStopsForSelection = highlighted.length > 0 && mapZoom >= 12;
  const showStopsForAll = mapZoom >= ZOOM_STOPS_VISIBLE;
  if (showStopsForSelection || showStopsForAll) {
    const shapesForStops = showStopsForSelection
      ? highlighted
      : (shapes ?? []).filter((s) => effectiveModes.has(shapeModeForFilter(s)));
    const onlyRouteStops = showStopsForSelection;
    addStopMarkers(map, shapesForStops, effectiveModes, onlyRouteStops);
  }

}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

/** quayIds: én quay-ID eller flere (sammenslått stasjon); avgangstavla viser alle. */
function createStopMarker(lat, lon, quayIds, name, color, stopsLayer) {
  const ids = (Array.isArray(quayIds) ? quayIds : [quayIds]).filter(Boolean);
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
  marker._quayId = ids[0];
  const popup = L.popup({ className: 'departure-board-popup', maxWidth: 460 });
  marker.bindPopup(popup, { autoClose: true, closeOnClick: true });
  marker.on('click', (e) => L.DomEvent.stopPropagation(e));
  marker.on('popupopen', () => {
    showDepartureBoard(marker.getPopup(), ids);
  });
  marker.bindTooltip(`${label} · Klikk for avganger`, { permanent: false, direction: 'top', offset: [0, -8] });
  marker.addTo(stopsLayer);
  return marker;
}

function createLabelOnlyStopMarker(lat, lon, name, color, stopsLayer) {
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
  return marker;
}

/** Én markør per gruppe (samme navn, tett): plattformer/quays på samme stasjon slås sammen. */
function drawStopGroups(stops, stopsLayer) {
  const markers = [];
  for (const g of groupStops(stops)) {
    const color = g.first.color;
    if (g.quayIds.length) markers.push(createStopMarker(g.lat, g.lon, g.quayIds, g.name, color, stopsLayer));
    else markers.push(createLabelOnlyStopMarker(g.lat, g.lon, g.name, color, stopsLayer));
  }
  return markers;
}

function addStopMarkers(map, shapes, visibleModes, onlyRouteStops = false) {
  const named = [];
  for (const shape of shapes) {
    const mode = shape.mode?.toLowerCase();
    const color = getShapeColor(mode, shape.line + (shape.from || ''));
    const pts = [...(shape.pointsAreTrace ? [] : shape.points ?? []), ...(shape.quayStops ?? [])];
    for (const [lat, lon, quayId, name] of pts) {
      // Punkter uten quayId og navn er traséhjørner (JP/OSM-polylinjer), ikke holdeplasser
      if (quayId || name) named.push({ lat, lon, quayId, name: name || '', color });
    }
  }

  const stopsLayer = map.stopsLayerGroup || map.routeLayerGroup;
  let drawn = drawStopGroups(named, stopsLayer);

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
      if (thisFetchId !== bboxFetchId || !bboxStops?.length) return;
      const color = MODE_COLORS.bus;
      const all = named.concat(bboxStops.map((s) => ({ lat: s.lat, lon: s.lon, quayId: s.id, name: s.name, color })));
      // Tegn på nytt med alle stopp, så bbox-quays havner i samme gruppe som linjenes stopp
      for (const m of drawn) stopsLayer.removeLayer(m);
      drawn = drawStopGroups(all, stopsLayer);
    })
    .catch(() => {});
}

/** Samme grense som /api/departures i server.js. */
const DEPARTURE_MAX_QUAYS = 30;

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

async function showDepartureBoard(popup, quayIds) {
  popup.setContent('<div class="departure-loading">Henter avganger…</div>');

  try {
    const ids = (Array.isArray(quayIds) ? quayIds : [quayIds]).slice(0, DEPARTURE_MAX_QUAYS);
    const res = await fetch(`/api/departures?quayId=${ids.map(encodeURIComponent).join(',')}`);
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

function getRouteCasingColor() {
  return getComputedStyle(document.documentElement).getPropertyValue('--route-casing').trim() || '#fff';
}

function vehicleLatLng(vehicle) {
  const lat = Number(vehicle?.location?.latitude);
  const lon = Number(vehicle?.location?.longitude);
  return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null;
}

/** Tegner valgt rute: kant under, kjørt del helt, gjenstående del prikket. */
function addHighlightedRoute(map, shape, latlngs, color, vehicle, tooltipText) {
  const split = splitRouteAt(latlngs, vehicleLatLng(vehicle));
  const base = { lineCap: 'round', lineJoin: 'round', interactive: false, className: 'route-line-selected' };
  const casingColor = getRouteCasingColor();
  const casingDriven = L.polyline(split.driven, { ...base, color: casingColor, weight: 9, opacity: 1 });
  const casingAhead = L.polyline(split.ahead, { ...base, className: 'route-line-selected route-ahead-casing', color: casingColor, weight: 9, opacity: 1, dashArray: AHEAD_DASH });
  const driven = L.polyline(split.driven, { ...base, interactive: true, color, weight: 6, opacity: 1 });
  // Prikkene «marsjerer» i kjøreretningen (CSS, se .route-ahead-march); kanten under animeres ikke
  const ahead = L.polyline(split.ahead, { ...base, className: 'route-line-selected route-ahead-march', interactive: true, color, weight: 6, opacity: 1, dashArray: AHEAD_DASH });
  for (const pl of [driven, ahead]) pl.bindTooltip(tooltipText, { permanent: false, direction: 'top', opacity: 0.95 });
  for (const pl of [casingDriven, casingAhead, driven, ahead]) pl.addTo(map.routeLayerGroup);
  highlightedRoutes.push({ latlngs, casingDriven, casingAhead, driven, ahead });
  // Kant først, så linjene over
  casingDriven.bringToFront();
  casingAhead.bringToFront();
  driven.bringToFront();
  ahead.bringToFront();
}

/** Flytt delingspunktet når valgt kjøretøy får ny posisjon. */
export function updateSelectedVehicleSplit(vehicle) {
  const pos = vehicleLatLng(vehicle);
  if (!pos) return;
  for (const r of highlightedRoutes) {
    const { driven, ahead } = splitRouteAt(r.latlngs, pos);
    r.casingDriven.setLatLngs(driven);
    r.driven.setLatLngs(driven);
    r.casingAhead.setLatLngs(ahead);
    r.ahead.setLatLngs(ahead);
  }
}

function addRoutePolyline(map, shape, drawn, isHighlighted, vehicle = null, dim = false) {
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
  const isRail = mode === 'rail' || mode === 'flytog';
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


  if (isHighlighted && vehicle) {
    addHighlightedRoute(map, shape, latlngs, color, vehicle, tooltipText);
    return;
  }

  const polyline = L.polyline(latlngs, {
    color,
    weight: 2,
    opacity: dim ? DIM_OPACITY : 0.9,
    dashArray: isRail ? '6, 6' : undefined,
    className: 'route-line',
  });
  polyline._ruterOriginalColor = color;
  polyline._ruterIsRail = isRail;

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
      weight: 5,
      opacity: 1,
      color: polyline._ruterOriginalColor,
      dashArray: polyline._ruterIsRail ? '6, 6' : undefined,
    });
    polyline.bringToFront();
  });
  polyline.addTo(map.routeLayerGroup);
  routeLayers.push(polyline);
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
  const casing = getRouteCasingColor();
  for (const r of highlightedRoutes) {
    r.casingDriven.setStyle({ color: casing });
    r.casingAhead.setStyle({ color: casing });
  }
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
