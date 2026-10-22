// Server-rendrede sider: guideoversikt (/guider) og Om (/om).

import { escapeHtml, lineBadge, renderPage } from './layout.js';

const MODE_GROUPS = [
  ['metro', 'T-bane'],
  ['tram', 'Trikk'],
  ['rail', 'Tog'],
  ['flytog', 'Flytoget'],
  ['flybuss', 'Flybuss'],
];

export function renderGuideIndex(guides, lines) {
  const guideItems = guides
    .map((g) => `<li><a class="card" href="/guider/${escapeHtml(g.slug)}"><span class="card-title">${escapeHtml(g.title)}</span><span class="card-text">${escapeHtml(g.description)}</span></a></li>`)
    .join('\n      ');
  const groupHtml = MODE_GROUPS.map(([mode, heading]) => {
    const items = lines.filter((l) => l.mode === mode)
      .map((l) => `<li>${lineBadge(l, { link: true })}</li>`)
      .join('');
    return items ? `      <section class="mode-group" data-mode="${escapeHtml(mode)}">\n        <h3>${escapeHtml(heading)}</h3>\n        <ul class="badge-list">${items}</ul>\n      </section>` : '';
  }).filter(Boolean).join('\n');

  const body = `    <h1>Guider og linjer</h1>
    <p class="lead">Bakgrunn om kollektivtrafikken i Oslo, og en side per linje med stoppliste og hvor mange kjøretøy som er ute nå.</p>
    <p class="lang-switch"><a href="/en" hreflang="en" lang="en">English</a>: <span lang="en">guides for visitors to Oslo</span></p>
    <h2>Guider</h2>
    <ul class="card-list">
      ${guideItems}
    </ul>
    <h2>Linjer</h2>
    <div class="mode-groups">
${groupHtml}
    </div>`;

  return renderPage({
    title: 'Guider og linjer | livetrafikk.no',
    description: 'Guider om kollektivtrafikken i Oslo og oversikt over T-bane-, trikk-, tog-, Flytoget- og flybusslinjer.',
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
