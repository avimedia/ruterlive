/**
 * Avvik (SIRI SX) på kartet: henter /api/situations for regionen, holder lista og gir oppslag per linje
 * og holdeplass. Rene funksjoner (ingen DOM), så testene kan importere modulen; panelet ligger i
 * js/situations-panel.js. Endepunktet finnes bare på prod-serveren: feil gir tom knapp, ingen logg.
 */

import { withRegion } from './region.js';
import { runWhenVisible } from './visibility.js';
import { escapeHtml } from './stop-place-format.js';
import { lineRefKeys, situationOnLine } from '../shared/situation-areas.js';
import { SEVERITY_LABEL, formatValidityPeriod } from '../shared/situation-format.js';

export const POLL_MS = 120_000;

let situations = [];
let signature = null;
const listeners = new Set();

/** Kjennetegn for et svar: updatedAt + avvikenes id-er. Likt kjennetegn betyr ingen endring. */
export function situationsSignature(data) {
  const list = Array.isArray(data?.situations) ? data.situations : [];
  return `${data?.updatedAt ?? ''}|${list.map((s) => s?.id).join(',')}`;
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

/** Tallet på knappen: alle avvik serveren lister for regionen, også «noImpact» (Ruling 5). */
export function badgeCount(list) {
  return Array.isArray(list) ? list.length : 0;
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

const isHttp = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);

/** Operatørtekst: escapet; tom linje gir nytt avsnitt, enkelt linjeskift <br>. */
const textHtml = (s, cls) => String(s).split(/\r?\n\s*\n/)
  .map((p) => p.trim()).filter(Boolean)
  .map((p) => `<p class="${cls}">${escapeHtml(p).replace(/\r?\n/g, '<br>')}</p>`)
  .join('');

/**
 * Ett kort i panelet som HTML-streng. Alt fra operatøren escapes; lenker bare http(s).
 * Linjemerkene er knapper med data-line-index (indeks i s.lines), som panelet kobler til linjevalg.
 */
export function situationCardHtml(s, { now = Date.now() } = {}) {
  const tags = [];
  const label = SEVERITY_LABEL[s.severity];
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
