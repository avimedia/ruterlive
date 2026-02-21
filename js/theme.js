/**
 * Tema: Lys / Mørk / Følg system.
 * Lager ruterlive-theme i localStorage.
 */

import { setMapTheme } from './map.js';
import { refreshRouteHighlightTheme } from './routes.js';

const STORAGE_KEY = 'ruterlive-theme';

function getEffectiveTheme(preference) {
  if (preference === 'light' || preference === 'dark') return preference;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(effective) {
  document.documentElement.dataset.theme = effective;
  refreshRouteHighlightTheme();
  const meta = document.getElementById('theme-color-meta');
  if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--theme-color').trim() || (effective === 'light' ? '#f5f5f5' : '#1a1a1a');
  setMapTheme(effective);
}

export function initTheme() {
  const select = document.getElementById('theme-select');
  if (!select) return;

  const stored = localStorage.getItem(STORAGE_KEY) || 'system';
  select.value = stored;

  // Sync select med faktisk data-theme (satt av inline script)
  const current = document.documentElement.dataset.theme || getEffectiveTheme(stored);
  applyTheme(current);

  select.addEventListener('change', () => {
    const preference = select.value;
    localStorage.setItem(STORAGE_KEY, preference);
    const effective = getEffectiveTheme(preference);
    applyTheme(effective);
  });

  // Når bruker har "system": reager på endring av OS-tema
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (localStorage.getItem(STORAGE_KEY) === 'system') {
      const effective = getEffectiveTheme('system');
      applyTheme(effective);
    }
  });
}
