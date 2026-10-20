// Server-rendret side for én linje (/linje/:slug).

import { LINES } from '../line-catalog.js';
import { escapeHtml, renderPage } from './layout.js';

const MAP_ZOOM = { metro: 12, tram: 12, rail: 10, flytog: 10, flybuss: 10 };

function formatDate(iso) {
  const d = iso ? new Date(iso) : new Date();
  const date = Number.isNaN(d.getTime()) ? new Date() : d;
  return date.toLocaleDateString('nb-NO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Oslo' });
}

/** @returns {string} komplett HTML-dokument */
export function renderLinePage(line, stopsResult, vehicleCount) {
  const hasStops = Boolean(stopsResult?.stops?.length);
  const zoom = MAP_ZOOM[line.mode] ?? 10;
  const mapHref = `/?lat=59.925&lng=10.75&z=${zoom}`;

  const vehicles = vehicleCount > 0 || line.mode !== 'flybuss'
    ? `<p>Ute akkurat nå: <strong>${escapeHtml(vehicleCount)}</strong> kjøretøy</p>\n`
    : '';

  const routeNames = hasStops && stopsResult.stops.length < 3
    ? String(stopsResult.name ?? '').split(/\s*-\s*/).filter(Boolean)
    : [];
  const stopsHtml = hasStops && stopsResult.stops.length < 3
    ? `${routeNames.length >= 2 ? `<p>Linjen går ${escapeHtml(routeNames.join(' – '))}.</p>\n    ` : ''}<p>Entur har ikke en fullstendig stoppliste for denne linjen.</p>`
    : hasStops
    ? `<h2>Stopp</h2>
    <p>Fra ${escapeHtml(stopsResult.from)} til ${escapeHtml(stopsResult.to)}, ${escapeHtml(stopsResult.stops.length)} stopp</p>
    <ol class="stop-list">
${stopsResult.stops.map((s) => `      <li>${escapeHtml(s)}</li>`).join('\n')}
    </ol>`
    : '<p>Stoppliste lastes, prøv igjen om litt.</p>';

  const others = LINES.filter((l) => l.mode === line.mode && l.slug !== line.slug)
    .map((l) => `<li><a href="/linje/${escapeHtml(l.slug)}">${escapeHtml(l.title)}</a></li>`)
    .join('');
  const othersHtml = others ? `<h2>Andre linjer</h2>\n    <ul>${others}</ul>` : '';

  const body = `    <h1>${escapeHtml(line.title)}</h1>
    <p class="byline">livetrafikk.no · oppdatert ${escapeHtml(formatDate(hasStops ? stopsResult.fetchedAt : null))}</p>
    <p>${escapeHtml(line.intro)}</p>
    ${vehicles}    ${stopsHtml}
    <p><a href="${escapeHtml(mapHref)}">Se linjen på kartet</a></p>
    ${othersHtml}`;

  return renderPage({
    title: `${line.title} – stopp og kjøretøy i sanntid | livetrafikk.no`,
    description: `${line.title}: stoppliste og antall kjøretøy akkurat nå, med data fra Entur.`,
    path: `/linje/${line.slug}`,
    body,
  });
}
