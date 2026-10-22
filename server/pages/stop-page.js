// Server-rendrede holdeplassider: /holdeplass/:slug og oversikten /holdeplasser.

import { LINES } from '../line-catalog.js';
import { STOPS, nearestStops } from '../stop-catalog.js';
import { escapeHtml, renderPage } from './layout.js';

const BASE_URL = 'https://livetrafikk.no';
const MODE_LABEL = { metro: 'T-bane', tram: 'Trikk', rail: 'Tog', bus: 'Buss', water: 'Båt' };
const MODE_LINE = {
  metro: ['T-banelinje', 'T-banelinjene'],
  tram: ['trikkelinje', 'trikkelinjene'],
  rail: ['toglinje', 'toglinjene'],
  bus: ['busslinje', 'busslinjene'],
  water: ['båtrute', 'båtrutene'],
};
const MODE_ORDER = ['metro', 'tram', 'rail', 'bus', 'water'];
const MAX_LISTED_BUS = 8;

const timeFmt = new Intl.DateTimeFormat('nb-NO', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Oslo' });

function formatTime(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : timeFmt.format(d);
}

/** «a», «a og b», «a, b og c» */
export function joinNb(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} og ${items[items.length - 1]}`;
}

const naturalCompare = (a, b) => String(a).localeCompare(String(b), 'nb', { numeric: true });

/** Grunnmodus for en JP-linje (bus/coach → bus). */
function baseMode(transportMode) {
  if (transportMode === 'coach') return 'bus';
  return MODE_LABEL[transportMode] ? transportMode : '';
}

/** Modus for fargebrikke: Flytoget og flybuss har egne farger. */
function badgeMode(line) {
  const code = String(line.publicCode ?? '').toUpperCase();
  if (line.transportMode === 'rail' && code.startsWith('FLY')) return 'flytog';
  if ((line.transportMode === 'bus' || line.transportMode === 'coach') && /^FB\d/.test(code)) return 'flybuss';
  return baseMode(line.transportMode) || 'bus';
}

/** Linjesiden i line-catalog for en JP-linje (id «RUT:Line:5»), ellers undefined. */
export function catalogLineFor(jpLine) {
  const authority = String(jpLine?.id ?? '').split(':')[0];
  const code = String(jpLine?.publicCode ?? '').toUpperCase();
  if (!authority || !code) return undefined;
  return LINES.find((l) => l.authority === authority
    && (l.code.toUpperCase() === code || l.aliases.some((a) => a.toUpperCase() === code)));
}

function jpLineBadge(jpLine) {
  const mode = badgeMode(jpLine);
  const code = escapeHtml(jpLine.publicCode || '?');
  const cat = catalogLineFor(jpLine);
  return cat
    ? `<a class="line-badge line-badge--sm" data-mode="${mode}" href="/linje/${escapeHtml(cat.slug)}" aria-label="${escapeHtml(cat.title)}">${code}</a>`
    : `<span class="line-badge line-badge--sm" data-mode="${mode}">${code}</span>`;
}

function modeBadges(modes) {
  return modes.map((m) => `<span class="mode-badge" data-mode="${m}">${escapeHtml(MODE_LABEL[m])}</span>`).join('');
}

/** Linjer gruppert per grunnmodus, sortert. */
function linesByMode(lines) {
  const groups = new Map();
  for (const l of lines) {
    const mode = baseMode(l.transportMode);
    if (!mode) continue;
    if (!groups.has(mode)) groups.set(mode, []);
    if (!groups.get(mode).some((x) => x.publicCode === l.publicCode)) groups.get(mode).push(l);
  }
  for (const g of groups.values()) g.sort((a, b) => naturalCompare(a.publicCode, b.publicCode));
  return MODE_ORDER.filter((m) => groups.has(m)).map((m) => [m, groups.get(m)]);
}

/** Kort, faktabasert introtekst ut fra katalog og JP-data. */
export function buildIntro(stop, info) {
  const modes = stop.modes.map((m) => MODE_LABEL[m].toLowerCase());
  const modeText = joinNb(modes).replace(/^t-bane/, 'T-bane');
  const isStation = stop.modes.includes('metro') || stop.modes.includes('rail');
  const parts = [`${stop.name} er en ${isStation ? 'stasjon' : 'holdeplass'} for ${modeText}.`];
  if (info?.lines?.length) {
    const phrases = linesByMode(info.lines).map(([mode, lines]) => {
      const [one, many] = MODE_LINE[mode];
      if (mode === 'bus' && lines.length > MAX_LISTED_BUS) return `${lines.length} ${many.replace(/ne$/, 'r')}`;
      const codes = lines.map((l) => l.publicCode);
      return `${codes.length === 1 ? one : many} ${joinNb(codes)}`;
    });
    if (phrases.length) {
      // «og» inne i en frase gjør «og» mellom frasene tvetydig; bruk da «samt».
      const text = phrases.length > 1 && phrases.some((p) => p.includes(' og '))
        ? `${phrases.slice(0, -1).join(', ')}, samt ${phrases[phrases.length - 1]}`
        : joinNb(phrases);
      parts.push(`Her stopper ${text}.`);
    }
  }
  const zone = info?.zones?.length ? `ligger i Ruters sone ${joinNb(info.zones)}` : '';
  const quays = info?.quayCount > 1 ? `har ${info.quayCount} stoppesteder (plattformer og holdeplasser)` : '';
  if (zone || quays) parts.push(`${isStation ? 'Stasjonen' : 'Holdeplassen'} ${joinNb([zone, quays].filter(Boolean))}.`);
  return parts.join(' ');
}

/** Forsinkelse i hele minutter slik klokkeslettene vises (HH:MM), så status og tid stemmer overens. */
function delayMinutes(dep) {
  const min = (iso) => Math.floor(new Date(iso).getTime() / 60000);
  const diff = min(dep.expected) - min(dep.aimed);
  return Number.isFinite(diff) ? diff : 0;
}

function statusBadge(dep) {
  if (dep.cancelled) return '<span class="dep-status dep-status--cancelled">Innstilt</span>';
  if (!dep.realtime) return '<span class="dep-status dep-status--planned">Rutetid</span>';
  const diff = delayMinutes(dep);
  if (diff >= 1) return `<span class="dep-status dep-status--late">+${diff} min</span>`;
  if (diff <= -1) return `<span class="dep-status dep-status--live">${diff} min</span>`;
  return '<span class="dep-status dep-status--live">I rute</span>';
}

function departuresHtml(departures, nowMs) {
  if (!departures) {
    return '<p class="note">Avganger er midlertidig utilgjengelige. Prøv igjen om litt.</p>';
  }
  const upcoming = departures.departures.filter((d) => new Date(d.expected).getTime() >= nowMs - 30000);
  if (upcoming.length === 0) return '<p class="note">Ingen avganger de neste tre timene.</p>';
  const showPlatform = upcoming.some((d) => d.platform);
  const rows = upcoming.map((d) => {
    const late = d.realtime && !d.cancelled && delayMinutes(d) !== 0;
    return `        <tr${d.cancelled ? ' class="dep-cancelled"' : ''}>
          <td class="dep-time"><time datetime="${escapeHtml(d.expected)}">${escapeHtml(formatTime(d.expected))}</time>${late ? ` <s class="dep-aimed">${escapeHtml(formatTime(d.aimed))}</s>` : ''}</td>
          <td>${jpLineBadge(d.line)}</td>
          <td class="dep-dest">${escapeHtml(d.destination)}</td>
${showPlatform ? `          <td class="dep-platform">${escapeHtml(d.platform)}</td>\n` : ''}          <td>${statusBadge(d)}</td>
        </tr>`;
  }).join('\n');
  return `<div class="table-scroll">
    <table class="departures">
      <thead><tr><th scope="col">Tid</th><th scope="col">Linje</th><th scope="col">Til</th>${showPlatform ? '<th scope="col">Plf.</th>' : ''}<th scope="col">Status</th></tr></thead>
      <tbody>
${rows}
      </tbody>
    </table>
    </div>
    <p class="byline">Hentet ${escapeHtml(formatTime(departures.fetchedAt))} fra Entur. Tider med «Rutetid» er uten sanntidsdata.</p>`;
}

/** schema.org-type ut fra modusene. */
export function schemaType(modes) {
  if (modes.includes('rail')) return 'TrainStation';
  if (modes.includes('metro')) return 'SubwayStation';
  if (modes.includes('bus')) return 'BusStation';
  if (modes.length === 1 && modes[0] === 'water') return 'BoatTerminal';
  return 'Place';
}

function jsonLd(stop) {
  const data = {
    '@context': 'https://schema.org',
    '@type': schemaType(stop.modes),
    name: stop.name,
    url: `${BASE_URL}/holdeplass/${stop.slug}`,
    geo: { '@type': 'GeoCoordinates', latitude: stop.lat, longitude: stop.lon },
  };
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

function formatDistance(m) {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`;
}

