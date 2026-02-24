import { setRoutesVisible } from './routes.js';
import { setOpenRailwayMapVisible, isOpenRailwayMapVisible } from './map.js';

const MODE_CONFIG = {
  bus: { label: 'Buss', key: 'bus' },
  flybuss: { label: 'Flybuss', key: 'flybuss' },
  metro: { label: 'T-bane', key: 'metro' },
  tram: { label: 'Trikk', key: 'tram' },
  water: { label: 'Båt', key: 'water' },
  rail: { label: 'Regiontog', key: 'rail' },
  flytog: { label: 'Flytoget', key: 'flytog' },
};

const INFO_TEXTS = {
  bus:
    'Buss vises med beregnet posisjon basert på avgangsdata fra Entur. Ruter leverer ikke GPS-posisjoner til Entur, så vi estimerer hvor bussene er mellom stoppestedene ut fra planlagte og forventede avgangstider. Posisjonen er derfor omtrentlig.',
  metro:
    'T-bane vises med beregnet posisjon basert på avgangsdata fra Entur. Ruter leverer ikke GPS-posisjoner til Entur, så vi estimerer hvor togene er mellom stoppestedene ut fra planlagte og forventede avgangstider. Posisjonen er derfor omtrentlig.',
  tram:
    'Trikk vises med beregnet posisjon basert på avgangsdata fra Entur. Ruter leverer ikke GPS-posisjoner til Entur, så vi estimerer hvor trikkene er mellom stoppestedene ut fra planlagte og forventede avgangstider. Posisjonen er derfor omtrentlig.',
};

let onFilterChange = null;
let infoOverlayTrigger = null;
let onRetry = null;

const STORAGE_KEY = 'ruterlive-panel-collapsed';

export function setRetryHandler(fn) {
  onRetry = fn;
}

export function initLayers(callback) {
  onFilterChange = callback;

  const panel = document.getElementById('layers-panel');
  const toggleBtn = document.getElementById('panel-toggle');
  const controls = panel.querySelector('.layer-controls');

  // Hindre at klikk i panelet trigger kartet (zoom, clearSelection osv.)
  panel.addEventListener('click', (e) => e.stopPropagation());

  // Gjenopprett minimert tilstand; på mobil start minimert hvis ingen lagret preferanse
  const saved = localStorage.getItem(STORAGE_KEY);
  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 480;
  const startCollapsed = saved === 'true' || (isMobile && saved === null);
  if (startCollapsed) {
    panel.classList.add('collapsed');
    toggleBtn.textContent = '+';
    toggleBtn.setAttribute('aria-label', 'Utvid panel');
    toggleBtn.setAttribute('aria-expanded', 'false');
  }

  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const collapsed = panel.classList.toggle('collapsed');
    localStorage.setItem(STORAGE_KEY, String(collapsed));
    toggleBtn.textContent = collapsed ? '+' : '−';
    toggleBtn.setAttribute('aria-label', collapsed ? 'Utvid panel' : 'Minimer panel');
    toggleBtn.setAttribute('aria-expanded', String(!collapsed));
  });

  panel.querySelector('.panel-header')?.addEventListener('click', (e) => {
    if (e.target === toggleBtn || toggleBtn.contains(e.target)) return;
    if (panel.classList.contains('collapsed')) {
      panel.classList.remove('collapsed');
      localStorage.setItem(STORAGE_KEY, 'false');
      toggleBtn.textContent = '−';
      toggleBtn.setAttribute('aria-label', 'Minimer panel');
      toggleBtn.setAttribute('aria-expanded', 'true');
    }
  });

  controls.querySelectorAll('input[data-mode]').forEach((input) => {
    input.addEventListener('change', (e) => {
      e.stopPropagation();
      const modes = getVisibleModes();
      onFilterChange?.(modes);
    });
    input.addEventListener('click', (e) => e.stopPropagation());
  });

  // Info-buttons for T-bane og Trikk
  panel.querySelectorAll('.info-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const mode = btn.dataset.info;
      showInfoOverlay(INFO_TEXTS[mode] || '', btn);
    });
  });

  // Rutelinjer-toggle
  const routesToggle = document.getElementById('routes-toggle');
  if (routesToggle) {
    routesToggle.addEventListener('change', (e) => {
      e.stopPropagation();
      setRoutesVisible(routesToggle.checked);
      onFilterChange?.(getVisibleModes());
    });
    routesToggle.addEventListener('click', (e) => e.stopPropagation());
  }

  // OpenRailwayMap-toggle (jernbanekart)
  const ormToggle = document.getElementById('openrailwaymap-toggle');
  if (ormToggle) {
    ormToggle.checked = localStorage.getItem('ruterlive-openrailwaymap') !== 'false';
    ormToggle.addEventListener('change', (e) => {
      e.stopPropagation();
      setOpenRailwayMapVisible(ormToggle.checked);
    });
    ormToggle.addEventListener('click', (e) => e.stopPropagation());
  }

  // Lukk-overlay
  const overlay = document.getElementById('info-overlay');
  overlay?.querySelector('.overlay-close')?.addEventListener('click', () => hideInfoOverlay());
  overlay?.addEventListener('click', (e) => {
    if (e.target === overlay) hideInfoOverlay();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay && !overlay.classList.contains('hidden')) hideInfoOverlay();
  });
}

