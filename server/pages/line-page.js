// Server-rendret side for én linje (/linje/:slug).

import { LINES } from '../line-catalog.js';
import { findStopByName } from '../stop-catalog.js';
import { breadcrumbLd, escapeHtml, lineBadge, renderPage } from './layout.js';

const MAP_ZOOM = { metro: 12, tram: 12, rail: 10, flytog: 10, flybuss: 10 };
const MODE_LABEL = { metro: 'T-bane', tram: 'Trikk', rail: 'Tog', flytog: 'Flytoget', flybuss: 'Flybuss' };

const MODE_GUIDE = {
  metro: { slug: 't-banen-i-oslo', label: 'T-banen i Oslo' },
  tram: { slug: 'trikken-i-oslo', label: 'Trikken i Oslo' },
  rail: { slug: 'lokaltog-og-regiontog', label: 'Lokaltog og regiontog rundt Oslo' },
  flytog: { slug: 'flytoget-eller-flybussen', label: 'Flytoget eller flybussen' },
  flybuss: { slug: 'flytoget-eller-flybussen', label: 'Flytoget eller flybussen' },
};
const MAX_TITLE = 68;
const SUFFIX = ' | livetrafikk.no';

/** Endepunkter (fra stoppdata) som «A–B», eller null. */
function endpoints(stopsResult) {
  const { from, to } = stopsResult ?? {};
  return from && to && from !== to ? `${from}–${to}` : null;
}

/** Tittel ≤ ~65 tegn: linje + endepunkter + «stopp, kart og sanntid», med trinnvis forkorting. */
export function lineTitle(line, stopsResult) {
  const ends = endpoints(stopsResult);
  const candidates = [];
  if (ends) {
    candidates.push(`${line.title} ${ends}: stopp, kart og sanntid`, `${line.title} ${ends}: stopp og sanntid`, `${line.title} ${ends}`);
  }
  candidates.push(`${line.title}: stopp, kart og sanntid`, `${line.title}: stopp og sanntid`);
  const fit = candidates.find((c) => (c + SUFFIX).length <= MAX_TITLE);
  return (fit ?? candidates[candidates.length - 1]) + SUFFIX;
}

function lineDescription(line, stopsResult, hasStops) {
  const label = MODE_LABEL[line.mode] ?? 'Linje';
  const ends = endpoints(stopsResult);
  const route = ends ? ` mellom ${ends.replace('–', ' og ')}` : '';
  const what = hasStops && stopsResult.stops.length >= 3
    ? `Stoppliste (${stopsResult.stops.length} stopp), kart og antall kjøretøy i sanntid`
    : 'Kart og antall kjøretøy i sanntid';
  return `${line.title}${route}. ${what}. ${label}, data fra Entur.`;
}

/** Stoppnavn, lenket til holdeplassiden når stoppet finnes i katalogen. */
function stopItem(name) {
  const stop = findStopByName(name);
  return stop ? `<a href="/holdeplass/${escapeHtml(stop.slug)}">${escapeHtml(name)}</a>` : escapeHtml(name);
}

function formatDate(iso) {
  const d = iso ? new Date(iso) : new Date();
  const date = Number.isNaN(d.getTime()) ? new Date() : d;
  return date.toLocaleDateString('nb-NO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Oslo' });
}

/**
 * @param {string} [text] håndskrevet HTML-fragment fra getLineText (vises mellom hero og stopplisten)
 * @returns {string} komplett HTML-dokument
 */
export function renderLinePage(line, stopsResult, vehicleCount, text) {
  const hasStops = Boolean(stopsResult?.stops?.length);
  const zoom = MAP_ZOOM[line.mode] ?? 10;
  const mapHref = `/?lat=59.925&lng=10.75&z=${zoom}`;

  const vehicles = vehicleCount != null && (vehicleCount > 0 || line.mode !== 'flybuss')
    ? `<p class="live-count${vehicleCount > 0 ? '' : ' live-count--none'}"><span class="live-dot" aria-hidden="true"></span>Ute akkurat nå: <strong>${escapeHtml(vehicleCount)}</strong> kjøretøy</p>`
    : '';

  // Antar at Entur skiller stoppnavn i linjenavnet med «-» uten mellomrom (f.eks. «Stabekk-Oslo S-Moss»).
  const routeNames = hasStops && stopsResult.stops.length < 3
    ? String(stopsResult.name ?? '').split(/\s*-\s*/).filter(Boolean)
    : [];
  const stopsHtml = hasStops && stopsResult.stops.length < 3
    ? `${routeNames.length >= 2 ? `<p class="route-summary">Linjen går ${escapeHtml(routeNames.join(' – '))}.</p>\n    ` : ''}<p class="note">Entur har ikke en fullstendig stoppliste for denne linjen.</p>`
    : hasStops
    ? `<h2>Stopp</h2>
    <p class="stop-summary">Fra <strong>${escapeHtml(stopsResult.from)}</strong> til <strong>${escapeHtml(stopsResult.to)}</strong>, ${escapeHtml(stopsResult.stops.length)} stopp</p>
    <ol class="stop-list">
${stopsResult.stops.map((s) => `      <li>${stopItem(s)}</li>`).join('\n')}
    </ol>`
    : '<p class="note">Stoppliste lastes, prøv igjen om litt.</p>';

  const others = LINES.filter((l) => l.mode === line.mode && l.slug !== line.slug)
    .map((l) => `<li>${lineBadge(l, { link: true })}</li>`)
    .join('');
  const othersHtml = others ? `<h2>Andre linjer</h2>\n    <ul class="badge-list">${others}</ul>` : '';

  const guide = MODE_GUIDE[line.mode];
  const body = `    <div class="line-hero">
      <p class="eyebrow"><a href="/guider">Linjer</a> / ${escapeHtml(MODE_LABEL[line.mode] ?? '')}</p>
      <h1 class="line-title">${lineBadge(line, { size: 'lg' })} <span>${escapeHtml(line.title)}</span></h1>
      <p class="byline">livetrafikk.no · oppdatert ${escapeHtml(formatDate(hasStops ? stopsResult.fetchedAt : null))}</p>
      ${line.intro ? `<p class="lead">${escapeHtml(line.intro)}</p>\n      ` : ''}<div class="line-actions">
        <a class="button button--primary" href="${escapeHtml(mapHref)}">Se linjen på kartet</a>
        ${vehicles}
      </div>
    </div>
${text ? `    <div class="prose line-text">\n${text.trim()}\n    </div>\n` : ''}    ${stopsHtml}
    ${othersHtml}
    <h2>Les mer</h2>
    <ul class="link-list">
${guide ? `      <li><a href="/guider/${guide.slug}">${escapeHtml(guide.label)}</a></li>\n` : ''}      <li><a href="/guider/sanntidsposisjoner">Slik fungerer sanntidsposisjonene</a></li>
    </ul>`;

  return renderPage({
    title: lineTitle(line, stopsResult),
    description: lineDescription(line, stopsResult, hasStops),
    path: `/linje/${line.slug}`,
    mode: line.mode,
    body,
    jsonLd: [breadcrumbLd([
      { name: 'Hjem', path: '/' },
      { name: 'Guider og linjer', path: '/guider' },
      { name: line.title, path: `/linje/${line.slug}` },
    ])],
  });
}
