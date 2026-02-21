import { setRoutesVisible } from './routes.js';

const MODE_CONFIG = {
  bus: { label: 'Buss', key: 'bus' },
  flybuss: { label: 'Flybuss', key: 'flybuss' },
  metro: { label: 'T-bane', key: 'metro' },
  tram: { label: 'Trikk', key: 'tram' },
  water: { label: 'Båt', key: 'water' },
  rail: { label: 'Tog', key: 'rail' },
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

export function initLayers(callback) {
  onFilterChange = callback;

  const panel = document.getElementById('layers-panel');
  const controls = panel.querySelector('.layer-controls');

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

  if (error) {
    el.textContent = `Feil: ${error}`;
    el.title = 'Sjekk nettleserkonsollen (F12) for detaljer';
    return;
  }

  el.title = '';
  if (!counts) {
    el.textContent = 'Henter kjøretøy og rutelinjer fra Entur…';
    return;
  }

  const total = counts.total ?? 0;
  const parts = [];
  if (counts.bus > 0) parts.push(`${counts.bus} buss`);
  if (counts.flybuss > 0) parts.push(`${counts.flybuss} flybuss`);
  if (counts.metro > 0) parts.push(`${counts.metro} T-bane`);
  if (counts.tram > 0) parts.push(`${counts.tram} trikk`);
  if (counts.water > 0) parts.push(`${counts.water} båt`);
  if (counts.rail > 0) parts.push(`${counts.rail} tog`);

  let text = parts.length > 0 ? `${total} kjøretøy: ${parts.join(', ')}` : `${total} kjøretøy`;
  if (routesLoading) text += ' · Rutelinjer lastes…';
  el.textContent = text;
}
