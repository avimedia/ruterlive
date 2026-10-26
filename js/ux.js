/**
 * UX-forbedringer: delingslenke, lastestatus, brukertips, tastaturnavigasjon, PWA.
 */

import L from 'leaflet';
import { getMap } from './map.js';
import { restoreView, initViewMemory } from './view-memory.js';
import { applyLineFromUrl, getActiveLine } from './line-search.js';

const TIP_KEY = 'ruterlive-tip-seen';

const SHARE_ICON =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 3v12"/><path d="m7.5 7.5 4.5-4.5 4.5 4.5"/><path d="M8 10.5H6.5A1.5 1.5 0 0 0 5 12v7.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V12a1.5 1.5 0 0 0-1.5-1.5H16"/></svg>';
const CHECK_ICON =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';

let toastTimer = null;
function shareToast(msg) {
  const el = document.getElementById('tip-toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('tip-toast-fade');
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.add('tip-toast-fade');
    toastTimer = setTimeout(() => {
      el.hidden = true;
      el.classList.remove('tip-toast-fade');
    }, 400);
  }, 2000);
}

/** Lenke til kartvisningen: midtpunkt, zoom og uthevet linje (?linje=). */
function viewUrl() {
  const map = getMap();
  const params = new URLSearchParams();
  if (map) {
    const c = map.getCenter();
    params.set('lat', c.lat.toFixed(5));
    params.set('lng', c.lng.toFixed(5));
    params.set('z', String(map.getZoom()));
  }
  const line = getActiveLine();
  if (line?.code) params.set('linje', line.code);
  const qs = params.toString();
  return window.location.origin + window.location.pathname + (qs ? `?${qs}` : '');
}

/** Delingsknappen: delingsarket der nettleseren har det (mobil), ellers kopier lenken. */
export function initShareLink() {
  const btn = document.getElementById('share-link-btn');
  if (!btn) return;
  // Knappen ligger inne i kartelementet: klikk skal ikke nå kartet (det fjerner valgt kjøretøy)
  L.DomEvent.disableClickPropagation(btn);
  btn.innerHTML = SHARE_ICON;

  btn.addEventListener('click', async () => {
    const url = viewUrl();
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'livetrafikk.no – sanntidskart', url });
        return;
      } catch (e) {
        if (e?.name === 'AbortError') return; // brukeren lukket delingsarket
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      btn.innerHTML = CHECK_ICON;
      shareToast('Lenken er kopiert');
      setTimeout(() => {
        btn.innerHTML = SHARE_ICON;
      }, 1500);
    } catch {
      shareToast('Kunne ikke kopiere lenken');
    }
  });
}

let loadingApi = null;

export function initLoadingIndicator() {
  const el = document.getElementById('loading-indicator');
  if (!el) return;
  loadingApi = {
    show: (msg = 'Laster…') => {
      el.textContent = msg;
      el.hidden = false;
    },
    hide: () => {
      el.hidden = true;
    },
  };
  return loadingApi;
}

export function getLoadingIndicator() {
  return loadingApi;
}

export function initTipToast() {
  const el = document.getElementById('tip-toast');
  if (!el) return;

  if (localStorage.getItem(TIP_KEY)) return;

  const show = () => {
    el.textContent = 'Tips: Klikk på et kjøretøy for å se ruten';
    el.hidden = false;
    localStorage.setItem(TIP_KEY, '1');
    setTimeout(() => {
      el.classList.add('tip-toast-fade');
      setTimeout(() => {
        el.hidden = true;
        el.classList.remove('tip-toast-fade');
      }, 400);
    }, 3500);
  };

  setTimeout(show, 2000);
}

export function initKeyboardNav() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const overlay = document.getElementById('info-overlay');
      if (overlay && !overlay.classList.contains('hidden')) {
        overlay.querySelector('.overlay-close')?.click();
      }
    }
  });
}

export function initPwa() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

export function applyUrlParams() {
  const params = new URLSearchParams(window.location.search);
  const lat = params.get('lat');
  const lng = params.get('lng');
  const z = params.get('z');
  const map = getMap();
  if (map && !(lat && lng)) restoreView(map); // URL-parametre går alltid foran husket utsnitt
  if (map) initViewMemory(map);
  if (map && lat && lng) {
    const numLat = parseFloat(lat);
    const numLng = parseFloat(lng);
    if (!isNaN(numLat) && !isNaN(numLng)) {
      map.setView([numLat, numLng], z ? parseInt(z, 10) : map.getZoom());
    }
  }
  applyLineFromUrl(); // ?linje=31
}
