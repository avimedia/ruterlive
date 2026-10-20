// Server-rendret guideside (/guider/:slug).

import { GUIDES } from '../guide-catalog.js';
import { escapeHtml, renderPage } from './layout.js';

/** `body` er klarert HTML fra repoet og escapes ikke. */
export function renderGuidePage(guide, body) {
  const date = guide.updated && guide.updated !== guide.published
    ? `publisert ${escapeHtml(guide.published)} · oppdatert ${escapeHtml(guide.updated)}`
    : `publisert ${escapeHtml(guide.published)}`;
  const others = GUIDES.filter((g) => g.slug !== guide.slug)
    .map((g) => `<li><a href="/guider/${escapeHtml(g.slug)}">${escapeHtml(g.title)}</a></li>`)
    .join('');

  const html = `    <h1>${escapeHtml(guide.title)}</h1>
    <p class="byline">livetrafikk.no · ${date}</p>
${body}
    <h2>Les også</h2>
    <ul>${others}</ul>`;

  return renderPage({
    title: `${guide.title} | livetrafikk.no`,
    description: guide.description,
    path: `/guider/${guide.slug}`,
    body: html,
  });
}
