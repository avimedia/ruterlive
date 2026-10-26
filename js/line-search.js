/**
 * Linjesøk i kartsøket: finner linjer ut fra kode, utheber valgt linje (andre kjøretøy dimmes,
 * ruta tegnes tykt over de andre) og zoomer kartet til linja. Treffelogikken ligger i shared/line-list.js.
 */

import L from 'leaflet';
import { getMap } from './map.js';
import { isFlytogLineCode } from '../config.js';
import { setLineHighlight } from './markers.js';
import {
  matchLines,
  chipLabel,
  parseLineParam,
  MODE_COLORS,
  modeLabel,
  lineHighlightOf,
  vehicleOnLine,
  vehicleLineRef,
  normLineCode,
  preferredAuthority,
} from '../shared/line-list.js';

let vehicles = [];
let shapes = [];
let liveCodes = [];
let active = null; // { line, codes: Set<string>, highlight }
let overlay = null;
let pendingFit = false;
let overlayKey = '';
let jpShape = null;
let jpToken = 0;
let chipEl = null;

const reducedMotion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

function vehicleMode(v) {
  const m = (v?.mode || '').toLowerCase();
  const code = String(v?.line?.publicCode || '');
  if (m === 'bus' || m === 'coach') return code.toUpperCase().startsWith('FB') ? 'flybuss' : 'bus';
  if (m === 'rail') return isFlytogLineCode(code) ? 'flytog' : 'rail';
  if (m === 'ferry') return 'water';
  return m || 'bus';
}

function shapeMode(s) {
  const m = (s?.mode || '').toLowerCase();
  return m === 'coach' ? 'flybuss' : m || 'bus';
}

/** Kalles fra main.js hver gang kjøretøy/ruter er slått sammen. */
export function setLineSearchData(nextVehicles, nextShapes) {
  vehicles = nextVehicles || [];
  shapes = nextShapes || [];
  const seen = new Map();
  for (const v of vehicles) {
    const code = String(v.line?.publicCode || '').trim();
    if (!code) continue;
    const mode = vehicleMode(v);
    const key = `${mode}|${code.toUpperCase()}`;
    const e = seen.get(key) || { code, mode, auths: new Set() };
    const ref = vehicleLineRef(v);
    if (ref) e.auths.add(ref.split(':')[0]);
    seen.set(key, e);
  }
  liveCodes = [...seen.values()].map(({ code, mode, auths }) => ({ code, mode, authority: preferredAuthority(auths) }));
  if (active) refreshActive();
}

export function searchLines(query) {
  return matchLines(query, liveCodes);
}

function vehiclesOfActive() {
  if (!active) return [];
  return vehicles.filter((v) => vehicleOnLine(v, vehicleMode(v), active.highlight));
}

function shapesOfActive() {
  if (!active) return [];
  return shapes.filter((s) => shapeMode(s) === active.line.mode && active.codes.has(normLineCode(s.line)));
}

function toLatLngs(points) {
  const out = [];
  for (const p of points || []) {
    const ll = Array.isArray(p) ? [Number(p[0]), Number(p[1])] : p && typeof p.lat === 'number' ? [p.lat, p.lon] : null;
    if (ll && Number.isFinite(ll[0]) && Number.isFinite(ll[1])) out.push(ll);
  }
  return out;
}

function getOverlay(map) {
  if (!map.getPane('lineHighlightPane')) {
    map.createPane('lineHighlightPane');
    map.getPane('lineHighlightPane').style.zIndex = 560;
  }
  if (!overlay) overlay = L.layerGroup().addTo(map);
  return overlay;
}

function drawOverlay() {
  const map = getMap();
  if (!map || !active) return;
  const list = jpShape ? [jpShape] : shapesOfActive();
  const key = `${active.line.mode}|${active.line.code}|${jpShape ? 'jp' : ''}|${list.length}|${list.reduce((n, s) => n + (s.points?.length || 0), 0)}`;
  if (key === overlayKey) return;
  overlayKey = key;
  const group = getOverlay(map);
  group.clearLayers();
  const color = MODE_COLORS[active.line.mode] || '#888';
  for (const s of list) {
    const ll = toLatLngs(s.points);
    if (ll.length < 2) continue;
    L.polyline(ll, { pane: 'lineHighlightPane', color, weight: 5, opacity: 0.95, interactive: false, lineJoin: 'round' }).addTo(group);
  }
}

function dist(v, c) {
  return c ? (v.location.latitude - c.lat) ** 2 + (v.location.longitude - c.lng) ** 2 : 0;
}