/**
 * @param {object} stop katalogoppføring
 * @param {{lines, zones, quayCount}|null} info
 * @param {{fetchedAt, departures: object[]}|null} departures null = Entur utilgjengelig
 */
export function renderStopPage(stop, info, departures, { now = Date.now() } = {}) {
  const mapHref = `/?lat=${stop.lat}&lng=${stop.lon}&z=16`;
  const lineGroups = info?.lines?.length ? linesByMode(info.lines) : [];
  const linesHtml = lineGroups.length
    ? `<h2>Linjer</h2>
    <dl class="stop-lines">
${lineGroups.map(([mode, lines]) => `      <dt>${escapeHtml(MODE_LABEL[mode])}</dt>
      <dd><ul class="badge-list">${lines.map((l) => `<li>${jpLineBadge(l)}</li>`).join('')}</ul></dd>`).join('\n')}
    </dl>`
    : '';
  const nearby = nearestStops(stop, 3)
    .map(({ stop: s, distance }) => `<li><a href="/holdeplass/${escapeHtml(s.slug)}">${escapeHtml(s.name)}</a> <span class="stop-meta">${escapeHtml(formatDistance(distance))} · ${escapeHtml(s.modes.map((m) => MODE_LABEL[m]).join(', '))}</span></li>`)
    .join('\n      ');

  const body = `    <div class="line-hero stop-hero" data-mode="${escapeHtml(stop.modes[0] ?? 'metro')}">
      <p class="eyebrow"><a href="/holdeplasser">Holdeplasser</a></p>
      <h1>${escapeHtml(stop.name)}</h1>
      <p class="mode-badges">${modeBadges(stop.modes)}</p>
      <p class="lead">${escapeHtml(buildIntro(stop, info))}</p>
      <div class="line-actions">
        <a class="button button--primary" href="${escapeHtml(mapHref)}">Se på kartet</a>
      </div>
    </div>
    <h2>Neste avganger</h2>
    ${departuresHtml(departures, now)}
    ${linesHtml}
    <h2>I nærheten</h2>
    <ul class="nearby-stops">
      ${nearby}
    </ul>
    ${jsonLd(stop)}`;

  const modeText = joinNb(stop.modes.map((m) => MODE_LABEL[m].toLowerCase())).replace(/^t-bane/, 'T-bane');
  return renderPage({
    title: `${stop.name} – avganger i sanntid | livetrafikk.no`,
    description: `Neste avganger fra ${stop.name} (${modeText}) med sanntid fra Entur, linjene som stopper her og holdeplasser i nærheten.`,
    path: `/holdeplass/${stop.slug}`,
    body,
  });
}

