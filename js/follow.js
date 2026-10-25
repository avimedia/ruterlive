/**
 * «Følg»-knapp: holder valgt kjøretøy midt i kartet.
 * Med animasjonsløkka (js/markers.js) flyttes kartet per bilde uten animasjon, slik at det følger
 * kontinuerlig; uten (redusert bevegelse, skjult fane) panoreres det ved hvert tikk (1 Hz).
 * Slås av når brukeren drar i kartet, ved fravalg og når kjøretøyet forsvinner.
 */

import L from 'leaflet';
import { getMap } from './map.js';
import { getMarkerLatLng, onMarkerTick, onAnimatedFrame, isAnimating } from './markers.js';

let btn = null;
let vehicleId = null;
let following = false;
let lastPanAt = 0;
const MIN_PAN_INTERVAL_MS = 900; // moveend etter panorering gir et ekstra tikk; ikke panorer på det
/** Per-bilde-panorering sender «move» hvert bilde, men «moveend» (tikk, rutelinjer, fliser på mobil) høyst så ofte. */
const MOVEEND_INTERVAL_MS = 1000;
let lastMoveEndAt = 0;
let moveEndPending = false;
let moveEndTimer = 0;

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

function fireMoveEnd(map) {
  moveEndPending = false;
  lastMoveEndAt = performance.now();
  map.fire('moveend');
}

/** Per bilde: flytt kartet så kjøretøyet står midt i, uten animasjon og uten moveend hvert bilde. */
function followFrame(pos) {
  if (!following || reducedMotion?.matches) return;
  const map = getMap();
  if (!map || map._animatingZoom || map._panAnim?._inProgress) return;
  const c = map.latLngToContainerPoint(pos);
  const size = map.getSize();
  const dx = Math.round(c.x - size.x / 2), dy = Math.round(c.y - size.y / 2);
  if (!dx && !dy) return;
  // Som panBy({ animate: false }), men moveend strupes (ellers kjøres hele tikket per bilde)
  map._rawPanBy(L.point(dx, dy));
  map.fire('move');
  moveEndPending = true;
  const now = performance.now();
  if (now - lastMoveEndAt >= MOVEEND_INTERVAL_MS) fireMoveEnd(map);
  else if (!moveEndTimer) {
    moveEndTimer = setTimeout(() => {
      moveEndTimer = 0;
      if (moveEndPending) fireMoveEnd(map);
    }, MOVEEND_INTERVAL_MS - (now - lastMoveEndAt));
  }
}

function setFollowing(on) {
  following = !!on && !!vehicleId;
  if (!following && moveEndTimer) {
    clearTimeout(moveEndTimer);
    moveEndTimer = 0;
    const map = getMap();
    if (moveEndPending && map) fireMoveEnd(map);
  }
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
    if (following && !isAnimating()) centreOnVehicle(true);
  });
  onAnimatedFrame(followFrame);
  render();
}
