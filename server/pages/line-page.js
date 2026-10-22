// Server-rendret side for én linje (/linje/:slug).

import { LINES } from '../line-catalog.js';
import { findStopByName } from '../stop-catalog.js';
import { escapeHtml, lineBadge, renderPage } from './layout.js';

const MAP_ZOOM = { metro: 12, tram: 12, rail: 10, flytog: 10, flybuss: 10 };
const MODE_LABEL = { metro: 'T-bane', tram: 'Trikk', rail: 'Tog', flytog: 'Flytoget', flybuss: 'Flybuss' };

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

/** @returns {string} komplett HTML-dokument */
export function renderLinePage(line, stopsResult, vehicleCount) {
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

  const body = `    <div class="line-hero">
      <p class="eyebrow"><a href="/guider">Linjer</a> / ${escapeHtml(MODE_LABEL[line.mode] ?? '')}</p>
      <h1 class="line-title">${lineBadge(line, { size: 'lg' })} <span>${escapeHtml(line.title)}</span></h1>
      <p class="byline">livetrafikk.no · oppdatert ${escapeHtml(formatDate(hasStops ? stopsResult.fetchedAt : null))}</p>
      ${line.intro ? `<p class="lead">${escapeHtml(line.intro)}</p>\n      ` : ''}<div class="line-actions">
        <a class="button button--primary" href="${escapeHtml(mapHref)}">Se linjen på kartet</a>
        ${vehicles}
      </div>
    </div>
    ${stopsHtml}
    ${othersHtml}`;

  return renderPage({
    title: `${line.title} – stopp og kjøretøy i sanntid | livetrafikk.no`,
    description: hasStops && stopsResult.stops.length < 3
      ? `${line.title}: antall kjøretøy akkurat nå, med data fra Entur.`
      : `${line.title}: stoppliste og antall kjøretøy akkurat nå, med data fra Entur.`,
    path: `/linje/${line.slug}`,
    mode: line.mode,
    body,
  });
}
