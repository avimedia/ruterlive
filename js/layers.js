import { setRoutesVisible } from './routes.js';

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

const STORAGE_KEY = 'ruterlive-panel-collapsed';

export function initLayers(callback) {
  onFilterChange = callback;

  const panel = document.getElementById('layers-panel');
  const toggleBtn = document.getElementById('panel-toggle');
  const controls = panel.querySelector('.layer-controls');

  // Gjenopprett minimert tilstand
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'true') {
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
    input.addEventListener('change', () => {
      const modes = getVisibleModes();
      onFilterChange?.(modes);
    });
  });

  // Info-buttons for T-bane og Trikk
  panel.querySelectorAll('.info-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const mode = btn.dataset.info;
      showInfoOverlay(INFO_TEXTS[mode] || '');
    });
  });

  // Rutelinjer-toggle
  const routesToggle = document.getElementById('routes-toggle');
  if (routesToggle) {
    routesToggle.addEventListener('change', () => {
      setRoutesVisible(routesToggle.checked);
      onFilterChange?.(getVisibleModes());
    });
  }

  // Lukk-overlay
  const overlay = document.getElementById('info-overlay');
  overlay?.querySelector('.overlay-close')?.addEventListener('click', () => hideInfoOverlay());
  overlay?.addEventListener('click', (e) => {
    if (e.target === overlay) hideInfoOverlay();
  });
}

function showInfoOverlay(text) {
  const overlay = document.getElementById('info-overlay');
  const textEl = document.getElementById('info-text');
  if (overlay && textEl) {
    textEl.textContent = text;
    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');
  }
}

function hideInfoOverlay() {
  const overlay = document.getElementById('info-overlay');
  if (overlay) {
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
    el.textContent = `Feil: ${error}`;
    return;
  }
  if (!counts || (counts.total ?? 0) === 0) {
    el.textContent = error ? `Feil: ${error}` : 'Henter kjøretøy og rutelinjer fra Entur…';
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
