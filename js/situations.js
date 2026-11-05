/**
 * Avvik (SIRI SX) på kartet: henter /api/situations for regionen, holder lista og gir oppslag per linje
 * og holdeplass. Rene funksjoner (ingen DOM), så testene kan importere modulen; kartlaget ligger i
 * js/situations-layer.js. Endepunktet finnes bare på prod-serveren: feil gir laget uten tall, ingen logg.
 */

import { withRegion } from './region.js';
import { runWhenVisible } from './visibility.js';
import { escapeHtml } from './stop-place-format.js';
import { lineRefKeys, situationOnLine, areaFor } from '../shared/situation-areas.js';
import { severityLabel, textHtml, formatValidityPeriod } from '../shared/situation-format.js';

export const POLL_MS = 120_000;

let situations = [];
let signature = null;
let unavailable = false;

/** Serveren melder at avvik ikke er tilgjengelige (Entur nede lenge). */
export const isUnavailable = () => unavailable;
const listeners = new Set();

/** Kjennetegn for et svar: innholdet i avvikene. Likt kjennetegn betyr ingen endring. */
export function situationsSignature(data) {
  const list = Array.isArray(data?.situations) ? data.situations : [];
  return JSON.stringify(list);
}

export function getSituations() {
  return situations;
}

/** Bytter lista og varsler lytterne (brukes av henting og tester). */
export function setSituations(list) {
  situations = Array.isArray(list) ? list : [];
  for (const cb of listeners) {
    try {
      cb(situations);
    } catch { /* en lytter skal ikke stoppe de andre */ }
  }
}

/** Kalles med ny liste hver gang den endres. Gir en funksjon som fjerner lytteren. */
export function onSituationsChanged(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Teksten ved avkrysningen: «Avvik (N)» med N = antall merker, bare «Avvik» ved 0 eller uten data. */
export function situationsLayerLabel(n) {
  return Number.isFinite(n) && n > 0 ? `Avvik (${n})` : 'Avvik';
}

/** /avvik med ankeret for regionens område (Oslo → Ruter, Bergen → Skyss). */
export function situationsPageHref(region) {
  const space = region?.situationCodespaces?.[0];
  if (!space) return '/avvik';
  const area = areaFor(space);
  return area.id === 'other' ? '/avvik' : `/avvik#avvik-${area.id.toLowerCase()}`;
}

// Holdeplasser innen så mange meter regnes som samme posisjon (quayer på hver side av gata)
const SAME_PLACE_M = 15;

function metersBetween(a, b) {
  const k = Math.PI / 180;
  const x = (b.lon - a.lon) * k * Math.cos(((a.lat + b.lat) / 2) * k);
  const y = (b.lat - a.lat) * k;
  return Math.sqrt(x * x + y * y) * 6371000;
}

/**
 * Merker for kartlaget: ett per posisjon. Stopp med samme id eller innen SAME_PLACE_M slås sammen;
 * hvert merke har { lat, lon, name, ids, situations } med hvert avvik én gang, i lista sin rekkefølge.
 * Stopp uten koordinat, eller utenfor `bounds` ({ minLat, maxLat, minLon, maxLon }), gir intet merke.
 */
export function groupSituationStops(list, { nearM = SAME_PLACE_M, bounds = null } = {}) {
  const inside = (p) => !bounds || (p.lat >= bounds.minLat && p.lat <= bounds.maxLat && p.lon >= bounds.minLon && p.lon <= bounds.maxLon);
  const groups = [];
  const byId = new Map();
  for (const s of Array.isArray(list) ? list : []) {
    for (const p of s?.stops || []) {
      if (!Number.isFinite(p?.lat) || !Number.isFinite(p?.lon) || !inside(p)) continue;
      let g = byId.get(p.id) || groups.find((x) => metersBetween(x, p) <= nearM);
      if (!g) {
        g = { lat: p.lat, lon: p.lon, name: p.name || '', ids: [], situations: [], seen: new Set() };
        groups.push(g);
      }
      if (!byId.has(p.id)) {
        byId.set(p.id, g);
        g.ids.push(p.id);
      }
      if (!g.name && p.name) g.name = p.name;
      if (!g.seen.has(s.id)) {
        g.seen.add(s.id);
        g.situations.push(s);
      }
    }
  }
  return groups.map(({ seen, ...g }) => g);
}

/** Merkene kartlaget tegner for regionen: bare innenfor regionens kartboks (togavvik er landsdekkende). */
export function situationMarkers(list, region) {
  return groupSituationStops(list, { bounds: region?.vehicleBounds ?? null });
}

/**
 * Avvik for en linje: treff på lineRef, ellers kodeområde (+ alias, Vy-tog er NSB) og linjekode.
 * Uten codespace brukes prefikset i lineRef.
 */
export function situationsForLine({ lineRef, publicCode, codespace } = {}, list = situations) {
  const space = codespace || (typeof lineRef === 'string' ? lineRef.split(':')[0] : '');
  if (!lineRef && !(space && publicCode)) return [];
  const keys = space && publicCode
    ? lineRefKeys({ ref: lineRef, code: publicCode, authority: space })
    : { refs: [lineRef], codes: [] };
  const wanted = { refs: new Set(keys.refs), codes: new Set(keys.codes) };
  return list.filter((s) => situationOnLine(s, wanted));
}

/** Avvik for flere quay-/stopPlace-ID-er, uten duplikater, i lista sin rekkefølge. */
export function situationsForQuays(ids, list = situations) {
  const wanted = new Set(ids || []);
  if (!wanted.size) return [];
  return list.filter((s) => (s.stops || []).some((p) => wanted.has(p.id)));
}

/** Første gjeldende eller kommende periode, med «i dag»/«i morgen»; flere perioder gir «og N til». */
export function formatValidity(validity, now = Date.now()) {
  if (!Array.isArray(validity) || !validity.length) return 'Gjelder inntil videre';
  const periods = validity.filter((p) => p && (p.end == null || p.end > now));
  if (!periods.length) return '';
  const text = formatValidityPeriod(periods[0], now, { relative: true });
  const rest = periods.length - 1;
  return rest ? `${text} (og ${rest} ${rest === 1 ? 'periode' : 'perioder'} til)` : text;
}

/**
 * Kompakt avviksnotat (popup, tavle): tittel + maks `max` oppsummeringer, så «og N til».
 * Tom streng uten avvik. Alt escapes.
 */
export function situationNoteHtml(list, { title = '⚠ Avvik på linja', max = 2 } = {}) {
  if (!Array.isArray(list) || !list.length) return '';
  const shown = list.slice(0, max).map((s) => `<li>${escapeHtml(s.summary)}</li>`).join('');
  const rest = list.length - max;
  const more = rest > 0 ? `<li class="sit-note-more">og ${rest} til</li>` : '';
  return `<div class="sit-note"><strong class="sit-note-title">${escapeHtml(title)}</strong><ul>${shown}${more}</ul></div>`;
}

/** Linjenøkkel for situationsForLine fra en avgang (JP-linje: id «RUT:Line:31», publicCode). */
export function lineKeyFromCall(c) {
  const line = c?.serviceJourney?.journeyPattern?.line;
  return { lineRef: line?.id, publicCode: line?.publicCode };
}

/** Linjenøkkel fra et kjøretøy i /api/vehicles-live (line.ref) eller klient-fallback (line.lineRef). */
export function lineKeyFromVehicle(v) {
  return { lineRef: v?.line?.ref || v?.line?.lineRef, publicCode: v?.line?.publicCode };
}

const isHttp = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);