function showInfoOverlay(text, triggerEl) {
  const overlay = document.getElementById('info-overlay');
  const textEl = document.getElementById('info-text');
  if (overlay && textEl) {
    infoOverlayTrigger = triggerEl || null;
    textEl.textContent = text;
    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');
  }
}

function hideInfoOverlay() {
  const overlay = document.getElementById('info-overlay');
  if (overlay) {
    // Flytt fokus ut av overlay før aria-hidden – unngår a11y-advarsel
    if (infoOverlayTrigger?.focus) {
      infoOverlayTrigger.focus();
    } else {
      document.getElementById('panel-toggle')?.focus();
    }
    overlay.classList.add('hidden');
    overlay.setAttribute('aria-hidden', 'true');
  }
}

export function getVisibleModes() {
  const modes = new Set();
  document
    .querySelectorAll('.layer-controls input[data-mode]:not([disabled]):checked')
    .forEach((input) => {
      modes.add(input.dataset.mode);
    });
  return modes;
}

export function updateVehicleCount(counts, error, routesLoading = false) {
  const el = document.getElementById('vehicle-count');
  if (!el) return;

  el.title = error ? 'Sjekk nettleserkonsollen (F12) for detaljer' : '';
  if (error && (!counts || (counts.total ?? 0) === 0)) {
    el.innerHTML = '';
    const txt = document.createTextNode(`Feil: ${error}`);
    el.appendChild(txt);
    if (typeof onRetry === 'function') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'retry-btn';
      btn.textContent = 'Prøv igjen';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        onRetry();
      });
      el.appendChild(document.createTextNode(' '));
      el.appendChild(btn);
    }
    return;
  }
  if (!counts || (counts.total ?? 0) === 0) {
    if (error && typeof onRetry === 'function') {
      el.innerHTML = '';
      el.appendChild(document.createTextNode(`Feil: ${error} `));
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'retry-btn';
      btn.textContent = 'Prøv igjen';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        onRetry();
      });
      el.appendChild(btn);
    } else {
      el.textContent = error ? `Feil: ${error}` : 'Henter kjøretøy og rutelinjer fra Entur…';
    }
    return;
  }

  const total = counts.total ?? 0;
  const parts = [];
  if (counts.bus > 0) parts.push(`${counts.bus} buss`);
  if (counts.flybuss > 0) parts.push(`${counts.flybuss} flybuss`);
  if (counts.metro > 0) parts.push(`${counts.metro} T-bane`);
  if (counts.tram > 0) parts.push(`${counts.tram} trikk`);
  if (counts.water > 0) parts.push(`${counts.water} båt`);
  if (counts.rail > 0) parts.push(`${counts.rail} regiontog`);
  if (counts.flytog > 0) parts.push(`${counts.flytog} flytog`);

  let text = parts.length > 0 ? `${total} kjøretøy: ${parts.join(', ')}` : `${total} kjøretøy`;
  if (routesLoading) text += ' · Rutelinjer lastes…';
  if (error) text += ' · Oppdatering feilet';
  el.textContent = text;
}