const INDEX_GROUPS = [
  ['metro', 'T-bane', (s) => s.modes.includes('metro')],
  ['tram', 'Trikk', (s) => s.modes.includes('tram')],
  ['rail', 'Tog', (s) => s.modes.includes('rail')],
  ['bus', 'Buss- og båtknutepunkter', (s) => !s.modes.some((m) => m === 'metro' || m === 'tram' || m === 'rail')],
];

export function renderStopIndex(stops = STOPS) {
  const groups = INDEX_GROUPS.map(([mode, heading, match]) => {
    const items = stops.filter(match)
      .sort((a, b) => a.name.localeCompare(b.name, 'nb'))
      .map((s) => `<li><a href="/holdeplass/${escapeHtml(s.slug)}">${escapeHtml(s.name)}</a></li>`)
      .join('');
    return items ? `    <section class="stop-group" data-mode="${mode}">
      <h2>${escapeHtml(heading)}</h2>
      <ul class="stop-index">${items}</ul>
    </section>` : '';
  }).filter(Boolean).join('\n');

  const body = `    <h1>Holdeplasser</h1>
    <p class="lead">${escapeHtml(String(stops.length))} stasjoner og holdeplasser i Oslo og omegn: alle T-banestasjoner, de mest brukte trikkestoppene og knutepunkter for tog, buss og båt. Hver side viser neste avganger i sanntid og linjene som stopper der.</p>
${groups}`;

  return renderPage({
    title: 'Holdeplasser i Oslo – avganger i sanntid | livetrafikk.no',
    description: 'T-banestasjoner, trikkestopp og knutepunkter for tog og buss i Oslo og omegn, med neste avganger fra Entur.',
    path: '/holdeplasser',
    body,
  });
}
