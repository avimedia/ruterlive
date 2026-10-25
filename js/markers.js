import L from 'leaflet';
import { getMap } from './map.js';
import { isFlytogLineCode } from '../config.js';
import { positionAt, isDwelling } from '../shared/vehicle-path.js';
import { gpsGlideMs } from './feed-policy.js';
import { onLinePosition } from './line-geometry.js';
import { delayLabel, DELAY_SHOWN_S, DELAY_MAJOR_S } from '../shared/vehicle-delay.js';
import { headingFromMove, angleDiff, MIN_HEADING_CHANGE_DEG } from './vehicle-heading.js';

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
  if ((base === 'bus' || base === 'coach') && vehicle?.line?.publicCode?.toUpperCase?.().startsWith('FB'))
    return 'flybuss';
  // Flytoget: FLY1, FLY2. Destinasjon brukes bare når linjekode mangler – Vy-tog går også til lufthavna.
  if (base === 'rail') {
    const code = vehicle?.line?.publicCode || '';
    const dest = (vehicle?.destinationName || '').toLowerCase();
    if (isFlytogLineCode(code) || (!code && (dest.includes('lufthavn') || dest.includes('gardermoen')))) return 'flytog';
  }
  return base;
}

const vehicleMarkers = new Map();
let lastVehicles = [];
let lastVisibleModes = new Set();

const ANIM_SKIP_THRESHOLD_KM = 2; // Ved sprang > 2 km: sett posisjon direkte (unngår «flyvende» flybuss m.m.)

/*
 * Kontinuerlig bevegelse: én felles løkke (ca. 1 Hz) flytter alle synlige markører.
 * - ET-kjøretøy med path: posisjon beregnes fra rutetidene (positionAt). Når en ny path gir en
 *   annen posisjon enn den som vises, blandes det over EASE_MS mot den bevegelige path-posisjonen.
 * - GPS-kjøretøy (uten path): lineær glidning mot ny posisjon, varighet fra observert oppdateringsintervall (8–20 s).
 * Ingen timere per kjøretøy. CSS-overgang på transform jevner ut stegene mellom tikkene.
 */
const TICK_MS = 1000;
const EASE_MS = 2000;
const MIN_MOVE_DEG = 2e-6; // ca. 0,2 m – mindre endringer gir ikke setLatLng
const BOUNDS_PAD = 0.15;

/** vehicleId -> { path, to, from, start, dur } */
const motion = new Map();
const tickListeners = [];
let tickTimer = null;
let snapAll = false; // etter skjult fane: sett alle markører direkte på riktig plass

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
    html: show ? `<span class="vehicle-line-num">${escapeHtml(line)}</span>` : '',
    iconSize: show ? [28, 28] : [14, 14],
    iconAnchor: show ? [14, 14] : [7, 7],
  });
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

/** Setter ikon bare når utseendet faktisk endres (unngår å bygge DOM-elementet på nytt). */
function setIconIfChanged(marker, mode, lineCode, showLine) {
  const key = `${mode}|${lineCode}|${showLine ? 1 : 0}`;
  if (marker._rlIconKey === key) return;
  marker._rlIconKey = key;
  marker.setIcon(createIcon(mode, lineCode, showLine));
  applyDecor(marker); // setIcon nullstiller className
}

/*
 * Tilstand på markøren utover posisjon: forsinkelsesring, «står på holdeplass», kjøreretning (pil fra
 * zoom 14, se ZOOM_LINE_VISIBLE) og rAF-styring for valgt kjøretøy. Alt er CSS-klasser og én
 * CSS-variabel på det eksisterende ikonelementet; DOM skrives bare når noe faktisk endres.
 */
function decorOf(marker) {
  if (!marker._rlDecor) {
    marker._rlDecor = { delay: 0, dwell: false, gpsBearing: null, heading: null, headingShown: null, lastPos: null, raf: false };
  }
  return marker._rlDecor;
}

