/**
 * Avviksknappen og -panelet på kartet (DOM). Data og kort-HTML kommer fra js/situations.js.
 * Trykk på et linjemerke uthever linja på kartet; Escape og lukkeknappen lukker, og fokus går tilbake til knappen.
 */

import L from 'leaflet';
import { getSituations, onSituationsChanged, badgeCount, situationCardHtml, initSituations } from './situations.js';
import { findSituationLine, selectLine, onRegionLinesLoaded } from './line-search.js';
import { getMap } from './map.js';

let btn = null;
let countEl = null;
let panel = null;
let body = null;
let closeBtn = null;
let loaded = false;
let failed = false;
// Avvik med «Vis mer» åpent; beholdes når lista tegnes på nytt
const expanded = new Set();
// Under denne bredden lukker trykk på kartet panelet (som avgangstavla)
const MOBILE_QUERY = '(max-width: 1099px)';

const isOpen = () => Boolean(panel && !panel.hidden);

function updateButton(list) {
  const n = badgeCount(list);
  countEl.textContent = n ? String(n) : '';
  countEl.hidden = n === 0;
  btn.setAttribute('aria-label', loaded ? `Avvik (${n})` : 'Avvik');
  btn.title = loaded ? `Avvik (${n})` : 'Avvik';
}

function render() {
  const list = getSituations();
  if (!loaded) {
    body.innerHTML = failed ? '<p class="sit-empty">Fikk ikke hentet avvik nå.</p>' : '<p class="sit-empty">Henter avvik…</p>';
    return;
  }
  if (!list.length) {
    body.innerHTML = '<p class="sit-empty">Ingen avvik i området nå.</p>';
    return;
  }
  const now = Date.now();
  body.innerHTML = list.map((s) => situationCardHtml(s, { now })).join('');
  // Merker uten linje i kartets katalog eller blant live-linjene kan ikke utheves
  body.querySelectorAll('.sit-card').forEach((card, i) => {
    const s = list[i];
    card.dataset.index = String(i);
    if (expanded.has(s.id)) setExpanded(card, true);
    for (const b of card.querySelectorAll('.sit-line')) {
      const l = s.lines[Number(b.dataset.lineIndex)];
      if (!findSituationLine(l, s.codespace)) {
        b.disabled = true;
        b.removeAttribute('aria-label');
      }
    }
  });
}

function setExpanded(card, on) {
  const box = card.querySelector('.sit-more');
  const more = card.querySelector('.sit-more-btn');
  if (!box || !more) return;
  box.hidden = !on;
  more.setAttribute('aria-expanded', String(on));
  more.textContent = on ? 'Vis mindre' : 'Vis mer';
}

function open() {
  if (isOpen()) return;
  render();
  panel.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  body.scrollTop = 0;
  closeBtn.focus({ preventScroll: true });
}

/** focus: elementet som får fokus etter lukking (standard knappen). */
function close({ focus = btn } = {}) {
  if (!isOpen()) return;
  panel.hidden = true;
  btn.setAttribute('aria-expanded', 'false');
  focus?.focus({ preventScroll: true });
}

function onBodyClick(e) {
  const t = e.target;
  if (!(t instanceof Element)) return;
  const more = t.closest('.sit-more-btn');
  if (more) {
    const card = more.closest('.sit-card');
    const id = getSituations()[Number(card?.dataset.index)]?.id;
    const on = more.getAttribute('aria-expanded') !== 'true';
    setExpanded(card, on);
    if (id) {
      if (on) expanded.add(id);
      else expanded.delete(id);
    }
    return;
  }
  const badge = t.closest('.sit-line');
  if (!badge || badge.disabled) return;
  const s = getSituations()[Number(badge.closest('.sit-card')?.dataset.index)];
  const line = s && findSituationLine(s.lines[Number(badge.dataset.lineIndex)], s.codespace);
  if (!line) return;
  close({ focus: null });
  selectLine(line, { fitMap: true });
  // Fokus til linjebrikken (fjerner uthevingen), ellers knappen
  const chip = document.querySelector('.line-chip:not([hidden])');
  (chip || btn).focus({ preventScroll: true });
}

function buildPanel() {
  panel = document.createElement('section');
  panel.id = 'situations-panel';
  panel.className = 'situations-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'false');
  panel.setAttribute('aria-labelledby', 'situations-panel-title');
  panel.hidden = true;
  panel.innerHTML = `
    <header class="situations-panel-header">
      <h2 id="situations-panel-title" class="situations-panel-title">Avvik</h2>
      <button type="button" class="situations-panel-close" aria-label="Lukk avvik">×</button>
    </header>
    <div class="situations-panel-body"></div>
    <footer class="situations-panel-footer"><a href="/avvik">Alle avvik</a></footer>`;
  (document.getElementById('map-container') || document.body).appendChild(panel);
  body = panel.querySelector('.situations-panel-body');
  closeBtn = panel.querySelector('.situations-panel-close');
  // Panelet ligger over kartet: ikke la trykk, dra og rulling nå Leaflet
  for (const type of ['pointerdown', 'mousedown', 'touchstart', 'click', 'dblclick', 'contextmenu', 'wheel']) {
    panel.addEventListener(type, (e) => e.stopPropagation());
  }
  closeBtn.addEventListener('click', () => close());
  body.addEventListener('click', onBodyClick);
}

export function initSituationsPanel() {
  btn = document.getElementById('situations-btn');
  if (!btn) return;
  countEl = btn.querySelector('.situations-count');
  buildPanel();
  btn.setAttribute('aria-controls', 'situations-panel');
  btn.setAttribute('aria-expanded', 'false');
  // Trykk på knappen skal ikke nå kartet (velge bort kjøretøy, starte dra)
  L.DomEvent.disableClickPropagation(btn);
  L.DomEvent.disableScrollPropagation(panel);
  btn.addEventListener('click', () => (isOpen() ? close() : open()));
  getMap()?.on('click', () => {
    if (isOpen() && window.matchMedia?.(MOBILE_QUERY).matches) close();
  });
  // Bergen-katalogen lastes etter oppstart: merkene kan da bli trykkbare
  onRegionLinesLoaded(() => {
    if (isOpen()) render();
  });
  // Fanges før de andre Escape-lytterne (linjevalg, avgangstavle), så Escape bare lukker panelet
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !isOpen()) return;
    e.stopPropagation();
    close();
  }, true);
  onSituationsChanged((list) => {
    loaded = true;
    const ids = new Set(list.map((s) => s.id));
    for (const id of expanded) if (!ids.has(id)) expanded.delete(id);
    updateButton(list);
    if (isOpen()) render();
  });
  updateButton([]);
  initSituations({
    onError: () => {
      failed = true;
      if (isOpen()) render();
    },
  });
}
