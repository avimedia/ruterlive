// Server-rendrede sider: guideoversikt (/guider) og Om (/om).

import { escapeHtml, renderPage } from './layout.js';

const MODE_GROUPS = [
  ['metro', 'T-bane'],
  ['tram', 'Trikk'],
  ['rail', 'Tog'],
  ['flytog', 'Flytoget'],
  ['flybuss', 'Flybuss'],
];

export function renderGuideIndex(guides, lines) {
  const guideItems = guides
    .map((g) => `<li><a href="/guider/${escapeHtml(g.slug)}">${escapeHtml(g.title)}</a><br>${escapeHtml(g.description)}</li>`)
    .join('\n      ');
  const groupHtml = MODE_GROUPS.map(([mode, heading]) => {
    const items = lines.filter((l) => l.mode === mode)
      .map((l) => `<li><a href="/linje/${escapeHtml(l.slug)}">${escapeHtml(l.title)}</a></li>`)
      .join('');
    return items ? `    <h2>${escapeHtml(heading)}</h2>\n    <ul>${items}</ul>` : '';
  }).join('\n');

  const body = `    <h1>Guider og linjer</h1>
    <h2>Guider</h2>
    <ul>
      ${guideItems}
    </ul>
${groupHtml}`;

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
    body: `    <h1>Om livetrafikk.no</h1>\n${body}`,
  });
}