/**
 * Ett kort i avvikspopupen på kartet som HTML-streng. Alt fra operatøren escapes; lenker bare http(s).
 * Linjemerkene er knapper med data-line-index (indeks i s.lines), som kartlaget kobler til linjevalg.
 */
export function situationCardHtml(s, { now = Date.now() } = {}) {
  const tags = [];
  const label = severityLabel(s.severity);
  if (label && s.severity !== 'normal') tags.push(`<span class="sit-tag" data-severity="${escapeHtml(s.severity)}">${label}</span>`);
  if (s.planned) tags.push('<span class="sit-tag">Planlagt</span>');

  const seen = new Set();
  const badges = [];
  (s.lines || []).forEach((l, i) => {
    const code = l.code || String(l.ref ?? '').split(':').pop();
    if (!code || seen.has(l.ref ?? code)) return;
    seen.add(l.ref ?? code);
    badges.push(`<button type="button" class="sit-line" data-line-index="${i}" aria-label="Vis linje ${escapeHtml(code)} på kartet">${escapeHtml(code)}</button>`);
  });

  const stopNames = [...new Set((s.stops || []).map((p) => p.name).filter(Boolean))];
  const links = (s.links || []).filter(isHttp)
    .map((u) => `<li><a href="${escapeHtml(u)}" target="_blank" rel="noopener nofollow">Mer informasjon fra operatøren</a></li>`);
  const more = [
    s.description ? textHtml(s.description, 'sit-text') : '',
    s.advice ? textHtml(s.advice, 'sit-text sit-advice') : '',
    stopNames.length ? `<p class="sit-stops"><span class="sit-label">Holdeplasser:</span> ${stopNames.map(escapeHtml).join(', ')}</p>` : '',
    links.length ? `<ul class="sit-links">${links.join('')}</ul>` : '',
  ].filter(Boolean);

  const validity = formatValidity(s.validity, now);
  return [
    `<article class="sit-card" data-severity="${escapeHtml(s.severity)}">`,
    `<h3 class="sit-summary">${escapeHtml(s.summary)}</h3>`,
    tags.length ? `<p class="sit-tags">${tags.join(' ')}</p>` : '',
    validity ? `<p class="sit-validity">${escapeHtml(validity)}</p>` : '',
    badges.length ? `<div class="sit-lines">${badges.join('')}</div>` : '',
    more.length ? `<div class="sit-more" hidden>${more.join('')}</div><button type="button" class="sit-more-btn" aria-expanded="false">Vis mer</button>` : '',
    '</article>',
  ].filter(Boolean).join('');
}

/** Henter lista én gang. Gir true ved svar (uendret svar varsler ikke lytterne); feil (også manglende endepunkt i dev) beholder den gamle. */
export async function fetchSituations(fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl(withRegion('/api/situations'));
    if (!res?.ok) return false;
    const data = await res.json();
    if (!data || !Array.isArray(data.situations)) return false;
    // Entur utilgjengelig lenge: serveren svarer available: false, og kartlaget viser ikke tall eller merker
    if (data.available === false) {
      unavailable = true;
      situations = [];
      signature = null;
      return false;
    }
    unavailable = false;
    const sig = situationsSignature(data);
    if (sig !== signature) {
      signature = sig;
      setSituations(data.situations);
    }
    return true;
  } catch {
    return false;
  }
}

let started = false;

/** Henter ved oppstart og hvert 2. min mens fanen er synlig (regionbytte laster siden på nytt). */
export function initSituations({ intervalMs = POLL_MS, onError = () => {} } = {}) {
  if (started) return;
  started = true;
  const run = () => fetchSituations().then((ok) => { if (!ok) onError(); });
  run();
  setInterval(runWhenVisible(run), intervalMs);
}
