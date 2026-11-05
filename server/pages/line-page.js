// Server-rendret side for én linje (/linje/:slug).

import { REGION_LINES } from '../line-catalog.js';
import { findRegion, getRegion, regionPath } from '../../shared/regions.js';
import { findStopByName } from '../stop-catalog.js';
import { breadcrumbLd, escapeHtml, lineBadge, renderPage } from './layout.js';

const MAP_ZOOM = { metro: 12, tram: 12, rail: 10, flytog: 10, flybuss: 10, bus: 11 };
const MODE_LABEL = { metro: 'T-bane', tram: 'Trikk', rail: 'Tog', flytog: 'Flytoget', flybuss: 'Flybuss', bus: 'Buss', water: 'Båt' };

const MODE_GUIDE = {
  metro: { slug: 't-banen-i-oslo', label: 'T-banen i Oslo' },
  tram: { slug: 'trikken-i-oslo', label: 'Trikken i Oslo' },
  rail: { slug: 'lokaltog-og-regiontog', label: 'Lokaltog og regiontog rundt Oslo' },
  flytog: { slug: 'flytoget-eller-flybussen', label: 'Flytoget eller flybussen' },
  flybuss: { slug: 'flytoget-eller-flybussen', label: 'Flytoget eller flybussen' },
  bus: { slug: 'slik-bruker-du-kartet', label: 'Slik bruker du kartet' },
};
// Guider for andre regioner (content/<region>/guider/<slug>.html)
const REGION_MODE_GUIDE = {
  bergen: {
    tram: { slug: 'bybanen-i-bergen', label: 'Bybanen i Bergen' },
    flybuss: { slug: 'til-og-fra-flesland', label: 'Til og fra Flesland' },
    water: { slug: 'bat-og-ferje-skyss', label: 'Båt og ferje i Skyss-området' },
  },
};
const OSLO_RAIL_REGIONS = new Set(['ostlandet', 'fjerntog']);
const MAX_TITLE = 68;
const SUFFIX = ' | livetrafikk.no';

/** Endepunkter (fra stoppdata) som «A–B», eller null. Titler med «–» har allerede strekningen. */
function endpoints(line, stopsResult) {
  if (line.title.includes('–')) return null;
  const { from, to } = stopsResult ?? {};
  return from && to && from !== to ? `${from}–${to}` : null;
}

/** Tittel ≤ ~65 tegn: linje + endepunkter + «stopp, kart og sanntid», med trinnvis forkorting. */
export function lineTitle(line, stopsResult) {
  const ends = endpoints(line, stopsResult);
  const candidates = [];
  if (ends) {
    candidates.push(`${line.title} ${ends}: stopp, kart og sanntid`, `${line.title} ${ends}: stopp og sanntid`, `${line.title} ${ends}`);
  }
  candidates.push(`${line.title}: stopp, kart og sanntid`, `${line.title}: stopp og sanntid`, line.title);
  const fit = candidates.find((c) => (c + SUFFIX).length <= MAX_TITLE);
  return (fit ?? candidates[candidates.length - 1]) + SUFFIX;
}

function lineDescription(line, stopsResult, hasStops) {
  const label = MODE_LABEL[line.mode] ?? 'Linje';
  const ends = endpoints(line, stopsResult);
  const route = ends ? ` mellom ${ends.replace('–', ' og ')}` : '';
  const what = hasStops && stopsResult.stops.length >= 3
    ? `Stoppliste (${stopsResult.stops.length} stopp), kart og antall kjøretøy i sanntid`
    : 'Kart og antall kjøretøy i sanntid';
  return `${line.title}${route}. ${what}. ${label}, data fra Entur.`;
}

/** Stoppnavn, lenket til holdeplassiden når stoppet finnes i katalogen. */
function stopItem(name, region) {
  const stop = findStopByName(name, region.id);
  return stop ? `<a href="${escapeHtml(regionPath(region, `/holdeplass/${stop.slug}`))}">${escapeHtml(name)}</a>` : escapeHtml(name);
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
  const indexed = line.indexed !== false;
  const region = findRegion(line.regionId) ?? getRegion();
  const isOslo = !region.path;
  // Linjer utenfor Oslo har eget kartutsnitt (midt i linjen), ellers regionens.
  const { lat, lng } = line.map ?? region.mapLink;
  const zoom = line.map?.z ?? MAP_ZOOM[line.mode] ?? 10;
  const mapHref = `${isOslo ? '/' : region.path}?lat=${lat}&lng=${lng}&z=${zoom}`;
  const linePath = regionPath(region, `/linje/${line.slug}`);

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
${stopsResult.stops.map((s) => `      <li>${stopItem(s, region)}</li>`).join('\n')}
    </ol>`
    : '<p class="note">Stoppliste lastes, prøv igjen om litt.</p>';

  // Tog: bare linjene i samme region (fjerntog for seg), ellers alle med samme modus.
  const others = (REGION_LINES[region.id] ?? []).filter((l) => l.mode === line.mode && l.slug !== line.slug && l.region === line.region && l.indexed !== false)
    .map((l) => `<li>${lineBadge(l, { link: true })}</li>`)
    .join('');
  const othersHtml = others ? `<h2>Andre linjer</h2>\n    <ul class="badge-list">${others}</ul>` : '';

  // Togguiden handler om togene fra Oslo (Østlandet og fjerntogene), ikke Bergen eller Trøndelag
  const guide = !isOslo
    ? REGION_MODE_GUIDE[region.id]?.[line.mode] ?? null
    : (line.region && !OSLO_RAIL_REGIONS.has(line.region)) ? null : MODE_GUIDE[line.mode];
  const body = `    <div class="line-hero">
      <p class="eyebrow">${isOslo ? '' : `<a href="${escapeHtml(region.path)}">${escapeHtml(region.shortName)}</a> / `}<a href="/guider">Linjer</a> / ${escapeHtml(MODE_LABEL[line.mode] ?? '')}</p>
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
${guide ? `      <li><a href="${escapeHtml(regionPath(region, `/guider/${guide.slug}`))}">${escapeHtml(guide.label)}</a></li>\n` : ''}      <li><a href="/guider/sanntidsposisjoner">Slik fungerer sanntidsposisjonene</a></li>
    </ul>`;

  return renderPage({
    title: lineTitle(line, stopsResult),
    description: lineDescription(line, stopsResult, hasStops),
    path: linePath,
    mode: line.mode,
    body,
    mapPath: regionPath(region),
    // Uten egen tekst: ikke i søkemotorer, og ingen annonser på tynt innhold
    noindex: !indexed,
    ads: indexed,
    jsonLd: [breadcrumbLd([
      { name: isOslo ? 'Hjem' : region.shortName, path: regionPath(region) },
      { name: 'Guider og linjer', path: '/guider' },
      { name: line.title, path: linePath },
    ])],
  });
}