function delayClass(delay) {
  if (!(delay >= DELAY_SHOWN_S)) return '';
  return delay >= DELAY_MAJOR_S ? 'rl-late-major' : 'rl-late';
}

/** Skriver hele tilstanden til ikonet (etter nytt ikon eller når markøren legges på kartet igjen). */
function applyDecor(marker) {
  const icon = marker._icon;
  const d = marker._rlDecor;
  if (!icon || !d) return;
  const late = delayClass(d.delay);
  icon.classList.toggle('rl-late', late === 'rl-late');
  icon.classList.toggle('rl-late-major', late === 'rl-late-major');
  icon.classList.toggle('rl-dwell', d.dwell);
  icon.classList.toggle('rl-raf', d.raf);
  d.headingShown = null;
  syncHeading(marker, d);
}

function setDelay(marker, delay) {
  const d = decorOf(marker);
  const next = Number.isFinite(delay) ? delay : 0;
  const changed = delayClass(next) !== delayClass(d.delay);
  d.delay = next;
  if (changed) applyDecor(marker);
}

/** Roterer pila når kursen er endret minst MIN_HEADING_CHANGE_DEG. Bare når pila vises (zoom ≥ 14). */
function syncHeading(marker, d) {
  const icon = marker._icon;
  const h = d.gpsBearing ?? d.heading;
  if (!icon || h === null || !icon.classList.contains('vehicle-marker-with-label')) return;
  if (d.headingShown !== null && angleDiff(h, d.headingShown) < MIN_HEADING_CHANGE_DEG) return;
  d.headingShown = h;
  icon.style.setProperty('--rl-heading', `${h}deg`);
  icon.classList.add('rl-dir');
}

/** Per tikk for markører i bildet: holdeplass-tilstand og kurs fra de to siste viste posisjonene. */
function updateDecor(marker, st, pos, wallNow, headingVisible) {
  const d = decorOf(marker);
  const dwell = !!st.path && isDwelling(st.path, wallNow);
  if (dwell !== d.dwell) {
    d.dwell = dwell;
    marker._icon?.classList.toggle('rl-dwell', dwell);
  }
  // Under overgang til ny path (korrigering, kan gå bakover) beholdes kursen
  if (d.gpsBearing === null && !(st.path && st.from)) {
    if (!d.lastPos) d.lastPos = pos;
    else {
      const h = headingFromMove(d.lastPos, pos);
      if (h !== null) {
        d.heading = h;
        d.lastPos = pos;
      }
    }
  }
  if (headingVisible) syncHeading(marker, d);
}

/** Posisjonen kjøretøyet skal vises på nå, eller null. Rydder ferdige overganger. */
function motionPosition(st, wallNow, perfNow, id, geoView) {
  const straight = st.path ? positionAt(st.path, wallNow) : st.to;
  // ET: langs faktisk trasé når den finnes (zoom >= 13, i utsnittet), ellers rett linje
  const target = (st.path && geoView && onLinePosition(id, st.path, wallNow, straight, geoView)) || straight;
  if (!target) return null;
  if (!st.from) return target;
  const k = (perfNow - st.start) / st.dur;
  if (k >= 1) {
    st.from = null;
    return target;
  }
  const e = st.path ? k * k * (3 - 2 * k) : k; // path: myk overgang, GPS: lineær
  return [st.from[0] + (target[0] - st.from[0]) * e, st.from[1] + (target[1] - st.from[1]) * e];
}

