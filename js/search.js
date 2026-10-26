/**
 * Søk etter holdeplasser. Bruker /api/stops-search.
 */

import { focusStopFromSearch } from './routes.js';
import { searchLines, selectLine, initLineChip } from './line-search.js';
import { MODE_COLORS } from '../shared/line-list.js';
import { getMap } from './map.js';
import { lineBadgesHtml, formatDistance, escapeHtml } from './stop-place-format.js';

let debounceTimer = null;
const DEBOUNCE_MS = 250;
const MIN_QUERY_LEN = 2;

export function initStopSearch() {
  const input = document.getElementById('stop-search-input');
  const resultsEl = document.getElementById('stop-search-results');
  const wrap = document.getElementById('stop-search-wrap');
  const trigger = wrap?.querySelector('.stop-search-trigger');
  if (!input || !resultsEl || !wrap) return;
  initLineChip(wrap, input);
  let currentLines = [];

  if (trigger) {
    trigger.addEventListener('click', () => {
      wrap.classList.add('search-expanded');
      trigger.setAttribute('aria-expanded', 'true');
      input.focus();
    });
    input.addEventListener('blur', () => {
      setTimeout(() => {
        const hasResults = resultsEl.querySelector('li[data-id]');
        if (!input.value.trim() && !hasResults && !wrap.classList.contains('has-line')) {
          wrap.classList.remove('search-expanded');
          trigger.setAttribute('aria-expanded', 'false');
          resultsEl.hidden = true;
          resultsEl.innerHTML = '';
        }
      }, 150);
    });
    input.addEventListener('focus', () => {
      wrap.classList.add('search-expanded');
      trigger.setAttribute('aria-expanded', 'true');
    });
  }

  function hideResults() {
    resultsEl.hidden = true;
    resultsEl.innerHTML = '';
    resultsEl.removeAttribute('aria-expanded');
  }

  function linesHtml(lines, withStopsHeading) {
    if (!lines.length) return '';
    return (
      '<li class="stop-search-heading" role="presentation">Linjer</li>' +
      lines
        .map(
          (l, i) =>
            `<li role="option" tabindex="-1" class="line-result" data-line="${i}"><span class="line-badge" style="background:${MODE_COLORS[l.mode] || '#888'}">${escapeHtml(l.code)}</span>${escapeHtml(l.title)}</li>`
        )
        .join('') +
      (withStopsHeading ? '<li class="stop-search-heading" role="presentation">Holdeplasser</li>' : '')
    );
  }

  function placeHtml(s) {
    const name = s.name || s.displayName || 'Holdeplass';
    const quayIds = (s.quays?.length ? s.quays.map((q) => q.id) : [s.id]).filter(Boolean);
    const badges = lineBadgesHtml(s.lines, { max: 12 });
    const dist = formatDistance(s.distanceKm);
    return `<li role="option" tabindex="-1" class="stop-result" data-id="${escapeHtml(quayIds.join(','))}" data-lat="${s.lat}" data-lon="${s.lon}" data-name="${escapeHtml(name)}">` +
      `<span class="stop-result-top"><span class="stop-result-name">${escapeHtml(name)}${s.locality ? `<span class="stop-result-locality"> · ${escapeHtml(s.locality)}</span>` : ''}</span>` +
      `${dist ? `<span class="stop-result-dist">${dist}</span>` : ''}</span>` +
      `${badges ? `<span class="stop-result-lines">${badges}</span>` : ''}</li>`;
  }

  function showResults(items, lines = currentLines) {
    const heading = linesHtml(lines, items.length > 0);
    resultsEl.innerHTML = heading + items.map(placeHtml).join('');
    resultsEl.hidden = false;
    resultsEl.setAttribute('aria-expanded', 'true');
  }

  /** Kartets midtpunkt, så nærmeste stoppested med samme navn kommer først. */
  function searchUrl(q) {
    const c = getMap()?.getCenter?.();
    const pos = c ? `&lat=${c.lat.toFixed(3)}&lng=${c.lng.toFixed(3)}` : '';
    return `/api/stops-search?q=${encodeURIComponent(q)}${pos}`;
  }

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const q = input.value.trim();
    currentLines = q ? searchLines(q) : [];
    if (q.length < MIN_QUERY_LEN) {
      if (currentLines.length) showResults([]);
      else hideResults();
      return;
    }
    if (currentLines.length) showResults([]); // linjene vises straks, holdeplassene kommer etter hentingen
    debounceTimer = setTimeout(() => {
      fetch(searchUrl(q))
        .then((r) => (r.ok ? r.json() : []))
        .then((stops) => {
          if (input.value.trim() !== q) return;
          if (stops?.length) {
            showResults(stops);
          } else if (currentLines.length) {
            showResults([]);
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
      fetch(searchUrl(q))
        .then((r) => (r.ok ? r.json() : []))
        .then((stops) => (stops?.length ? showResults(stops) : hideResults()))
        .catch(() => {});
    }
  });

  resultsEl.addEventListener('click', (e) => {
    // Treffet fjernes fra DOM-en under klikket; uten dette tolker Leaflet klikket som et kartklikk
    // og lukker popupen som nettopp ble åpnet
    e.stopPropagation();
    const lineLi = e.target.closest('li[data-line]');
    if (lineLi) {
      const line = currentLines[Number(lineLi.dataset.line)];
      if (line) {
        selectLine(line);
        input.value = '';
        hideResults();
        input.blur();
      }
      return;
    }
    const li = e.target.closest('li[data-id]');
    if (!li || li.classList.contains('stop-search-empty')) return;
    const ids = (li.dataset.id || '').split(',').filter(Boolean);
    const lat = parseFloat(li.dataset.lat);
    const lon = parseFloat(li.dataset.lon);
    const name = li.dataset.name;
    if (ids.length && !isNaN(lat) && !isNaN(lon)) {
      focusStopFromSearch(ids, lat, lon, name);
      input.value = '';
      hideResults();
      input.blur();
    }
  });

  resultsEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const selected = resultsEl.querySelector('li.highlighted') || resultsEl.querySelector('li[data-id], li[data-line]');
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
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const items = [...resultsEl.querySelectorAll('li[data-id], li[data-line]')];
      if (resultsEl.hidden || !items.length) return;
      e.preventDefault();
      const cur = items.findIndex((li) => li.classList.contains('highlighted'));
      const next = e.key === 'ArrowDown' ? (cur + 1) % items.length : (cur - 1 + items.length) % items.length;
      items.forEach((li, i) => li.classList.toggle('highlighted', i === next));
      items[next].scrollIntoView({ block: 'nearest' });
      return;
    }
    if (e.key === 'Enter') {
      const sel = resultsEl.querySelector('li.highlighted') || resultsEl.querySelector('li[data-id], li[data-line]');
      if (sel && !resultsEl.hidden) {
        e.preventDefault();
        sel.click();
      }
    }
  });
}
