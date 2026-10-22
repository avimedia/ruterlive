// Server-rendret guideside (/guider/:slug).

import { GUIDES } from '../guide-catalog.js';
import { alternatesFor, getEnAlternateFor } from '../en-catalog.js';
import { escapeHtml, renderPage } from './layout.js';

/** `body` er klarert HTML fra repoet og escapes ikke. */
export function renderGuidePage(guide, body) {
  const date = guide.updated && guide.updated !== guide.published
    ? `publisert ${escapeHtml(guide.published)} · oppdatert ${escapeHtml(guide.updated)}`
    : `publisert ${escapeHtml(guide.published)}`;
  const others = GUIDES.filter((g) => g.slug !== guide.slug)
    .map((g) => `<li><a class="card" href="/guider/${escapeHtml(g.slug)}"><span class="card-title">${escapeHtml(g.title)}</span><span class="card-text">${escapeHtml(g.description)}</span></a></li>`)
    .join('');

  const path = `/guider/${guide.slug}`;
  const en = getEnAlternateFor(path);
  const enLink = en ? ` · <a href="${escapeHtml(en.path)}" hreflang="en" lang="en">English</a>` : '';

  const html = `    <article class="prose">
    <p class="eyebrow"><a href="/guider">Guider</a>${enLink}</p>
    <h1>${escapeHtml(guide.title)}</h1>
    <p class="byline">livetrafikk.no · ${date}</p>
${body}
    </article>
    <aside class="related" aria-labelledby="les-ogsa">
      <h2 id="les-ogsa">Les også</h2>
      <ul class="card-list">${others}</ul>
    </aside>`;

  return renderPage({
    title: `${guide.title} | livetrafikk.no`,
    description: guide.description,
    path,
    body: html,
    alternates: en ? alternatesFor(path, en.path) : [],
  });
}