/** Ny posisjon/path fra polling: start overgang fra posisjonen som vises nå. */
function setMotionTarget(id, marker, path, lat, lon) {
  const perfNow = performance.now();
  const target = (path && positionAt(path, Date.now())) || [lat, lon];
  const cur = marker.getLatLng();
  const prev = motion.get(id);
  const st = prev || {};
  st.path = path || null;
  if (haversineKm(cur.lat, cur.lng, target[0], target[1]) > ANIM_SKIP_THRESHOLD_KM) {
    st.from = null;
    st.to = path ? null : target;
    marker.setLatLng(target);
  } else if (path) {
    st.to = null;
    const moved = Math.abs(cur.lat - target[0]) > 1e-5 || Math.abs(cur.lng - target[1]) > 1e-5;
    if (moved) Object.assign(st, { from: [cur.lat, cur.lng], start: perfNow, dur: EASE_MS });
    else st.from = null;
  } else {
    const same = st.to && Math.abs(st.to[0] - target[0]) < 1e-7 && Math.abs(st.to[1] - target[1]) < 1e-7;
    if (!same) {
      const moved = Math.abs(cur.lat - target[0]) > 1e-6 || Math.abs(cur.lng - target[1]) > 1e-6;
      const interval = st.changedAt ? perfNow - st.changedAt : NaN;
      st.changedAt = perfNow;
      Object.assign(st, { to: target, from: moved ? [cur.lat, cur.lng] : null, start: perfNow, dur: gpsGlideMs(interval) });
    }
  }
  if (!prev) motion.set(id, st);
}

/** Flytter markøren uten CSS-overgang (ellers sklir den over kartet fra utdatert posisjon). */
function setLatLngNoGlide(marker, pos) {
  const icon = marker._icon;
  if (!icon) {
    marker.setLatLng(pos);
    return;
  }
  icon.style.transition = 'none';
  marker.setLatLng(pos);
  void icon.offsetWidth; // tving stilberegning før overgangen slås på igjen
  icon.style.transition = '';
}

function tickMarkers() {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  const map = getMap();
  if (!map || motion.size === 0) return;
  const b = map.getBounds().pad(BOUNDS_PAD);
  const s = b.getSouth(), n = b.getNorth(), w = b.getWest(), e = b.getEast();
  const inView = (lat, lon) => lat >= s && lat <= n && lon >= w && lon <= e;
  const wallNow = Date.now();
  const perfNow = performance.now();
  const geoView = { zoom: map.getZoom(), s, n, w, e };
  const headingVisible = map.getZoom() >= ZOOM_LINE_VISIBLE;
  for (const [id, st] of motion) {
    const marker = vehicleMarkers.get(id);
    if (!marker || !marker._map) continue; // skjult av filter
    const cur = marker._latlng;
    const pos = motionPosition(st, wallNow, perfNow, id, geoView);
    if (!pos) continue;
    if (!inView(cur.lat, cur.lng) && !inView(pos[0], pos[1])) {
      marker._rlSkipped = true; // posisjonen er utdatert til den kommer i bilde
      continue;
    }
    updateDecor(marker, st, pos, wallNow, headingVisible);
    if (id === rafVehicleId && rafId) continue; // flyttes av animasjonsløkka (60 fps)
    if (Math.abs(cur.lat - pos[0]) < MIN_MOVE_DEG && Math.abs(cur.lng - pos[1]) < MIN_MOVE_DEG) {
      marker._rlSkipped = false;
      continue;
    }
    if (marker._rlSkipped || snapAll) {
      marker._rlSkipped = false;
      setLatLngNoGlide(marker, pos);
    } else {
      marker.setLatLng(pos);
    }
  }
  snapAll = false;
  for (const fn of tickListeners) fn();
}

function ensureTicker() {
  if (tickTimer) return;
  tickTimer = setInterval(tickMarkers, TICK_MS);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        snapAll = true;
        stopRaf();
      } else {
        tickMarkers();
        startRaf();
      }
    });
  }
  const map = getMap();
  const container = map?.getContainer();
  if (container) {
    // CSS-glidning av av under zoom, ellers henger markørene etter kartet
    container.classList.add('vehicle-glide');
    map.on('zoomstart', () => container.classList.remove('vehicle-glide'));
    map.on('zoomend', () => {
      requestAnimationFrame(() => requestAnimationFrame(() => container.classList.add('vehicle-glide')));
    });
    map.on('moveend', tickMarkers);
  }
}

