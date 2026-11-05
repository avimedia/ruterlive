/**
 * Avviksknappen og -panelet på kartet (DOM). Data og kort-HTML kommer fra js/situations.js.
 * Trykk på et linjemerke uthever linja på kartet; Escape og lukkeknappen lukker, og fokus går tilbake til knappen.
 */

import { getSituations, onSituationsChanged, badgeCount, situationCardHtml, initSituations } from './situations.js';
import { findSituationLine, selectLine } from './line-search.js';

let btn = null;
let countEl = null;
let panel = null;
let body = null;
let closeBtn = null;
let loaded = false;
let failed = false;
let lastFocus = null;

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
    for (const b of card.querySelectorAll('.sit-line')) {
      const l = s.lines[Number(b.dataset.lineIndex)];
      if (!findSituationLine(l, s.codespace)) {
        b.disabled = true;
        b.removeAttribute('aria-label');
      }
    }
  });
}

function open() {
  if (isOpen()) return;
  lastFocus = document.activeElement;
  render();
  panel.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  body.scrollTop = 0;
  closeBtn.focus({ preventScroll: true });
}

function close({ restoreFocus = true } = {}) {
  if (!isOpen()) return;
  panel.hidden = true;
  btn.setAttribute('aria-expanded', 'false');
  const target = lastFocus && document.contains(lastFocus) ? lastFocus : btn;
  lastFocus = null;
  if (restoreFocus) target.focus({ preventScroll: true });
}

function onBodyClick(e) {
  const t = e.target;
  if (!(t instanceof Element)) return;
  const more = t.closest('.sit-more-btn');
  if (more) {
    const box = more.previousElementSibling;
    const expanded = more.getAttribute('aria-expanded') === 'true';
    if (box) box.hidden = expanded;
    more.setAttribute('aria-expanded', String(!expanded));
    more.textContent = expanded ? 'Vis mer' : 'Vis mindre';
    return;
  }
  const badge = t.closest('.sit-line');
  if (!badge || badge.disabled) return;
  const s = getSituations()[Number(badge.closest('.sit-card')?.dataset.index)];
  const line = s && findSituationLine(s.lines[Number(badge.dataset.lineIndex)], s.codespace);
  if (!line) return;
  close({ restoreFocus: false });
  selectLine(line, { fitMap: true });
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
  btn.addEventListener('click', () => (isOpen() ? close() : open()));
  // Fanges før de andre Escape-lytterne (linjevalg, avgangstavle), så Escape bare lukker panelet
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !isOpen()) return;
    e.stopPropagation();
    close();
  }, true);
  onSituationsChanged((list) => {
    loaded = true;
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
