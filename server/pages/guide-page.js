// Server-rendret guideside (/guider/:slug).

import { GUIDES } from '../guide-catalog.js';
import { findRegion, getRegion, regionPath } from '../../shared/regions.js';
import { alternatesFor, getEnAlternateFor } from '../en-catalog.js';
import { breadcrumbLd, escapeHtml, renderPage } from './layout.js';

/**
 * `body` er klarert HTML fra repoet og escapes ikke. `guides` er guidene å foreslå under «Les også»
 * (standard: alle; kun guider i samme region vises).
 */
export function renderGuidePage(guide, body, guides = GUIDES) {
  const region = findRegion(guide.region) ?? getRegion();
  const date = guide.updated && guide.updated !== guide.published
    ? `publisert ${escapeHtml(guide.published)} · oppdatert ${escapeHtml(guide.updated)}`
    : `publisert ${escapeHtml(guide.published)}`;
  const others = guides.filter((g) => g.slug !== guide.slug && (g.region ?? 'oslo') === region.id)
    .map((g) => `<li><a class="card" href="${escapeHtml(regionPath(region, `/guider/${g.slug}`))}"><span class="card-title">${escapeHtml(g.title)}</span><span class="card-text">${escapeHtml(g.description)}</span></a></li>`)
    .join('');

  const path = regionPath(region, `/guider/${guide.slug}`);
  const en = region.path ? null : getEnAlternateFor(path);
  const enLink = en ? ` · <a href="${escapeHtml(en.path)}" hreflang="en" lang="en">English</a>` : '';

  const html = `    <article class="prose">
    <p class="eyebrow">${region.path ? `<a href="${escapeHtml(region.path)}">${escapeHtml(region.shortName)}</a> / ` : ''}<a href="/guider">Guider</a>${enLink}</p>
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
    mapPath: regionPath(region),
    jsonLd: [
      breadcrumbLd([
        { name: region.path ? region.shortName : 'Hjem', path: regionPath(region) },
        { name: 'Guider', path: '/guider' },
        { name: guide.title, path },
      ]),
      {
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: guide.title,
        description: guide.description,
        inLanguage: 'nb',
        datePublished: guide.published,
        dateModified: guide.updated || guide.published,
        mainEntityOfPage: `https://livetrafikk.no${path}`,
        image: 'https://livetrafikk.no/og-image.png',
        author: { '@type': 'Organization', name: 'livetrafikk.no', url: 'https://livetrafikk.no/' },
        publisher: { '@type': 'Organization', name: 'livetrafikk.no', url: 'https://livetrafikk.no/', logo: { '@type': 'ImageObject', url: 'https://livetrafikk.no/icon-512.png' } },
      },
    ],
    alternates: en ? alternatesFor(path, en.path) : [],
  });
}