/*
 * Valgt kjøretøy flyttes med requestAnimationFrame mellom tikkene (jevn bevegelse i 60 fps).
 * Bare denne ene markøren; løkka stopper ved fravalg, skjult fane og prefers-reduced-motion.
 * DOM skrives bare når posisjonen flytter seg minst én skjermpiksel.
 */
let rafVehicleId = null;
let rafId = 0;
let rafLastPx = null;
const reducedMotion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

function setRafFlag(id, on) {
  const marker = id ? vehicleMarkers.get(id) : null;
  if (!marker) return;
  const d = decorOf(marker);
  if (d.raf === on) return;
  d.raf = on;
  marker._icon?.classList.toggle('rl-raf', on);
}

function rafFrame() {
  rafId = 0;
  const map = getMap();
  const marker = rafVehicleId ? vehicleMarkers.get(rafVehicleId) : null;
  const st = rafVehicleId ? motion.get(rafVehicleId) : null;
  if (!map || !marker || !st || document.visibilityState === 'hidden') {
    stopRaf();
    return;
  }
  rafId = requestAnimationFrame(rafFrame);
  if (!marker._map || map._animatingZoom) return;
  const pos = motionPosition(st, Date.now(), performance.now());
  if (!pos) return;
  const px = map.latLngToLayerPoint(pos).round();
  if (rafLastPx && px.x === rafLastPx.x && px.y === rafLastPx.y) return;
  rafLastPx = px;
  marker.setLatLng(pos);
}

function startRaf() {
  if (rafId || !rafVehicleId || reducedMotion?.matches) return;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  setRafFlag(rafVehicleId, true);
  rafLastPx = null;
  rafId = requestAnimationFrame(rafFrame);
}

function stopRaf() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  setRafFlag(rafVehicleId, false);
}

/** Velger hvilket kjøretøy som animeres per bilde (null = ingen). */
export function setAnimatedVehicle(id) {
  if ((id || null) === rafVehicleId) {
    startRaf();
    return;
  }
  stopRaf();
  rafVehicleId = id || null;
  startRaf();
}

/** Kalles etter hvert tikk (f.eks. for å flytte delingspunktet på valgt rute). */
export function onMarkerTick(fn) {
  tickListeners.push(fn);
}

