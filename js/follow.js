/**
 * «Følg»-knapp: holder valgt kjøretøy midt i kartet ved hvert tikk (1 Hz).
 * Slås av når brukeren drar i kartet, ved fravalg og når kjøretøyet forsvinner.
 */

import L from 'leaflet';
import { getMap } from './map.js';
import { getMarkerLatLng, onMarkerTick } from './markers.js';

let btn = null;
let vehicleId = null;
let following = false;
let lastPanAt = 0;
const MIN_PAN_INTERVAL_MS = 900; // moveend etter panorering gir et ekstra tikk; ikke panorer på det

const reducedMotion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

function render() {
  if (!btn) return;
  btn.hidden = !vehicleId;
  btn.setAttribute('aria-pressed', following ? 'true' : 'false');
  btn.classList.toggle('active', following);
  btn.title = following ? 'Slutt å følge kjøretøyet' : 'Følg kjøretøyet på kartet';
}

function centreOnVehicle(animate, force = false) {
  const now = performance.now();
  if (!force && now - lastPanAt < MIN_PAN_INTERVAL_MS) return;
  const map = getMap();
  const ll = vehicleId ? getMarkerLatLng(vehicleId) : null;
  if (!map || !ll) {
    setFollowing(false);
    return;
  }
  const c = map.latLngToContainerPoint(ll);
  const size = map.getSize();
  if (Math.abs(c.x - size.x / 2) < 1 && Math.abs(c.y - size.y / 2) < 1) return;
  lastPanAt = now;
  // Kort, lineær panorering som rekker å bli ferdig før neste tikk
  map.panTo(ll, animate && !reducedMotion?.matches
    ? { animate: true, duration: 0.6, easeLinearity: 1, noMoveStart: true }
    : { animate: false });
}

function setFollowing(on) {
  following = !!on && !!vehicleId;
  render();
  if (following) centreOnVehicle(true, true);
}

/** Valgt kjøretøy (null = ingen). Nytt eller intet valg slår av følging. */
export function setFollowVehicle(id) {
  const next = id || null;
  if (next !== vehicleId) following = false;
  vehicleId = next;
  render();
}

export function isFollowing() {
  return following;
}

export function initFollowButton() {
  btn = document.getElementById('follow-btn');
  const map = getMap();
  if (!btn || !map) return;
  // Knappen ligger inne i kartelementet: klikk skal ikke nå kartet (det lukker popupen og fjerner valget)
  L.DomEvent.disableClickPropagation(btn);
  btn.addEventListener('click', () => setFollowing(!following));
  // Bare brukerens egne dra-bevegelser (panTo gir ikke dragstart)
  map.on('dragstart', () => {
    if (following) setFollowing(false);
  });
  onMarkerTick(() => {
    if (following) centreOnVehicle(true);
  });
  render();
}
