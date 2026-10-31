/**
 * Fast linje nederst for valgt kjøretøy: linje, destinasjon, «Følg» og lukk.
 * Ligger utenfor kartet, så valget kan avsluttes uten å lete opp kjøretøyet og popupen.
 */

import L from 'leaflet';
import { getMap } from './map.js';
import { getMarkerLatLng, vehicleModeClass } from './markers.js';
import { MODE_COLORS } from '../shared/line-list.js';

const DARK_TEXT_COLORS = new Set(['#e9c46a']);

let bar = null;
let badge = null;
let dest = null;
let vehicleId = null;

/** Viser linja for valgt kjøretøy, eller skjuler den (null). */
export function setVehicleBarVehicle(v) {
  if (!bar) return;
  vehicleId = v?.vehicleId ?? null;
  bar.hidden = !vehicleId;
  document.body.classList.toggle('has-vehicle-bar', !!vehicleId);
  if (!vehicleId) return;
  const color = MODE_COLORS[vehicleModeClass(v)] || '#888';
  badge.textContent = v.line?.publicCode || '?';
  badge.style.background = color;
  badge.classList.toggle('vehicle-bar-badge--dark', DARK_TEXT_COLORS.has(color));
  dest.textContent = v.destinationName || v.to || '';
}

export function initVehicleBar() {
  bar = document.getElementById('vehicle-bar');
  if (!bar) return;
  badge = bar.querySelector('.vehicle-bar-badge');
  dest = bar.querySelector('.vehicle-bar-dest');
  // Ligger inne i kartelementet: klikk skal ikke nå kartet
  L.DomEvent.disableClickPropagation(bar);
  L.DomEvent.disableScrollPropagation(bar);
  // Én gang til kjøretøyet (ikke følging)
  bar.querySelector('.vehicle-bar-show').addEventListener('click', () => {
    const map = getMap();
    const ll = vehicleId ? getMarkerLatLng(vehicleId) : null;
    if (map && ll) map.panTo(ll);
  });
  // Å lukke popupen avslutter valget (popupclose → onVehicleDeselect i main.js)
  bar.querySelector('.vehicle-bar-close').addEventListener('click', () => getMap()?.closePopup());
}
