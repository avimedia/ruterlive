/**
 * UX-forbedringer: delingslenke, lastestatus, brukertips, tastaturnavigasjon, PWA.
 */

import { getMap } from './map.js';

const TIP_KEY = 'ruterlive-tip-seen';

export function initShareLink() {
  const btn = document.getElementById('share-link-btn');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    const map = getMap();
    let url = window.location.origin + window.location.pathname;
    if (map) {
      const c = map.getCenter();
      const z = map.getZoom();
      const params = new URLSearchParams();
      params.set('lat', c.lat.toFixed(5));
      params.set('lng', c.lng.toFixed(5));
      params.set('z', String(z));
      url += '?' + params.toString();
    }
    try {
      await navigator.clipboard.writeText(url);
      btn.textContent = '✓';
      btn.title = 'Lagt inn i utklippstavle';
      setTimeout(() => {
        btn.textContent = '📋';
        btn.title = 'Kopier lenke til kartvisning';
      }, 1500);
    } catch {
      btn.title = 'Kopier lenke (ikke støttet)';
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
      const about = document.getElementById('about-content');
      if (about && !about.hidden) {
        document.getElementById('about-toggle')?.click();
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
  if (map && lat && lng) {
    const numLat = parseFloat(lat);
    const numLng = parseFloat(lng);
    if (!isNaN(numLat) && !isNaN(numLng)) {
      map.setView([numLat, numLng], z ? parseInt(z, 10) : map.getZoom());
    }
  }
}
