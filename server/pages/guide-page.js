// Server-rendret guideside (/guider/:slug).

import { GUIDES } from '../guide-catalog.js';
import { breadcrumbLd, escapeHtml, renderPage } from './layout.js';

/** `body` er klarert HTML fra repoet og escapes ikke. */
export function renderGuidePage(guide, body) {
  const date = guide.updated && guide.updated !== guide.published
    ? `publisert ${escapeHtml(guide.published)} · oppdatert ${escapeHtml(guide.updated)}`
    : `publisert ${escapeHtml(guide.published)}`;
  const others = GUIDES.filter((g) => g.slug !== guide.slug)
    .map((g) => `<li><a class="card" href="/guider/${escapeHtml(g.slug)}"><span class="card-title">${escapeHtml(g.title)}</span><span class="card-text">${escapeHtml(g.description)}</span></a></li>`)
    .join('');

  const html = `    <article class="prose">
    <p class="eyebrow"><a href="/guider">Guider</a></p>
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
    path: `/guider/${guide.slug}`,
    body: html,
    jsonLd: [
      breadcrumbLd([
        { name: 'Hjem', path: '/' },
        { name: 'Guider', path: '/guider' },
        { name: guide.title, path: `/guider/${guide.slug}` },
      ]),
      {
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: guide.title,
        description: guide.description,
        inLanguage: 'nb',
        datePublished: guide.published,
        dateModified: guide.updated || guide.published,
        mainEntityOfPage: `https://livetrafikk.no/guider/${guide.slug}`,
        image: 'https://livetrafikk.no/og-image.png',
        author: { '@type': 'Organization', name: 'livetrafikk.no', url: 'https://livetrafikk.no/' },
        publisher: { '@type': 'Organization', name: 'livetrafikk.no', url: 'https://livetrafikk.no/', logo: { '@type': 'ImageObject', url: 'https://livetrafikk.no/icon-512.png' } },
      },
    ],
  });
}
