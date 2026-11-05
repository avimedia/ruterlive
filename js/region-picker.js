/**
 * Regionvelger i kartmenyen og valg av startregion (lagret valg, tillatt posisjon).
 */
import { clientVisibleRegions, chooseStartRegion, currentRegion, readStoredRegion, regionForPosition, switchRegion } from './region.js';
import { findRegion } from '../shared/regions.js';

function goTo(path) {
  globalThis.location.assign(path + globalThis.location.search + globalThis.location.hash);
}

/** Bytter region hvis posisjonen ligger i en annen synlig region. Brukeren trykket selv, så valget lagres. */
export function switchRegionForPosition(lat, lon, beforeSwitch) {
  const target = regionForPosition(lat, lon, currentRegion());
  if (!target) return false;
  beforeSwitch?.();
  switchRegion(target);
  return true;
}

/** Kjøres ved oppstart på kartsiden. Spør aldri om posisjon selv. */
export function initStartRegion() {
  const pathname = globalThis.location.pathname;
  const sync = chooseStartRegion({ pathname, stored: readStoredRegion(), permission: 'prompt', position: null });
  if (sync) {
    goTo(sync);
    return;
  }
  const storedRegion = findRegion(readStoredRegion());
  if ((storedRegion && clientVisibleRegions().includes(storedRegion)) || clientVisibleRegions().length < 2) return;
  if (!navigator.permissions?.query || !navigator.geolocation) return;
  let query;
  try {
    query = navigator.permissions.query({ name: 'geolocation' });
  } catch {
    return;
  }
  query.then((status) => {
    if (status.state !== 'granted') return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const path = chooseStartRegion({
          pathname,
          stored: null,
          permission: 'granted',
          position: { lat: pos.coords.latitude, lon: pos.coords.longitude },
        });
        if (path) goTo(path);
      },
      () => {},
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 },
    );
  }).catch(() => {});
}

/** Fyller og kobler <select id="region-select">; skjult når bare én region er synlig. */
export function initRegionPicker() {
  const select = document.getElementById('region-select');
  const wrap = document.getElementById('region-select-wrap');
  if (!select || !wrap) return;
  const regions = clientVisibleRegions();
  if (regions.length < 2) {
    wrap.hidden = true;
    return;
  }
  for (const r of regions) {
    const opt = document.createElement('option');
    opt.value = r.id;
    opt.textContent = r.name;
    select.appendChild(opt);
  }
  select.value = currentRegion().id;
  select.addEventListener('change', () => {
    const target = regions.find((r) => r.id === select.value);
    if (target) switchRegion(target);
  });
  wrap.hidden = false;
}