function fetchJpRoute() {
  // Kodene gjenbrukes av andre fylker: hent bare JP-rute når ET ikke har noen rute, for linjas kjøretøy
  // (helst ett med linje-ID) nærmest kartsenteret
  if (shapesOfActive().length) return;
  const c = getMap()?.getCenter();
  const first = vehiclesOfActive()
    .filter((v) => v.destinationName && v.location)
    .sort((a, b) => Number(!!vehicleLineRef(b)) - Number(!!vehicleLineRef(a)) || dist(a, c) - dist(b, c))[0];
  if (!first) return;
  const params = { line: String(first.line.publicCode), mode: active.line.mode, dest: String(first.destinationName).slice(0, 100) };
  const ref = vehicleLineRef(first);
  if (ref && /^[A-Z]{3}:Line:[A-Za-z0-9_.-]{1,64}$/.test(ref)) params.ref = ref;
  else if (active.highlight.authority) params.authority = active.highlight.authority;
  const token = ++jpToken;
  fetch(`/api/vehicle-route?${new URLSearchParams(params)}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (token !== jpToken || !active || !Array.isArray(data?.points) || data.points.length < 2) return;
      jpShape = { points: data.points };
      drawOverlay();
      if (pendingFit) fit();
    })
    .catch(() => {});
}

function fit() {
  const map = getMap();
  if (!map || !active) return false;
  const pts = [];
  for (const s of jpShape ? [jpShape] : shapesOfActive()) pts.push(...toLatLngs(s.points));
  if (!pts.length) {
    for (const v of vehiclesOfActive()) {
      if (Number.isFinite(v.location?.latitude) && Number.isFinite(v.location?.longitude)) pts.push([v.location.latitude, v.location.longitude]);
    }
  }
  if (!pts.length) return false;
  pendingFit = false;
  map.fitBounds(L.latLngBounds(pts), { padding: [60, 60], maxZoom: 15, animate: !reducedMotion?.matches });
  return true;
}

function refreshActive() {
  drawOverlay();
  if (!jpShape && !jpToken) fetchJpRoute();
  if (pendingFit) fit();
}

export function selectLine(line, { fitMap = true } = {}) {
  clearLine({ keepChip: true });
  const highlight = lineHighlightOf(line);
  active = { line, codes: new Set(highlight.codes), highlight };
  pendingFit = fitMap;
  setLineHighlight(highlight);
  jpShape = null;
  overlayKey = '';
  jpToken = 0;
  drawOverlay();
  if (pendingFit) fit();
  if (!jpShape) fetchJpRoute();
  showChip(line);
}

export function clearLine({ keepChip = false } = {}) {
  const had = !!active;
  active = null;
  pendingFit = false;
  jpShape = null;
  jpToken++;
  overlayKey = '';
  if (overlay) overlay.clearLayers();
  setLineHighlight(null);
  if (!keepChip) hideChip();
  return had;
}

export function getActiveLine() {
  return active?.line ?? null;
}

/** ?linje=31 ved oppstart. Ruter og kjøretøy kommer senere; zoomen skjer når de er lastet. */
export function applyLineFromUrl() {
  const line = parseLineParam(window.location.search);
  if (line) selectLine(line);
}

function showChip(line) {
  if (!chipEl) return;
  chipEl.textContent = '';
  const dot = document.createElement('span');
  dot.className = 'line-chip-dot';
  dot.style.background = MODE_COLORS[line.mode] || '#888';
  const label = document.createElement('span');
  label.textContent = chipLabel(line);
  const x = document.createElement('span');
  x.className = 'line-chip-x';
  x.setAttribute('aria-hidden', 'true');
  x.textContent = '×';
  chipEl.append(dot, label, x);
  chipEl.title = `${modeLabel(line.mode)} ${line.code}. Fjern uthevingen`;
  chipEl.setAttribute('aria-label', `${chipLabel(line)}, fjern uthevingen`);
  chipEl.hidden = false;
  chipEl.closest('.stop-search-wrap')?.classList.add('has-line', 'search-expanded');
}

function hideChip() {
  if (!chipEl) return;
  chipEl.hidden = true;
  chipEl.closest('.stop-search-wrap')?.classList.remove('has-line');
}

/** Lager chip-knappen foran søkefeltet. */
export function initLineChip(wrap, input) {
  if (!wrap || !input || chipEl) return;
  chipEl = document.createElement('button');
  chipEl.type = 'button';
  chipEl.className = 'line-chip';
  chipEl.hidden = true;
  chipEl.addEventListener('click', () => clearLine());
  wrap.insertBefore(chipEl, input);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !active) return;
    const results = document.getElementById('stop-search-results');
    if (results && !results.hidden) return; // Escape lukker først resultatlista
    clearLine();
  });
}
