/**
 * Kartlaget «Avvik» (DOM): et varselmerke på hver holdeplass som er nevnt i et avvik i regionen.
 * Data, gruppering og kort-HTML kommer fra js/situations.js. Lista hentes også når laget er av,
 * fordi kjøretøy-popupen og avgangstavla bruker den.
 */

import L from 'leaflet';
import {
  getSituations, onSituationsChanged, badgeCount, situationCardHtml, initSituations, isUnavailable,
  groupSituationStops, situationsLayerLabel, situationsPageHref,
} from './situations.js';
import { findSituationLine, selectLine } from './line-search.js';
import { escapeHtml } from './stop-place-format.js';
import { currentRegion } from './region.js';
import { getMap } from './map.js';

const PANE = 'situationPane';
// Over holdeplassene (markerPane 600), under kjøretøyene (vehiclePane 750)
const PANE_Z = 720;

const ICON_HTML = '<svg viewBox="0 0 24 22" width="22" height="20" aria-hidden="true" focusable="false"><path d="M10.3 1.9 1.4 17.6A2 2 0 0 0 3.1 20.6h17.8a2 2 0 0 0 1.7-3L13.7 1.9a2 2 0 0 0-3.4 0z" fill="#f4a261" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 7.5v5.5" stroke="#14213d" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="16.6" r="1.3" fill="#14213d"/></svg>';

let layer = null;
let toggle = null;
let labelEl = null;
let loaded = false;

const isOn = () => Boolean(toggle?.checked);

function icon(severe) {
  return L.divIcon({
    className: severe ? 'sit-marker sit-marker--severe' : 'sit-marker',
    html: ICON_HTML,
    iconSize: [22, 20],
    iconAnchor: [11, 18],
    popupAnchor: [0, -16],
  });
}

const isSevere = (s) => s.severity === 'severe' || s.severity === 'verySevere';

function popupHtml(group) {
  const now = Date.now();
  const n = group.situations.length;
  return [
    '<div class="sit-popup-body">',
    `<h2 class="sit-popup-title">${escapeHtml(group.name || 'Holdeplass')}</h2>`,
    `<p class="sit-popup-count">${n} avvik</p>`,
    group.situations.map((s) => situationCardHtml(s, { now })).join(''),
    `<p class="sit-popup-footer"><a href="${escapeHtml(situationsPageHref(currentRegion()))}">Alle avvik</a></p>`,
    '</div>',
  ].join('');
}

/** «Vis mer» og linjemerker i popupen. Merker for linjer kartet ikke kjenner, deaktiveres. */
function wirePopup(el, group, onResize) {
  el.querySelectorAll('.sit-card').forEach((card, i) => {
    const s = group.situations[i];
    for (const b of card.querySelectorAll('.sit-line')) {
      if (!findSituationLine(s.lines[Number(b.dataset.lineIndex)], s.codespace)) {
        b.disabled = true;
        b.removeAttribute('aria-label');
      }
    }
  });
  el.addEventListener('click', (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    const more = t.closest('.sit-more-btn');
    if (more) {
      const box = more.closest('.sit-card')?.querySelector('.sit-more');
      const on = more.getAttribute('aria-expanded') !== 'true';
      if (box) box.hidden = !on;
      more.setAttribute('aria-expanded', String(on));
      more.textContent = on ? 'Vis mindre' : 'Vis mer';
      onResize();
      return;
    }
    const badge = t.closest('.sit-line');
    if (!badge || badge.disabled) return;
    const cards = [...el.querySelectorAll('.sit-card')];
    const s = group.situations[cards.indexOf(badge.closest('.sit-card'))];
    const line = s && findSituationLine(s.lines[Number(badge.dataset.lineIndex)], s.codespace);
    if (!line) return;
    getMap()?.closePopup();
    selectLine(line, { fitMap: true });
  });
}

function addMarker(group) {
  const marker = L.marker([group.lat, group.lon], {
    pane: PANE,
    icon: icon(group.situations.some(isSevere)),
    keyboard: true,
    title: `Avvik: ${group.name || 'Holdeplass'}`,
    alt: `Avvik ved ${group.name || 'holdeplassen'}`,
  });
  // Samme element hver gang: popup.update() etter «Vis mer» flytter kartet uten å nullstille kortene
  let el = null;
  marker.bindPopup(() => {
    if (!el) {
      el = document.createElement('div');
      el.innerHTML = popupHtml(group);
      wirePopup(el, group, () => marker.getPopup()?.update());
    }
    return el;
  }, { className: 'sit-popup', maxWidth: 320, minWidth: 240, maxHeight: 360, autoPanPaddingTopLeft: [16, 120], autoPanPaddingBottomRight: [70, 20] });
  // Trykk på merket skal ikke nå kartet (fravalg av kjøretøy og linje)
  marker.on('click', (e) => L.DomEvent.stopPropagation(e));
  marker.addTo(layer);
}

function render() {
  if (!layer) return;
  layer.clearLayers();
  if (!isOn()) return;
  for (const g of groupSituationStops(getSituations())) addMarker(g);
}

function updateLabel(list) {
  if (labelEl) labelEl.textContent = situationsLayerLabel(loaded ? badgeCount(list) : null);
}

/** Lenkene «Avvik» i toppmenyen går til regionens område på /avvik. */
function setMenuLinks() {
  const href = situationsPageHref(currentRegion());
  document.querySelectorAll('#map-chrome a[href^="/avvik"]').forEach((a) => { a.href = href; });
}

/** Kalles etter initLayers (lagvalget er da gjenopprettet). */
export function initSituationsLayer() {
  setMenuLinks();
  const map = getMap();
  toggle = document.getElementById('situations-toggle');
  labelEl = document.getElementById('situations-toggle-text');
  if (map && toggle) {
    if (!map.getPane(PANE)) map.createPane(PANE).style.zIndex = String(PANE_Z);
    layer = L.layerGroup().addTo(map);
    toggle.addEventListener('change', render);
  }
  onSituationsChanged((list) => {
    loaded = true;
    updateLabel(list);
    render();
  });
  updateLabel([]);
  initSituations({
    onError: () => {
      if (!isUnavailable()) return;
      loaded = false;
      updateLabel([]);
      layer?.clearLayers();
    },
  });
}
