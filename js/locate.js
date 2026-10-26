/**
 * «Finn meg»: viser brukerens posisjon som blå prikk med nøyaktighetssirkel.
 */
import L from 'leaflet';
import { getMap } from './map.js';

const MIN_ZOOM = 15;
let watchId = null;
let dot = null;
let circle = null;
let centered = false;
let hideTimer = null;
let fadeTimer = null;

function toast(msg) {
  const el = document.getElementById('tip-toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('tip-toast-fade');
  el.hidden = false;
  clearTimeout(hideTimer);
  clearTimeout(fadeTimer);
  hideTimer = setTimeout(() => {
    el.classList.add('tip-toast-fade');
    fadeTimer = setTimeout(() => {
      el.hidden = true;
      el.classList.remove('tip-toast-fade');
    }, 400);
  }, 3000);
}

function stop(btn) {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  centered = false;
  dot?.remove();
  circle?.remove();
  dot = circle = null;
  btn.classList.remove('active');
  btn.setAttribute('aria-pressed', 'false');
}

function onPosition(pos) {
  const map = getMap();
  if (!map) return;
  const ll = [pos.coords.latitude, pos.coords.longitude];
  const acc = pos.coords.accuracy || 0;
  if (!dot) {
    circle = L.circle(ll, { radius: acc, interactive: false, color: '#2b7fff', weight: 1, fillColor: '#2b7fff', fillOpacity: 0.12 }).addTo(map);
    dot = L.circleMarker(ll, { radius: 7, interactive: false, color: '#fff', weight: 2.5, fillColor: '#2b7fff', fillOpacity: 1 }).addTo(map);
  } else {
    dot.setLatLng(ll);
    circle.setLatLng(ll).setRadius(acc);
  }
  if (!centered) {
    centered = true;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    map.setView(ll, Math.max(map.getZoom(), MIN_ZOOM), { animate: !reduce });
  }
}

export function initLocate() {
  const btn = document.getElementById('locate-btn');
  if (!btn) return;
  if (!('geolocation' in navigator) || !window.isSecureContext) {
    btn.hidden = true;
    return;
  }
  L.DomEvent.disableClickPropagation(btn);

  btn.addEventListener('click', () => {
    if (watchId != null) {
      stop(btn);
      return;
    }
    btn.classList.add('active');
    btn.setAttribute('aria-pressed', 'true');
    // Første fix fra watchPosition fungerer som getCurrentPosition og sentrerer kartet
    watchId = navigator.geolocation.watchPosition(
      onPosition,
      () => {
        stop(btn);
        toast('Posisjon er ikke tilgjengelig');
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 5000 },
    );
  });
}
