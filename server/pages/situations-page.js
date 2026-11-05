// Server-rendret avviksside (/avvik): fast tekst, hopplenker og avvik for hele landet gruppert per område.

import { breadcrumbLd, escapeHtml, renderPage } from './layout.js';
import { listableSituations, isRelevant } from '../situations-model.js';
import { SITUATION_AREAS, areaFor } from '../../shared/situation-areas.js';

const TZ = 'Europe/Oslo';
const PATH = '/avvik';

// Entur sine alvorlighetsgrader; «undefined» får ingen merkelapp
const SEVERITY_LABEL = {
  verySevere: 'Svært alvorlig',
  severe: 'Alvorlig',
  normal: 'Normal',
  slight: 'Liten',
  noImpact: 'Ingen påvirkning',
};

const dateFmt = new Intl.DateTimeFormat('nb-NO', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('nb-NO', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

function dateParts(ms) {
  const p = Object.fromEntries(dateFmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { day: p.day, month: p.month, year: p.year };
}

const timeOf = (ms) => timeFmt.format(new Date(ms)).replace(':', '.');

/** «5. nov.», med år når det ikke er inneværende år. */
function dayText(ms, now) {
  const d = dateParts(ms);
  const year = d.year === dateParts(now).year ? '' : ` ${d.year}`;
  return `${d.day}. ${d.month}${year}`;
}

const sameDay = (a, b) => dateFmt.format(new Date(a)) === dateFmt.format(new Date(b));

/** «Gjelder fra 5. nov. kl. 08.00 til 20. nov.»; åpen slutt gir «inntil videre». */
export function formatValidityPeriod({ start, end }, now) {
  if (start == null && end == null) return 'Gjelder inntil videre';
  if (start == null) return `Gjelder til ${dayText(end, now)}`;
  const from = `Gjelder fra ${dayText(start, now)} kl. ${timeOf(start)}`;
  if (end == null) return `${from} inntil videre`;
  return sameDay(start, end) ? `${from} til kl. ${timeOf(end)}` : `${from} til ${dayText(end, now)}`;
}

const MAX_PERIODS = 3;

function validityHtml(validity, now) {
  const periods = (validity || []).filter((p) => p.end == null || p.end > now);
  if (!periods.length) return '';
  const shown = periods.slice(0, MAX_PERIODS).map((p) => `<li>${escapeHtml(formatValidityPeriod(p, now))}</li>`);
  if (periods.length > MAX_PERIODS) shown.push(`<li>og ${periods.length - MAX_PERIODS} perioder til</li>`);
  return `<ul class="situation-validity">${shown.join('')}</ul>`;
}

/** Operatørtekst: escapet, linjeskift beholdt. */
const textHtml = (s) => escapeHtml(s).replace(/\r?\n/g, '<br>');

function linesHtml(lines, lineLink) {
  const seen = new Set();
  const items = [];
  for (const l of lines) {
    if (seen.has(l.ref)) continue;
    seen.add(l.ref);
    const code = l.code || String(l.ref).split(':').pop();
    const path = lineLink(l.ref, l.code);
    items.push(path
      ? `<li><a class="line-badge line-badge--sm" href="${escapeHtml(path)}">${escapeHtml(code)}</a></li>`
      : `<li><span class="line-badge line-badge--sm situation-line">${escapeHtml(code)}</span></li>`);
  }
  return items.length ? `<div class="situation-targets"><span class="situation-label">Linjer</span><ul class="badge-list">${items.join('')}</ul></div>` : '';
}

function stopsHtml(stops, codespace, stopLink) {
  // Flere quayer på samme stoppested har samme navn: vis navnet én gang, med lenke hvis noen av dem har side
  const byName = new Map();
  for (const p of stops) {
    const name = p.name || p.id;
    const path = stopLink(p.id, p.name, codespace);
    if (!byName.has(name) || (!byName.get(name) && path)) byName.set(name, path);
  }
  if (!byName.size) return '';
  const items = [...byName].map(([name, path]) => (path
    ? `<li><a href="${escapeHtml(path)}">${escapeHtml(name)}</a></li>`
    : `<li>${escapeHtml(name)}</li>`));
  return `<div class="situation-targets"><span class="situation-label">Holdeplasser</span><ul class="situation-stops">${items.join('')}</ul></div>`;
}

function cardHtml(s, { now, lineLink, stopLink, showCodespace }) {
  const tags = [];
  const label = SEVERITY_LABEL[s.severity];
  if (label) tags.push(`<span class="situation-tag" data-severity="${escapeHtml(s.severity)}">${label}</span>`);
  if (s.planned) tags.push('<span class="situation-tag">Planlagt</span>');
  if (showCodespace) tags.push(`<span class="situation-tag">${escapeHtml(s.codespace)}</span>`);
  const links = s.links.map((u) => `<li><a href="${escapeHtml(u)}" rel="noopener nofollow">Mer informasjon fra operatøren</a></li>`).join('');
  const parts = [
    `<h3>${escapeHtml(s.summary)}</h3>`,
    tags.length ? `<p class="situation-tags">${tags.join(' ')}</p>` : '',
    validityHtml(s.validity, now),
    s.description ? `<p>${textHtml(s.description)}</p>` : '',
    s.advice ? `<p class="situation-advice">${textHtml(s.advice)}</p>` : '',
    linesHtml(s.lines, lineLink),
    stopsHtml(s.stops, s.codespace, stopLink),
    links ? `<ul class="situation-links">${links}</ul>` : '',
  ].filter(Boolean);
  return `      <article class="situation" data-severity="${escapeHtml(s.severity)}">
        ${parts.join('\n        ')}
      </article>`;
}

const areaAnchor = (area) => `avvik-${area.id.toLowerCase()}`;

function listHtml(index, ctx) {
  if (!index) return '    <p class="situations-empty">Avvik er ikke tilgjengelige akkurat nå.</p>';
  const groups = new Map(SITUATION_AREAS.map((a) => [a.id, []]));
  for (const s of listableSituations(index)) {
    if (isRelevant(s, ctx.now)) groups.get(areaFor(s.codespace).id).push(s);
  }
  const areas = SITUATION_AREAS.filter((a) => groups.get(a.id).length);
  if (!areas.length) return '    <p class="situations-empty">Ingen avvik akkurat nå.</p>';
  const jump = areas
    .map((a) => `<li><a href="#${areaAnchor(a)}">${escapeHtml(a.name)} <span class="situation-count">${groups.get(a.id).length}</span></a></li>`)
    .join('');
  const sections = areas.map((a) => `    <section class="situation-area" id="${areaAnchor(a)}">
      <h2>${escapeHtml(a.name)}</h2>
${groups.get(a.id).map((s) => cardHtml(s, { ...ctx, showCodespace: a.id === 'other' })).join('\n')}
    </section>`).join('\n');
  return `    <nav class="situation-jump" aria-label="Områder"><ul>${jump}</ul></nav>
${sections}`;
}

/**
 * `index` fra situations-tjenesten (null = ingen data). `text` er klarert HTML fra content/avvik.html.
 * `lineLink(lineRef, code)` og `stopLink(stopId, name, codespace)` gir sti til egen side eller null.
 * `updatedAt` (ms) vises som tidspunkt for siste henting.
 */
export function renderSituationsPage({ index, text, now = Date.now(), updatedAt = null, lineLink = () => null, stopLink = () => null }) {
  const updated = index && updatedAt ? `\n    <p class="byline">Hentet fra Entur kl. ${escapeHtml(timeOf(updatedAt))}</p>` : '';
  const body = `    <article class="prose">
    <h1>Avvik i kollektivtrafikken</h1>
${text}
    </article>${updated}
${listHtml(index, { now, lineLink, stopLink })}`;

  return renderPage({
    title: 'Avvik i kollektivtrafikken i Norge | livetrafikk.no',
    description: 'Innstilte avganger, omkjøringer og stengte holdeplasser for buss, bane, båt og tog i hele Norge, slik operatørene melder dem til Entur.',
    path: PATH,
    body,
    jsonLd: [breadcrumbLd([{ name: 'Hjem', path: '/' }, { name: 'Avvik', path: PATH }])],
  });
}
