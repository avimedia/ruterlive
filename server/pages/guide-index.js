// Server-rendrede sider: guideoversikt (/guider) og Om (/om).

import { escapeHtml, lineBadge, renderPage } from './layout.js';
import { RAIL_REGIONS } from '../line-catalog.js';
import { getRegion, regionPath } from '../../shared/regions.js';

const MODE_GROUPS = [
  ['metro', 'T-bane'],
  ['tram', 'Trikk'],
  ['rail', 'Tog'],
  ['flytog', 'Flytoget'],
  ['flybuss', 'Flybuss'],
  ['bus', 'Buss'],
  ['water', 'Båt'],
];

/**
 * Guideoversikten. `guides`/`lines` er Oslos; `extraRegions` er [{ region, guides, lines }] for andre synlige
 * regioner, med en egen seksjon hver. Bare indekserte linjer listes, og en region uten guider og
 * indekserte linjer får ingen seksjon.
 */
export function renderGuideIndex(guides, lines, extraRegions = []) {
  const guideItems = (list, region) => list
    .map((g) => `<li><a class="card" href="${escapeHtml(regionPath(region, `/guider/${g.slug}`))}"><span class="card-title">${escapeHtml(g.title)}</span><span class="card-text">${escapeHtml(g.description)}</span></a></li>`)
    .join('\n      ');
  const badges = (list) => list.map((l) => `<li>${lineBadge(l, { link: true })}</li>`).join('');
  const section = (mode, heading, items) => (items
    ? `      <section class="mode-group" data-mode="${escapeHtml(mode)}">\n        <h3>${escapeHtml(heading)}</h3>\n        <ul class="badge-list">${items}</ul>\n      </section>`
    : '');
  const groupsFor = (all) => {
    const list = all.filter((l) => l.indexed !== false);
    return MODE_GROUPS.flatMap(([mode, heading]) => {
      const ofMode = list.filter((l) => l.mode === mode);
      // Tog: én gruppe per region, linjer uten region havner under «Tog»
      if (mode !== 'rail') return [section(mode, heading, badges(ofMode))];
      const known = new Set(RAIL_REGIONS.map(([id]) => id));
      return [
        section(mode, heading, badges(ofMode.filter((l) => !known.has(l.region)))),
        ...RAIL_REGIONS.map(([id, label]) => section(mode, `${heading}: ${label}`, badges(ofMode.filter((l) => l.region === id)))),
      ];
    }).filter(Boolean).join('\n');
  };

  const oslo = getRegion();
  const extra = extraRegions.filter((e) => e.guides.length > 0 || e.lines.some((l) => l.indexed !== false));
  // Flere regioner med guider: nøytral ingress og beskrivelse (Oslo-teksten er uendret ellers)
  const guideRegions = extra.filter((e) => e.guides.length > 0).map((e) => e.region.shortName);
  const multi = guideRegions.length > 0;
  const regionNames = ['Oslo', ...guideRegions].join(' og ');
  const regionHtml = extra.map((e) => {
    const g = e.guides.length ? `\n    <ul class="card-list">\n      ${guideItems(e.guides, e.region)}\n    </ul>` : '';
    const l = groupsFor(e.lines);
    return `    <section class="region-section">
    <h2>${escapeHtml(e.region.name)}</h2>${g}${l ? `\n    <div class="mode-groups">\n${l}\n    </div>` : ''}
    </section>`;
  }).join('\n');

  const body = `    <h1>Guider og linjer</h1>
    <p class="lead">Bakgrunn om kollektivtrafikken i ${escapeHtml(regionNames)}, og en side per linje med stoppliste og hvor mange kjøretøy som er ute nå. Toglinjene dekker hele landet.</p>
    <p class="lang-switch"><a href="/en" hreflang="en" lang="en">English</a>: <span lang="en">guides for visitors to Oslo</span></p>
    <h2>Guider</h2>
    <ul class="card-list">
      ${guideItems(guides, oslo)}
    </ul>
    <h2>Linjer</h2>
    <div class="mode-groups">
${groupsFor(lines)}
    </div>
    <h2>Holdeplasser</h2>
    <p>Sentrale knutepunkter, med neste avganger i sanntid og hva som møtes der. <a href="/holdeplasser">Se holdeplassene</a>.</p>
${regionHtml}`;

  return renderPage({
    title: 'Guider og linjer | livetrafikk.no',
    description: multi
      ? `Guider om kollektivtrafikken i ${regionNames}, med linjesider for T-bane, trikk, Bybanen, buss, båt og tog i hele Norge.`
      : 'Guider om kollektivtrafikken i Oslo og oversikt over T-bane-, trikk-, Flytoget-, flybuss- og busslinjer, og toglinjene i hele Norge.',
    path: '/guider',
    body,
  });
}

/** `body` er klarert HTML fra content/om.html. */
export function renderAboutPage(body) {
  return renderPage({
    title: 'Om livetrafikk.no',
    description: 'livetrafikk.no er et gratis, uavhengig kart over kollektivtrafikken i Oslo og omegn, bygget på åpne data fra Entur.',
    path: '/om',
    body: `    <article class="prose">\n    <h1>Om livetrafikk.no</h1>\n${body}\n    </article>`,
  });
}