/** Posisjonen markøren vises på akkurat nå, eller null. */
export function getMarkerLatLng(vehicleId) {
  const m = vehicleMarkers.get(vehicleId);
  return m ? m.getLatLng() : null;
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

  ensureTicker();

  // Remove markers for vehicles no longer in data
  for (const [id, marker] of vehicleMarkers) {
    if (!vehicleIds.has(id)) {
      if (id === rafVehicleId) setAnimatedVehicle(null);
      map.removeLayer(marker);
      vehicleMarkers.delete(id);
      motion.delete(id);
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
    const from = (v.from || '').trim();
    const to = (v.to || '').trim();
    const via = (v.via || '').trim();
    const nextStop = (v.nextStop || '').trim();
    const endStation = (dest || to || '').trim();
    const destNorm = (dest || '').toLowerCase();
    const routeLabel = from && endStation ? `${from} → ${endStation}` : (dest ? `→ ${dest}` : null);
    const title = routeLabel ? `${lineCode} ${routeLabel}`.trim() : `${lineCode} → ${dest}`.trim();
    const popupHeader = routeLabel ? `Linje ${lineCode} · ${routeLabel}` : `Linje ${lineCode}`;
    const late = delayLabel(v.delay);
    const popupParts = [`<strong>${popupHeader}</strong>`];
    if (late) popupParts.push(`<span class="vehicle-delay">Forsinket ${late}</span>`);
    const samePlace = from && to && from.toLowerCase() === to.toLowerCase();
    if (samePlace && via) {
      const fromNorm = from.toLowerCase();
      const viaNorm = via.toLowerCase();
      const towardVia = viaNorm && destNorm.includes(viaNorm);
      const towardFrom = fromNorm && destNorm.includes(fromNorm);
      if (towardVia && !towardFrom) {
        popupParts.push(`${from} – ${via}`);
      } else if (towardFrom && !towardVia) {
        popupParts.push(`${via} – ${from}`);
      } else {
        popupParts.push(`${from} – ${via}`);
      }
      if (nextStop && nextStop.toLowerCase() !== viaNorm && nextStop.toLowerCase() !== fromNorm) {
        popupParts.push(`Neste: ${nextStop}`);
      }
    } else if (samePlace) {
      popupParts.push(from);
      if (nextStop && nextStop.toLowerCase() !== from.toLowerCase()) {
        popupParts.push(`Neste: ${nextStop}`);
      }
    } else {
      if (!routeLabel) {
        if (from) popupParts.push(`Fra: ${from}`);
        if (endStation) popupParts.push(`Til: ${endStation}`);
      }
      if (nextStop && nextStop.toLowerCase() !== endStation.toLowerCase()) {
        popupParts.push(`Neste: ${nextStop}`);
      }
      if (via) popupParts.push(`Via: ${via}`);
    }
    const popupHtml = popupParts.join('<br>');
    const tooltipText = late ? `${title} · ${late}` : title;

    const path = Array.isArray(v.path) && v.path.length >= 2 ? v.path : null;
    let marker = vehicleMarkers.get(v.vehicleId);
    if (marker) {
      setMotionTarget(v.vehicleId, marker, path, lat, lon);
      setIconIfChanged(marker, mode, lineCode, showLine);
      if (marker._rlTooltip !== tooltipText) {
        marker._rlTooltip = tooltipText;
        marker.getTooltip()?.setContent(tooltipText);
      }
      // Samme popup-objekt (ellers følger ikke en åpen popup markøren etter neste polling)
      const popup = marker.getPopup();
      if (!popup) marker.bindPopup(popupHtml, { className: 'vehicle-popup' });
      else if (marker._rlPopupHtml !== popupHtml) popup.setContent(popupHtml);
      marker._rlPopupHtml = popupHtml;
    } else {
      const start = (path && positionAt(path, Date.now())) || [lat, lon];
      marker = L.marker(start, {
        pane: 'vehiclePane',
        icon: createIcon(mode, lineCode, showLine),
      })
        .bindTooltip(tooltipText, {
          permanent: false,
          direction: 'top',
          offset: [0, -8],
        });
      marker.bindPopup(popupHtml, { className: 'vehicle-popup' });
      marker._rlPopupHtml = popupHtml;
      marker._rlTooltip = tooltipText;
      marker._rlIconKey = `${mode}|${lineCode}|${showLine ? 1 : 0}`;
      // Nytt ikonelement hver gang markøren legges på kartet (filter av/på): skriv tilstanden på nytt
      marker.on('add', () => applyDecor(marker));
      marker.addTo(map);
      vehicleMarkers.set(v.vehicleId, marker);
      motion.set(v.vehicleId, { path, to: path ? null : start, from: null, start: 0, dur: 1 });
    }
    const decor = decorOf(marker);
    const gpsBearing = !path && Number.isFinite(v.bearing) ? ((Math.round(v.bearing) % 360) + 360) % 360 : null;
    if (gpsBearing !== decor.gpsBearing) {
      decor.gpsBearing = gpsBearing;
      if (showLine) syncHeading(marker, decor);
    }
    setDelay(marker, v.delay);
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
        marker._rlSkipped = true; // posisjonen kan være utdatert mens den var skjult
        marker.addTo(map);
      }
      const lineCode = v.line?.publicCode || '?';
      setIconIfChanged(marker, mode, lineCode, showLine);
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
      setIconIfChanged(marker, mode, lineCode, showLine);
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
