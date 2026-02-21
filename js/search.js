/**
 * Søk etter holdeplasser. Bruker /api/stops-search.
 */

import { focusStopFromSearch } from './routes.js';

let debounceTimer = null;
const DEBOUNCE_MS = 250;
const MIN_QUERY_LEN = 2;

export function initStopSearch() {
  const input = document.getElementById('stop-search-input');
  const resultsEl = document.getElementById('stop-search-results');
  const wrap = document.getElementById('stop-search-wrap');
  if (!input || !resultsEl || !wrap) return;

  function hideResults() {
    resultsEl.hidden = true;
    resultsEl.innerHTML = '';
    resultsEl.removeAttribute('aria-expanded');
  }

  function showResults(items) {
    resultsEl.innerHTML = items
      .map(
        (s) =>
          `<li role="option" tabindex="-1" data-id="${escapeAttr(s.id)}" data-lat="${s.lat}" data-lon="${s.lon}" data-name="${escapeAttr(s.name)}">${escapeHtml(s.name)}</li>`
      )
      .join('');
    resultsEl.hidden = false;
    resultsEl.setAttribute('aria-expanded', 'true');
  }

  function escapeAttr(s) {
    const d = document.createElement('div');
    d.textContent = s ?? '';
    return d.innerHTML.replace(/"/g, '&quot;');
  }

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s ?? '';
    return d.innerHTML;
  }

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const q = input.value.trim();
    if (q.length < MIN_QUERY_LEN) {
      hideResults();
      return;
    }
    debounceTimer = setTimeout(() => {
      fetch(`/api/stops-search?q=${encodeURIComponent(q)}&limit=15`)
        .then((r) => (r.ok ? r.json() : []))
        .then((stops) => {
          if (stops?.length) {
            showResults(stops);
          } else {
            resultsEl.innerHTML = '<li class="stop-search-empty">Ingen treff</li>';
            resultsEl.hidden = false;
            resultsEl.setAttribute('aria-expanded', 'true');
          }
        })
        .catch(() => hideResults());
    }, DEBOUNCE_MS);
  });

  input.addEventListener('focus', () => {
    if (resultsEl.innerHTML && !resultsEl.hidden) return;
    const q = input.value.trim();
    if (q.length >= MIN_QUERY_LEN) {
      fetch(`/api/stops-search?q=${encodeURIComponent(q)}&limit=15`)
        .then((r) => (r.ok ? r.json() : []))
        .then((stops) => (stops?.length ? showResults(stops) : hideResults()))
        .catch(() => {});
    }
  });

  resultsEl.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-id]');
    if (!li || li.classList.contains('stop-search-empty')) return;
    const id = li.dataset.id;
    const lat = parseFloat(li.dataset.lat);
    const lon = parseFloat(li.dataset.lon);
    const name = li.dataset.name;
    if (id && !isNaN(lat) && !isNaN(lon)) {
      focusStopFromSearch(id, lat, lon, name);
      input.value = '';
      hideResults();
      input.blur();
    }
  });

  resultsEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const selected = resultsEl.querySelector('li[data-id].highlighted, li[data-id]:first-child');
    if (selected) selected.click();
  });

  // Lukk resultater ved klikk utenfor
  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) hideResults();
  });

  input.addEventListener('blur', () => {
    // Delay for å la klikk på resultat registreres
    setTimeout(hideResults, 150);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideResults();
      input.blur();
    }
  });
}
